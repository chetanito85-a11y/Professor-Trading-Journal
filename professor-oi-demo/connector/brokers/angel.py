"""Angel One SmartAPI (REST). No redirect: the connector logs in with
client code + MPIN + TOTP. The TOTP comes from totp_secret in config.json, or
you type the 6-digit code on the Broker page."""
import json, re, socket, time, uuid
from datetime import datetime
from core import AuthError, BrokerError, cache_path, http, leg, load_json, save_json, today_ist, totp
from . import Adapter, F

ROOT = 'https://apiconnect.angelone.in'
MASTER = 'https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json'
INDEX = {'NIFTY': '99926000', 'BANKNIFTY': '99926009', 'FINNIFTY': '99926037', 'MIDCPNIFTY': '99926074'}


def _local_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return '127.0.0.1'


class Angel(Adapter):
    id = 'angel'
    name = 'Angel One SmartAPI'
    login_kind = 'direct'
    gap = 1.1
    needs = ('api_key', 'client_code')
    fields = (F('api_key', 'API key'), F('client_code', 'Client ID', help='Your Angel One login ID'),
              F('pin', 'MPIN', secret=True, optional=True, help='Leave empty to type it at each login'),
              F('totp_secret', 'TOTP secret key', secret=True, optional=True, help='Text key under the QR code at smartapi.angelone.in/enable-totp. Empty = type the 6-digit code at each login'))
    symbols = tuple(INDEX)

    def __init__(self, cfg, redirect_url):
        super().__init__(cfg, redirect_url)
        ip = _local_ip()
        mac = ':'.join(f'{(uuid.getnode() >> s) & 0xff:02x}' for s in range(40, -1, -8))
        self.base_h = {'X-UserType': 'USER', 'X-SourceID': 'WEB', 'X-ClientLocalIP': ip, 'X-ClientPublicIP': ip,
                       'X-MACAddress': mac, 'X-PrivateKey': self.cfg.get('api_key', '').strip()}
        self.master, self.master_day, self.spot = {}, None, {}

    def direct_fields(self):
        f = []
        if not str(self.cfg.get('pin', '')).strip():
            f.append(['pin', 'MPIN', 'password'])
        if not str(self.cfg.get('totp_secret', '')).strip():
            f.append(['totp', '6-digit TOTP', 'text'])
        return f

    def direct_login(self, form):
        pin = str(self.cfg.get('pin') or form.get('pin') or '').strip()
        sec = str(self.cfg.get('totp_secret') or '').strip()
        code = totp(sec) if sec else str(form.get('totp') or '').strip()
        if not pin or not code:
            raise AuthError('Angel needs your MPIN and the 6-digit TOTP.')
        r = http('POST', ROOT + '/rest/auth/angelbroking/user/v1/loginByPassword', headers=self.base_h,
                 body={'clientcode': self.cfg['client_code'].strip(), 'password': pin, 'totp': code})
        d = r.get('data') or {}
        if not r.get('status') or not d.get('jwtToken'):
            raise AuthError('Angel login failed: ' + str(r.get('message') or r.get('errorcode') or r))
        self.token, self.user = d['jwtToken'].replace('Bearer ', ''), self.cfg['client_code'].strip()

    def load_master(self):
        day = today_ist().isoformat()
        if self.master_day == day:
            return
        path = cache_path(f'angel-optidx-{day}.json')
        data = load_json(path)
        if not data:
            txt = http('GET', MASTER, raw=True, timeout=180)
            data = {}
            for m in re.finditer(r'\{[^{}]*\}', txt):
                s = m.group(0)
                if 'OPTIDX' not in s:
                    continue
                o = json.loads(s)
                if o.get('exch_seg') != 'NFO' or o.get('name') not in INDEX:
                    continue
                try:
                    exp = datetime.strptime(o['expiry'], '%d%b%Y').date().isoformat()
                except (KeyError, ValueError):
                    continue
                typ = o.get('symbol', '')[-2:]
                data.setdefault(o['name'], []).append([exp, float(o['strike']) / 100, typ, o['token'], int(float(o.get('lotsize') or 0))])
            if not data:
                raise BrokerError('Angel scrip master had no index options.')
            save_json(path, data)
        self.master, self.master_day = data, day

    def quote(self, nfo, nse=()):
        h = dict(self.base_h, Authorization='Bearer ' + self.token)
        tok = {}
        if nfo:
            tok['NFO'] = list(nfo)
        if nse:
            tok['NSE'] = list(nse)
        r = http('POST', ROOT + '/rest/secure/angelbroking/market/v1/quote', headers=h, body={'mode': 'FULL', 'exchangeTokens': tok})
        if not r.get('status'):
            msg = str(r.get('message') or r)
            if r.get('errorcode') in ('AG8001', 'AG8002', 'AG8003') or 'token' in msg.lower():
                raise AuthError('Angel: ' + msg)
            raise BrokerError('Angel: ' + msg)
        return {x.get('symbolToken'): x for x in (r.get('data') or {}).get('fetched') or []}

    def chain(self, sym, n):
        self.load_master()
        lst = self.master.get(sym)
        if not lst:
            raise BrokerError(f'No {sym} options in the Angel scrip master.')
        today = today_ist().isoformat()
        exp = self.cfg.get('expiry_' + sym) or min(c[0] for c in lst if c[0] >= today)
        con = {(k, t): (tok, lot) for e, k, t, tok, lot in lst if e == exp}
        strikes = sorted({k for k, _ in con})
        if sym not in self.spot:
            self.spot[sym] = (self.quote([], [INDEX[sym]]).get(INDEX[sym]) or {}).get('ltp') or 0
        S = self.spot[sym]
        i = min(range(len(strikes)), key=lambda j: abs(strikes[j] - S))
        pick = strikes[max(0, i - n - 1): i + n + 2]
        toks = [con[(k, t)][0] for k in pick for t in ('CE', 'PE') if (k, t) in con]
        q = {}
        first = True
        for j in range(0, len(toks), 49):             # max 50 tokens per call, one slot for the index
            q.update(self.quote(toks[j:j + 49], [INDEX[sym]] if first else ()))
            first = False
            if j + 49 < len(toks):
                time.sleep(self.gap)
        ix = q.get(INDEX[sym]) or {}
        S = ix.get('ltp') or S
        self.spot[sym] = S
        prev = S - ix['netChange'] if ix.get('netChange') is not None else ix.get('close')
        rows, lot = [], None
        for k in pick:
            r = {'k': k}
            for t in ('CE', 'PE'):
                c = con.get((k, t))
                x = q.get(c[0]) if c else None
                lot = lot or (c[1] if c else None)
                if x:
                    ltp, nc = x.get('ltp'), x.get('netChange')
                    prev = ltp - nc if ltp is not None and nc is not None else x.get('close')
                    r[t.lower()] = leg(ltp, prev, x.get('opnInterest'), None, None, x.get('tradeVolume'))
                else:
                    r[t.lower()] = leg()
            rows.append(r)
        return {'spot': S, 'prev': prev, 'expiry': exp, 'lot': lot, 'rows': rows}
