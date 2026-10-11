"""ICICI Direct Breeze (REST). Login: api.icicidirect.com redirect with ?apisession=.
Requests are signed with sha256(timestamp + body + secret), same as the breeze-connect SDK."""
import base64, json, time, urllib.parse
from datetime import datetime, timezone
from core import AuthError, BrokerError, http, leg, next_weekdays, sha256, today_ist
from . import Adapter

API = 'https://api.icicidirect.com/breezeapi/api/v1/'
CODE = {'NIFTY': 'NIFTY', 'BANKNIFTY': 'CNXBAN'}


class Breeze(Adapter):
    id = 'breeze'
    name = 'ICICI Direct Breeze'
    gap = 0.8                      # 100 calls per minute; each chain needs 2 (calls + puts)
    needs = ('api_key', 'api_secret')
    symbols = tuple(CODE)

    def __init__(self, cfg, redirect_url):
        super().__init__(cfg, redirect_url)
        self.exp = {}

    def login_url(self):
        return 'https://api.icicidirect.com/apiuser/login?api_key=' + urllib.parse.quote_plus(self.cfg['api_key'].strip())

    def finish_login(self, p):
        sess = p.get('apisession') or p.get('API_Session') or p.get('session_token')
        if not sess:
            raise AuthError('ICICI did not send an apisession in the redirect.')
        body = json.dumps({'SessionToken': sess, 'AppKey': self.cfg['api_key'].strip()}, separators=(',', ':'))
        r = http('GET', API + 'customerdetails', body=body)
        ok = r.get('Success') or {}
        if not ok.get('session_token'):
            raise AuthError('Breeze login failed: ' + str(r.get('Error') or r))
        self.token = ok['session_token']                      # base64("user_id:session_key")
        self.user = base64.b64decode(self.token).decode('ascii', 'replace').split(':')[0]

    def get(self, endpoint, body):
        b = json.dumps(body, separators=(',', ':'))
        ts = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
        h = {'X-Checksum': 'token ' + sha256(ts + b + self.cfg['api_secret'].strip()), 'X-Timestamp': ts,
             'X-AppKey': self.cfg['api_key'].strip(), 'X-SessionToken': self.token}
        r = http('GET', API + endpoint, body=b, headers=h)
        err = str(r.get('Error') or '')
        if r.get('Status') in (401, 403) or 'session' in err.lower():
            raise AuthError('Breeze: ' + err)
        return r

    def side(self, sym, exp, right):
        r = self.get('optionchain', {'stock_code': CODE[sym], 'exchange_code': 'NFO', 'expiry_date': f'{exp}T06:00:00.000Z',
                                     'product_type': 'options', 'right': right})
        return r.get('Success') or []

    def expiry(self, sym):
        """Breeze has no expiry-list call, so try weekdays in date order until one has data."""
        day = today_ist()
        if self.cfg.get('expiry_' + sym):
            return self.cfg['expiry_' + sym], None
        if self.exp.get(sym, (None,))[0] != day.isoformat():
            for d in next_weekdays(day, 40):
                data = self.side(sym, d.isoformat(), 'call')
                if data:
                    self.exp[sym] = (day.isoformat(), d.isoformat(), data)
                    break
                time.sleep(self.gap)
            else:
                raise BrokerError(f'Breeze: no {sym} expiry found in the next 40 days. Set "expiry_{sym}" in config.json.')
            return self.exp[sym][1], self.exp[sym][2]
        return self.exp[sym][1], None

    def chain(self, sym, n):
        exp, calls = self.expiry(sym)
        if calls is None:
            calls = self.side(sym, exp, 'call')
            time.sleep(self.gap)
        puts = self.side(sym, exp, 'put')
        by, S = {}, 0
        for lst, s in ((calls, 'ce'), (puts, 'pe')):
            for x in lst:
                S = x.get('spot_price') or S
                k = float(x.get('strike_price') or 0)
                by.setdefault(k, {})[s] = leg(x.get('ltp'), x.get('previous_close'), x.get('open_interest'), None, x.get('chnge_oi'), x.get('total_quantity_traded'))
        rows = [{'k': k, 'ce': v.get('ce') or leg(), 'pe': v.get('pe') or leg()} for k, v in by.items()]
        return {'spot': float(S or 0), 'expiry': exp, 'rows': rows}
