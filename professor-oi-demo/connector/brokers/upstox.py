"""Upstox API v2 (REST). Login: Upstox dialog redirect with ?code=."""
import json, urllib.parse
from datetime import datetime
from core import IST, AuthError, BrokerError, cache_path, http, leg, load_json, save_json, today_ist
from . import Adapter, F, nearest_futs

ROOT = 'https://api.upstox.com/v2'
MASTER = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz'
KEY = {'NIFTY': 'NSE_INDEX|Nifty 50', 'BANKNIFTY': 'NSE_INDEX|Nifty Bank', 'FINNIFTY': 'NSE_INDEX|Nifty Fin Service', 'MIDCPNIFTY': 'NSE_INDEX|NIFTY MID SELECT'}


class Upstox(Adapter):
    id = 'upstox'
    name = 'Upstox'
    gap = 0.6
    needs = ('api_key', 'api_secret')
    fields = (F('api_key', 'API key'), F('api_secret', 'API secret', secret=True))
    redirect_needed = True
    symbols = tuple(KEY)

    def __init__(self, cfg, redirect_url):
        super().__init__(cfg, redirect_url)
        self.exp = {}

    def h(self):
        return {'Authorization': 'Bearer ' + self.token}

    def login_url(self):
        return ROOT + '/login/authorization/dialog?' + urllib.parse.urlencode(
            {'response_type': 'code', 'client_id': self.cfg['api_key'].strip(), 'redirect_uri': self.redirect_url, 'state': 'poi'})

    def finish_login(self, p):
        code = p.get('code')
        if not code:
            raise AuthError('Upstox did not send a code in the redirect.')
        r = http('POST', ROOT + '/login/authorization/token', form={
            'code': code, 'client_id': self.cfg['api_key'].strip(), 'client_secret': self.cfg['api_secret'].strip(),
            'redirect_uri': self.redirect_url, 'grant_type': 'authorization_code'})
        if not r.get('access_token'):
            raise AuthError('Upstox login failed: ' + str(r.get('errors') or r))
        self.token, self.user = r['access_token'], r.get('user_id')

    def expiry(self, sym):
        day = today_ist().isoformat()
        if self.cfg.get('expiry_' + sym):
            return self.cfg['expiry_' + sym], None
        if self.exp.get(sym, (None,))[0] != day:
            r = http('GET', ROOT + '/option/contract', params={'instrument_key': KEY[sym]}, headers=self.h())
            data = r.get('data') or []
            ex = sorted({c.get('expiry') for c in data if c.get('expiry') and c['expiry'] >= day})
            if not ex:
                raise BrokerError(f'Upstox returned no {sym} expiries.')
            lot = next((c.get('lot_size') for c in data if c.get('expiry') == ex[0]), None)
            self.exp[sym] = (day, ex[0], lot)
        return self.exp[sym][1], self.exp[sym][2]

    stocks_supported = True

    def load_futs(self):
        day = today_ist().isoformat()
        if getattr(self, 'futs_day', None) == day:
            return self.futs
        path = cache_path(f'upstox-fut-{day}.json')
        rows = load_json(path)
        if not rows:
            rows = []
            for o in json.loads(http('GET', MASTER, raw=True, timeout=180)):
                if o.get('segment') == 'NSE_FO' and o.get('instrument_type') == 'FUT':
                    exp = o.get('expiry')
                    exp = datetime.fromtimestamp(exp / 1000, IST).date().isoformat() if isinstance(exp, (int, float)) else str(exp or '')[:10]
                    rows.append([o.get('underlying_symbol') or o.get('asset_symbol') or o.get('name'), exp, o.get('instrument_key'), o.get('lot_size')])
            if not rows:
                raise BrokerError('No futures found in the Upstox instrument list.')
            save_json(path, rows)
        self.futs, self.futs_day = nearest_futs(rows, day), day
        return self.futs

    def stocks(self):
        futs = self.load_futs()
        by_key = {v[0]: (n, v[1]) for n, v in futs.items()}
        keys, out = list(by_key), []
        for j in range(0, len(keys), 450):                    # quotes API: up to 500 instruments a call
            part = ','.join(keys[j:j + 450])
            try:
                r = http('GET', ROOT + '/market-quote/quotes', params={'instrument_key': part}, headers=self.h())
            except BrokerError as e:
                if 'HTTP 400' not in str(e):
                    raise
                r = http('GET', ROOT + '/market-quote/quotes', params={'symbol': part}, headers=self.h())
            for x in (r.get('data') or {}).values():
                n, lot = by_key.get(x.get('instrument_token'), (None, None))
                if n and x.get('last_price'):
                    ltp, nc = x['last_price'], x.get('net_change')
                    out.append({'s': n, 'ltp': ltp, 'prev': ltp - nc if nc is not None else (x.get('ohlc') or {}).get('close'), 'oi': x.get('oi'), 'vol': x.get('volume'), 'lot': lot})
        return out

    def chain(self, sym, n):
        exp, lot = self.expiry(sym)
        r = http('GET', ROOT + '/option/chain', params={'instrument_key': KEY[sym], 'expiry_date': exp}, headers=self.h())
        if r.get('status') != 'success':
            raise BrokerError('Upstox: ' + str(r.get('errors') or r))
        rows, S = [], 0
        for it in r.get('data') or []:
            S = it.get('underlying_spot_price') or S
            row = {'k': it.get('strike_price')}
            for side, key in (('ce', 'call_options'), ('pe', 'put_options')):
                o = it.get(key) or {}
                m, g = o.get('market_data') or {}, o.get('option_greeks') or {}
                row[side] = leg(m.get('ltp'), m.get('close_price'), m.get('oi'), m.get('prev_oi'), None, m.get('volume'), g.get('iv'))
            rows.append(row)
        return {'spot': S, 'expiry': exp, 'lot': lot, 'rows': rows}
