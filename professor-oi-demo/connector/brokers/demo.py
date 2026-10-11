"""Demo broker: a synthetic chain so the whole pipeline (login, polling, live page)
can be tried without any API keys."""
import math, random, time
from datetime import timedelta
from core import AuthError, bs_price, leg, market_open, today_ist
from . import Adapter

SPEC = {'NIFTY': (25150.0, 50, 65), 'BANKNIFTY': (56300.0, 100, 30), 'FINNIFTY': (26700.0, 50, 60), 'MIDCPNIFTY': (13100.0, 25, 120)}


class Demo(Adapter):
    id = 'demo'
    name = 'Demo broker (no keys)'
    login_kind = 'redirect'
    gap = 0.6
    symbols = tuple(SPEC)

    def __init__(self, cfg, redirect_url):
        super().__init__(cfg, redirect_url)
        self.st = {}
        if self.cfg.get('mode') == 'direct':      # lets you try the TOTP-style login form too
            self.login_kind = 'direct'

    def direct_fields(self):
        return [['totp', '6-digit TOTP (demo: 123456)', 'text']]

    def direct_login(self, form):
        if str(form.get('totp', '')).strip() != '123456':
            raise AuthError('Demo TOTP is 123456')
        self.token, self.user = 'demo', 'DEMO01'

    def login_url(self):
        return self.redirect_url + '?request_token=demo-token&status=success'

    def finish_login(self, params):
        if params.get('request_token') != 'demo-token':
            raise AuthError('Demo login expects request_token=demo-token')
        self.token, self.user = 'demo', 'DEMO01'

    stocks_supported = True
    stocks_gap = 5
    NAMES = tuple(('RELIANCE HDFCBANK ICICIBANK INFY TCS BHARTIARTL ITC LT SBIN AXISBANK KOTAKBANK HINDUNILVR BAJFINANCE MARUTI SUNPHARMA HCLTECH TITAN NTPC '
             'ULTRACEMCO TATAMOTORS POWERGRID ONGC ADANIPORTS ASIANPAINT TATASTEEL COALINDIA BAJAJFINSV NESTLEIND JSWSTEEL WIPRO GRASIM TECHM HINDALCO CIPLA '
             'DRREDDY SBILIFE HDFCLIFE INDUSINDBK BANKBARODA PNB CANBK FEDERALBNK IDFCFIRSTB AUBANK DLF VEDL TATAPOWER BEL HAL IRCTC ZOMATO').split())

    def stocks(self):
        if not self.token:
            raise AuthError('Not logged in')
        st = self.st.setdefault('_stk', {})
        r = random.Random(7 if not st else None)
        moving = market_open() or self.cfg.get('always_moving')
        out = []
        for i, n in enumerate(self.NAMES + ('NIFTY', 'BANKNIFTY')):
            if n not in st:
                g = random.Random(n)
                px = SPEC[n][0] * 1.002 if n in SPEC else round(80 + g.random() * 3500, 1)
                st[n] = {'px': px, 'prev': px * (1 + g.gauss(0, 0.012)), 'oi': g.randint(20, 400) * 1e5, 'vol': 0.0, 'd': g.gauss(0, 0.0006), 'o': g.gauss(0, 0.002)}
            x = st[n]
            if moving:
                x['px'] *= 1 + x['d'] + r.gauss(0, 0.0012)
                x['oi'] *= 1 + x['o'] + r.gauss(0, 0.0015)
                x['vol'] += x['oi'] * abs(r.gauss(0.004, 0.003))
            out.append({'s': n, 'ltp': round(x['px'], 2), 'prev': round(x['prev'], 2), 'oi': round(x['oi']), 'vol': round(x['vol']), 'lot': SPEC[n][2] if n in SPEC else 500})
        return out

    def chain(self, sym, n):
        if not self.token:
            raise AuthError('Not logged in')
        s0, step, lot = SPEC.get(sym, SPEC['NIFTY'])
        st = self.st.setdefault(sym, {'S': s0, 'oi': {}, 'r': random.Random(sym)})
        r = st['r']
        moving = market_open() or self.cfg.get('always_moving')   # like a real broker: frozen after the close
        if moving:
            st['S'] *= 1 + r.gauss(0, 0.00035)
        S = st['S']
        exp = today_ist() + timedelta((1 - today_ist().weekday()) % 7)
        T = max(1, (exp - today_ist()).days + 0.4) / 365
        atm = round(S / step) * step
        rows = []
        for i in range(-n - 2, n + 3):
            k = atm + i * step
            for side in ('ce', 'pe'):
                key = (k, side)
                if key not in st['oi']:
                    far = abs(k - s0) / step
                    st['oi'][key] = [max(5e4, 9e6 * math.exp(-far / 7) * (0.6 + r.random())) * (1.1 if (side == 'ce') == (k > s0) else 0.8)] * 2
                o = st['oi'][key]
                if moving:
                    o[0] = max(0.0, o[0] * (1 + r.gauss(0.0004, 0.004)))
            iv = 0.12 + 0.0009 * abs(k - S) / step
            c, p = bs_price(S, k, T, iv, True), bs_price(S, k, T, iv, False)
            rows.append({'k': k,
                         'ce': leg(round(c, 2), round(c * 1.04 + 1, 2), round(st['oi'][(k, 'ce')][0] / lot) * lot, st['oi'][(k, 'ce')][1], None, int(st['oi'][(k, 'ce')][0] * 3.1)),
                         'pe': leg(round(p, 2), round(p * 0.97 + 1, 2), round(st['oi'][(k, 'pe')][0] / lot) * lot, st['oi'][(k, 'pe')][1], None, int(st['oi'][(k, 'pe')][0] * 2.8))})
        time.sleep(0.05)
        return {'spot': S, 'prev': round(s0 * 0.9968, 2), 'expiry': exp.isoformat(), 'lot': lot, 'rows': rows}
