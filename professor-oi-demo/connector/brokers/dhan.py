"""DhanHQ v2 (REST). Two ways in:
 - access_token from web.dhan.co pasted in config.json (simplest), or
 - app_id + app_secret: consent login on auth.dhan.co, redirect with ?tokenId=."""
import csv, io, urllib.parse
from core import AuthError, BrokerError, cache_path, http, leg, load_json, save_json, today_ist
from . import Adapter, F, nearest_futs

API = 'https://api.dhan.co/v2'
MASTER = 'https://images.dhan.co/api-data/api-scrip-master.csv'
AUTH = 'https://auth.dhan.co'
IDS = {'NIFTY': 13, 'BANKNIFTY': 25, 'FINNIFTY': 27, 'MIDCPNIFTY': 442}


class Dhan(Adapter):
    id = 'dhan'
    name = 'Dhan'
    gap = 3.1                      # option chain API: 1 request every 3 seconds
    symbols = tuple(IDS)
    symbols = tuple(IDS)
    fields = (F('client_id', 'Dhan Client ID'), F('access_token', 'Access token', secret=True, group='token', help='web.dhan.co > My Profile > Access DhanHQ APIs > Generate Access Token'),
              F('app_id', 'API key', group='oauth'), F('app_secret', 'API secret', secret=True, group='oauth'))
    redirect_needed = 'oauth'

    def __init__(self, cfg, redirect_url):
        super().__init__(cfg, redirect_url)
        self.login_kind = 'direct' if str(self.cfg.get('access_token', '')).strip() else 'redirect'
        self.exp = {}

    def missing(self):
        keys = ('client_id', 'access_token') if self.login_kind == 'direct' else ('client_id', 'app_id', 'app_secret')
        return [k for k in keys if not str(self.cfg.get(k, '')).strip()]

    def h(self):
        return {'access-token': self.token, 'client-id': self.cfg['client_id'].strip()}

    def app_h(self):
        return {'app_id': self.cfg['app_id'].strip(), 'app_secret': self.cfg['app_secret'].strip()}

    # token pasted in config.json
    def direct_login(self, form):
        self.token = self.cfg['access_token'].strip()
        try:
            self.expiry('NIFTY')   # one cheap call proves the token works
        except Exception:
            self.token = None
            raise
        self.user = self.cfg['client_id'].strip()

    # consent flow
    def login_url(self):
        r = http('POST', AUTH + '/app/generate-consent', params={'client_id': self.cfg['client_id'].strip()}, headers=self.app_h())
        cid = r.get('consentAppId')
        if not cid:
            raise AuthError('Dhan consent failed: ' + str(r.get('message') or r))
        return AUTH + '/login/consentApp-login?' + urllib.parse.urlencode({'consentAppId': cid})

    def finish_login(self, p):
        tid = p.get('tokenId') or p.get('tokenid') or p.get('token_id')
        if not tid:
            raise AuthError('Dhan did not send a tokenId in the redirect.')
        r = http('GET', AUTH + '/app/consumeApp-consent', params={'tokenId': tid}, headers=self.app_h())
        if not r.get('accessToken'):
            raise AuthError('Dhan login failed: ' + str(r.get('message') or r))
        self.token, self.user = r['accessToken'], r.get('dhanClientId') or self.cfg['client_id'].strip()

    def post(self, path, body):
        r = http('POST', API + path, body=body, headers=self.h())
        if r.get('status') not in (None, 'success'):
            msg = str(r.get('remarks') or r.get('errorMessage') or r)
            if 'DH-901' in msg or ('invalid' in msg.lower() and 'token' in msg.lower()):
                raise AuthError('Dhan: ' + msg)
            raise BrokerError('Dhan: ' + msg)
        return r.get('data')

    def expiry(self, sym):
        day = today_ist().isoformat()
        if self.cfg.get('expiry_' + sym):
            return self.cfg['expiry_' + sym]
        if self.exp.get(sym, (None,))[0] != day:
            ex = sorted(e for e in (self.post('/optionchain/expirylist', {'UnderlyingScrip': IDS[sym], 'UnderlyingSeg': 'IDX_I'}) or []) if e >= day)
            if not ex:
                raise BrokerError(f'Dhan returned no {sym} expiries.')
            self.exp[sym] = (day, ex[0])
        return self.exp[sym][1]

    stocks_supported = True

    def load_master(self):
        """Futures (all F&O stocks + indices) and index options from Dhan's scrip master, cached per day."""
        day = today_ist().isoformat()
        if getattr(self, 'master_day', None) == day:
            return
        path = cache_path(f'dhan-master-{day}.json')
        data = load_json(path)
        if not data:
            rd = csv.reader(io.StringIO(http('GET', MASTER, raw=True, timeout=180)))
            head = [h.strip().upper() for h in next(rd)]
            col = lambda name: head.index(name) if name in head else None
            ex, sid, ins, ts, lot, exp, stk, opt = (col(c) for c in ('SEM_EXM_EXCH_ID', 'SEM_SMST_SECURITY_ID', 'SEM_INSTRUMENT_NAME', 'SEM_TRADING_SYMBOL', 'SEM_LOT_UNITS', 'SEM_EXPIRY_DATE', 'SEM_STRIKE_PRICE', 'SEM_OPTION_TYPE'))
            if None in (ex, sid, ins, ts, exp):
                raise BrokerError('Dhan instrument list has an unexpected format.')
            data = {'fut': [], 'opt': []}
            for r in rd:
                if len(r) <= max(ex, sid, ins, ts, exp) or r[ex] != 'NSE':
                    continue
                if r[ins] in ('FUTSTK', 'FUTIDX'):
                    data['fut'].append([r[ts].split('-')[0], r[exp][:10], int(float(r[sid])), int(float(r[lot] or 0)) if lot is not None else None])
                elif r[ins] == 'OPTIDX' and stk is not None and opt is not None and r[ts].split('-')[0] in IDS and r[exp][:10] >= day:
                    data['opt'].append([r[ts].split('-')[0], r[exp][:10], float(r[stk]), r[opt].strip().lower(), int(float(r[sid]))])
            if not data['fut']:
                raise BrokerError('No futures found in the Dhan instrument list.')
            save_json(path, data)
        self.futs = nearest_futs(data['fut'], day)
        self.optid = {(n, e, k, t): i for n, e, k, t, i in data.get('opt', [])}
        self.master_day = day

    def load_futs(self):
        self.load_master()
        return self.futs

    stream_supported = True

    def stream_make(self):
        from stream import DhanStream
        if not getattr(self, 'master_day', None):
            try:
                self.load_master()
            except Exception:
                self.optid = {}
        return DhanStream(self.cfg['client_id'].strip(), self.token, self.cfg.get('ws_url') or 'wss://api-feed.dhan.co')

    def stocks(self):
        futs = self.load_futs()
        by_id = {v[0]: (n, v[1]) for n, v in futs.items()}
        ids, out = list(by_id), []
        for j in range(0, len(ids), 900):                     # quote API: up to 1000 instruments a call
            d = (self.post('/marketfeed/quote', {'NSE_FNO': ids[j:j + 900]}) or {}).get('NSE_FNO') or {}
            for k, x in d.items():
                n, lot = by_id.get(int(k), (None, None))
                if n and x.get('last_price'):
                    ltp, nc = x['last_price'], x.get('net_change')
                    out.append({'s': n, 'ltp': ltp, 'prev': ltp - nc if nc is not None else (x.get('ohlc') or {}).get('close'), 'oi': x.get('oi'), 'vol': x.get('volume'), 'lot': lot})
        return out

    def chain(self, sym, n):
        exp = self.expiry(sym)
        d = self.post('/optionchain', {'UnderlyingScrip': IDS[sym], 'UnderlyingSeg': 'IDX_I', 'Expiry': exp}) or {}
        rows = []
        for k, v in (d.get('oc') or {}).items():
            row = {'k': float(k)}
            for side in ('ce', 'pe'):
                o = (v or {}).get(side) or {}
                row[side] = leg(o.get('last_price'), o.get('previous_close_price'), o.get('oi'), o.get('previous_oi'), None, o.get('volume'), o.get('implied_volatility'))
            rows.append(row)
        oid = getattr(self, 'optid', None) or {}
        self.keymap[sym] = {'spot': f'IDX_I:{IDS[sym]}', 'legs': {(r['k'], s): f'NSE_FNO:{oid[(sym, exp, r["k"], s)]}' for r in rows for s in ('ce', 'pe') if (sym, exp, r['k'], s) in oid}}
        return {'spot': d.get('last_price'), 'expiry': exp, 'rows': rows}
