"""Upstox API v2 (REST). Login: Upstox dialog redirect with ?code=."""
import urllib.parse
from core import AuthError, BrokerError, http, leg, today_ist
from . import Adapter

ROOT = 'https://api.upstox.com/v2'
KEY = {'NIFTY': 'NSE_INDEX|Nifty 50', 'BANKNIFTY': 'NSE_INDEX|Nifty Bank', 'FINNIFTY': 'NSE_INDEX|Nifty Fin Service', 'MIDCPNIFTY': 'NSE_INDEX|NIFTY MID SELECT'}


class Upstox(Adapter):
    id = 'upstox'
    name = 'Upstox'
    gap = 0.6
    needs = ('api_key', 'api_secret')
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
