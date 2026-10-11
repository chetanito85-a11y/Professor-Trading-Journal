"""DhanHQ v2 (REST). Two ways in:
 - access_token from web.dhan.co pasted in config.json (simplest), or
 - app_id + app_secret: consent login on auth.dhan.co, redirect with ?tokenId=."""
import urllib.parse
from core import AuthError, BrokerError, http, leg, today_ist
from . import Adapter, F

API = 'https://api.dhan.co/v2'
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
        return {'spot': d.get('last_price'), 'expiry': exp, 'rows': rows}
