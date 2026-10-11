"""Zerodha Kite Connect (REST). Login: kite.zerodha.com redirect with request_token."""
import csv, io, urllib.parse
from core import AuthError, BrokerError, cache_path, http, leg, load_json, save_json, sha256, today_ist
from . import Adapter, F, nearest_futs

ROOT = 'https://api.kite.trade'
SPOT = {'NIFTY': 'NSE:NIFTY 50', 'BANKNIFTY': 'NSE:NIFTY BANK', 'FINNIFTY': 'NSE:NIFTY FIN SERVICE', 'MIDCPNIFTY': 'NSE:NIFTY MID SELECT'}


class Kite(Adapter):
    id = 'kite'
    name = 'Zerodha Kite Connect'
    gap = 1.1                      # quote API: about 1 request per second
    needs = ('api_key', 'api_secret')
    fields = (F('api_key', 'API key'), F('api_secret', 'API secret', secret=True))
    redirect_needed = True
    symbols = tuple(SPOT)

    def __init__(self, cfg, redirect_url):
        super().__init__(cfg, redirect_url)
        self.ins, self.ins_day, self.spot = {}, None, {}

    def h(self):
        return {'X-Kite-Version': '3', 'Authorization': f"token {self.cfg['api_key'].strip()}:{self.token}"}

    def login_url(self):
        # the redirect URL itself is set in the Kite developer console, not here
        return 'https://kite.zerodha.com/connect/login?' + urllib.parse.urlencode({'api_key': self.cfg['api_key'].strip(), 'v': '3'})

    def finish_login(self, p):
        rt = p.get('request_token')
        if not rt:
            raise AuthError(f"Kite did not send a request_token (status={p.get('status', '?')}).")
        k, sec = self.cfg['api_key'].strip(), self.cfg['api_secret'].strip()
        r = http('POST', ROOT + '/session/token', headers={'X-Kite-Version': '3'},
                 form={'api_key': k, 'request_token': rt, 'checksum': sha256(k + rt + sec)})
        d = r.get('data') or {}
        if not d.get('access_token'):
            raise AuthError('Kite login failed: ' + str(r.get('message') or r))
        self.token, self.user = d['access_token'], d.get('user_id')

    def instruments(self):
        day = today_ist().isoformat()
        if self.ins_day == day:
            return
        path = cache_path(f'kite-nfo2-{day}.json')
        data = load_json(path)
        if not data:
            txt = http('GET', ROOT + '/instruments/NFO', headers=self.h(), raw=True, timeout=90)
            data = {'_FUT': []}
            for row in csv.DictReader(io.StringIO(txt)):
                if row.get('segment') == 'NFO-OPT' and row.get('name') in SPOT:
                    data.setdefault(row['name'], []).append([row['expiry'], float(row['strike']), row['instrument_type'], row['tradingsymbol'], int(float(row['lot_size'] or 0))])
                elif row.get('segment') == 'NFO-FUT':
                    data['_FUT'].append([row['name'], row['expiry'], row['tradingsymbol'], int(float(row['lot_size'] or 0))])
            if not data:
                raise BrokerError('Kite instrument list came back empty.')
            save_json(path, data)
        self.ins, self.ins_day = data, day

    stocks_supported = True

    def stocks(self):
        self.instruments()
        futs = nearest_futs(self.ins.get('_FUT') or [], today_ist().isoformat())
        names = sorted(futs)
        out = []
        for i in range(0, len(names), 450):                   # quote API: up to 500 instruments a call
            part = names[i:i + 450]
            q = self.quote(['NFO:' + futs[n][0] for n in part])
            for n in part:
                x = q.get('NFO:' + futs[n][0])
                if x and x.get('last_price'):
                    out.append({'s': n, 'ltp': x['last_price'], 'prev': (x.get('ohlc') or {}).get('close'), 'oi': x.get('oi'), 'vol': x.get('volume'), 'lot': futs[n][1]})
        return out

    def quote(self, keys):
        r = http('GET', ROOT + '/quote', params={'i': keys}, headers=self.h())
        if r.get('status') == 'error':
            if r.get('error_type') == 'TokenException':
                raise AuthError(r.get('message'))
            raise BrokerError(r.get('message'))
        return r.get('data') or {}

    def chain(self, sym, n):
        self.instruments()
        lst = self.ins.get(sym)
        if not lst:
            raise BrokerError(f'No {sym} options in the Kite instrument list.')
        today = today_ist().isoformat()
        exp = self.cfg.get('expiry_' + sym) or min(c[0] for c in lst if c[0] >= today)
        con = {}
        for e, k, typ, ts, lot in lst:
            if e == exp:
                con[(k, typ)] = (ts, lot)
        strikes = sorted({k for k, _ in con})
        if sym not in self.spot:
            q = self.quote([SPOT[sym]])
            self.spot[sym] = (q.get(SPOT[sym]) or {}).get('last_price') or 0
        S = self.spot[sym]
        i = min(range(len(strikes)), key=lambda j: abs(strikes[j] - S))
        pick = strikes[max(0, i - n - 1): i + n + 2]
        keys = [SPOT[sym]] + ['NFO:' + con[(k, t)][0] for k in pick for t in ('CE', 'PE') if (k, t) in con]
        q = self.quote(keys)
        ix = q.get(SPOT[sym]) or {}
        S = ix.get('last_price') or S
        self.spot[sym] = S
        rows, lot = [], None
        for k in pick:
            r = {'k': k}
            for t in ('CE', 'PE'):
                c = con.get((k, t))
                x = q.get('NFO:' + c[0]) if c else None
                lot = lot or (c[1] if c else None)
                r[t.lower()] = leg(x.get('last_price'), (x.get('ohlc') or {}).get('close'), x.get('oi'), None, None, x.get('volume')) if x else leg()
            rows.append(r)
        return {'spot': S, 'prev': (ix.get('ohlc') or {}).get('close'), 'expiry': exp, 'lot': lot, 'rows': rows}
