"""Shared helpers for the Professor OI connector: HTTP, time, TOTP, option maths
and the chain normaliser. Standard library only, so nothing needs pip install."""
import base64, gzip, hashlib, hmac, json, math, os, ssl, struct, time, urllib.error, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone, date

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, 'cache')
IST = timezone(timedelta(hours=5, minutes=30))
UA = 'ProfessorOI-Connector/1.0'


class AuthError(Exception):
    """The broker rejected the token or login. The user has to log in again."""


class BrokerError(Exception):
    """Any other broker-side failure (bad request, rate limit, outage)."""


# Test hook: POI_FAKE_START="10:30" makes the connector believe the market is at 10:30 on the
# latest weekday, and POI_FAKE_SPEED=60 runs that clock 60x faster. Leave unset for real use.
_FAKE, _SPEED, _T0, _OFF = os.environ.get('POI_FAKE_START'), float(os.environ.get('POI_FAKE_SPEED') or 1), time.time(), None
if _FAKE:
    _h, _m = (int(x) for x in _FAKE.split(':'))
    _tg = datetime.now(IST).replace(hour=_h, minute=_m, second=0, microsecond=0)
    while _tg.weekday() >= 5:
        _tg -= timedelta(days=1)
    _OFF = _tg.timestamp() - _T0


def now_ts():
    t = time.time()
    return t if _OFF is None else _T0 + _OFF + (t - _T0) * _SPEED


def now_ist():
    return datetime.fromtimestamp(now_ts(), IST)


def today_ist():
    return now_ist().date()


def market_open(t=None):
    t = t or now_ist()
    if t.weekday() >= 5:
        return False
    m = t.hour * 60 + t.minute
    return 9 * 60 + 8 <= m <= 15 * 60 + 35


def _ssl_ctx():
    try:
        import certifi  # optional, fixes macOS python.org installs
        return ssl.create_default_context(cafile=certifi.where())
    except Exception:
        return ssl.create_default_context()


_CTX = _ssl_ctx()


def http(method, url, params=None, headers=None, body=None, form=None, timeout=12, raw=False):
    """Small urllib wrapper. body -> JSON, form -> url-encoded, or pass a str/bytes body.
    Returns parsed JSON (or text when raw=True). Raises AuthError on 401/403."""
    if params:
        url += ('&' if '?' in url else '?') + urllib.parse.urlencode(params, doseq=True)
    h = {'User-Agent': UA, 'Accept': 'application/json'}
    h.update(headers or {})
    data = None
    if body is not None:
        data = body if isinstance(body, (bytes, str)) else json.dumps(body)
        if isinstance(data, str):
            data = data.encode('utf-8')
        h.setdefault('Content-Type', 'application/json')
    elif form is not None:
        data = urllib.parse.urlencode(form).encode('utf-8')
        h.setdefault('Content-Type', 'application/x-www-form-urlencoded')
    req = urllib.request.Request(url, data=data, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_CTX) as r:
            txt = _text(r)
    except urllib.error.HTTPError as e:
        txt = _text(e)
        msg = short(txt) or e.reason
        if e.code in (401, 403):
            raise AuthError(f'HTTP {e.code}: {msg}')
        if e.code == 429:
            raise BrokerError('Rate limited by the broker (HTTP 429). Slowing down.')
        raise BrokerError(f'HTTP {e.code}: {msg}')
    except urllib.error.URLError as e:
        reason = str(getattr(e, 'reason', e))
        if 'CERTIFICATE_VERIFY_FAILED' in reason:
            raise BrokerError('SSL certificate check failed. On Mac run "Install Certificates.command" from your Python folder, or pip install certifi.')
        raise BrokerError(f'Network error: {reason}')
    if raw:
        return txt
    try:
        return json.loads(txt)
    except ValueError:
        raise BrokerError('Broker sent a non-JSON reply: ' + short(txt))


def _text(r):
    b = r.read()
    if (r.headers.get('Content-Encoding') or '').lower() == 'gzip' or b[:2] == b'\x1f\x8b':
        try:
            b = gzip.decompress(b)
        except OSError:
            pass
    return b.decode('utf-8', 'replace')


def short(txt, n=220):
    txt = (txt or '').strip().replace('\n', ' ')
    try:
        j = json.loads(txt)
        for k in ('message', 'Error', 'errorMessage', 'remarks', 'error_type', 'errors'):
            if isinstance(j, dict) and j.get(k):
                v = j[k]
                return (json.dumps(v) if not isinstance(v, str) else v)[:n]
    except ValueError:
        pass
    return txt[:n]


def totp(secret, step=30, digits=6, t=None):
    """RFC 6238 TOTP, same codes as Google Authenticator."""
    key = base64.b32decode(secret.replace(' ', '').upper() + '=' * (-len(secret.replace(' ', '')) % 8))
    ctr = struct.pack('>Q', int((t or time.time()) // step))
    h = hmac.new(key, ctr, hashlib.sha1).digest()
    o = h[-1] & 15
    return str((struct.unpack('>I', h[o:o + 4])[0] & 0x7fffffff) % 10 ** digits).zfill(digits)


def sha256(s):
    return hashlib.sha256(s.encode('utf-8')).hexdigest()


def num(x, default=0.0):
    try:
        v = float(x)
        return v if math.isfinite(v) else default
    except (TypeError, ValueError):
        return default


# ---- cache files (per trading day) ----
def cache_path(name):
    os.makedirs(CACHE, exist_ok=True)
    return os.path.join(CACHE, name)


def load_json(path, default=None):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, obj):
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(obj, f)
    os.replace(tmp, path)


# ---- option maths ----
def _ncdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bs_price(S, K, T, v, call, r=0.065):
    if T <= 0 or v <= 0:
        return max(0.0, S - K) if call else max(0.0, K - S)
    d1 = (math.log(S / K) + (r + v * v / 2) * T) / (v * math.sqrt(T))
    d2 = d1 - v * math.sqrt(T)
    if call:
        return S * _ncdf(d1) - K * math.exp(-r * T) * _ncdf(d2)
    return K * math.exp(-r * T) * _ncdf(-d2) - S * _ncdf(-d1)


def implied_vol(price, S, K, T, call):
    """Bisection IV in percent, or None when the price is below intrinsic."""
    if price <= 0 or S <= 0 or K <= 0 or T <= 0:
        return None
    intrinsic = max(0.0, S - K) if call else max(0.0, K - S)
    if price <= intrinsic + 0.05:
        return None
    lo, hi = 0.005, 3.0
    for _ in range(60):
        mid = (lo + hi) / 2
        if bs_price(S, K, T, mid, call) > price:
            hi = mid
        else:
            lo = mid
    v = (lo + hi) / 2 * 100
    return round(v, 2) if 0.6 < v < 290 else None


def last_close(t=None):
    """15:30 IST of the latest trading day at or before t (weekends skipped)."""
    t = t or now_ist()
    c = t.replace(hour=15, minute=30, second=0, microsecond=0)
    if t < c:
        c -= timedelta(days=1)
    while c.weekday() >= 5:
        c -= timedelta(days=1)
    return c


def years_to_expiry(expiry):
    """expiry 'YYYY-MM-DD' -> years until 15:30 IST that day (at least one hour).
    While the market is shut the clock is held at the last close, so IV does not drift."""
    try:
        d = date.fromisoformat(expiry)
    except (TypeError, ValueError):
        return 7 / 365
    end = datetime(d.year, d.month, d.day, 15, 30, tzinfo=IST)
    ref = now_ist() if market_open() else last_close()
    return max(3600.0, (end - ref).total_seconds()) / (365 * 86400)


# ---- normaliser ----
LEG = ('ltp', 'prev', 'oi', 'poi', 'oic', 'vol', 'iv')


def leg(ltp=0, prev=None, oi=0, poi=None, oic=None, vol=0, iv=None):
    return {'ltp': num(ltp), 'prev': None if prev in (None, '') else num(prev), 'oi': num(oi), 'poi': None if poi in (None, '') else num(poi),
            'oic': None if oic in (None, '') else num(oic), 'vol': num(vol), 'iv': None if iv in (None, '') else num(iv)}


class OIBase:
    """First OI seen today per contract, for brokers that do not send previous-day OI."""

    def __init__(self, broker):
        self.day = None
        self.broker = broker
        self.d = {}

    def get(self, key, oi):
        day = today_ist().isoformat()
        if day != self.day:
            self.day = day
            self.path = cache_path(f'oibase-{self.broker}-{day}.json')
            self.d = load_json(self.path, {}) or {}
            self.dirty = 0
        if key not in self.d and oi > 0:
            self.d[key] = oi
            self.dirty += 1
            if self.dirty >= 20:
                save_json(self.path, self.d)
                self.dirty = 0
        return self.d.get(key, oi)

    def flush(self):
        if self.day and getattr(self, 'dirty', 0):
            save_json(self.path, self.d)
            self.dirty = 0


def normalise(sym, raw, n, base, broker):
    """raw = {'spot', 'expiry', 'rows': [{'k', 'ce': leg, 'pe': leg}], 'lot'?}
    -> trimmed, gap-filled chain with summary numbers for the app."""
    spot = num(raw.get('spot'))
    rows = sorted((r for r in raw.get('rows', []) if num(r.get('k')) > 0), key=lambda r: r['k'])
    if not rows or spot <= 0:
        raise BrokerError(f'{sym}: broker returned an empty option chain')
    atm_i = min(range(len(rows)), key=lambda i: abs(rows[i]['k'] - spot))
    rows = rows[max(0, atm_i - n): atm_i + n + 1]
    T = years_to_expiry(raw.get('expiry'))
    since_start = False
    out = []
    for r in rows:
        k = num(r['k'])
        o = {'k': int(k) if k == int(k) else k}
        for side in ('ce', 'pe'):
            x = dict(r.get(side) or leg())
            if x.get('oic') is None:
                if x.get('poi') is not None:
                    x['oic'] = x['oi'] - x['poi']
                else:
                    x['oic'] = x['oi'] - base.get(f"{sym}|{raw.get('expiry')}|{r['k']}|{side}", x['oi'])
                    since_start = True
            iv = x.get('iv')
            if iv is not None and 0 < iv < 1.5:
                iv *= 100
            if not iv or iv <= 0:
                iv = implied_vol(x['ltp'], spot, r['k'], T, side == 'ce')
            x['iv'] = round(iv, 2) if iv else None
            x['chg'] = round(x['ltp'] - x['prev'], 2) if x.get('prev') else None
            x.pop('poi', None)
            x.pop('prev', None)
            for f in ('oi', 'oic', 'vol'):
                x[f] = int(round(x[f]))
            o[side] = x
        out.append(o)
    base.flush()
    ce = sum(r['ce']['oi'] for r in out)
    pe = sum(r['pe']['oi'] for r in out)
    cec = sum(r['ce']['oic'] for r in out)
    pec = sum(r['pe']['oic'] for r in out)
    atm = min(out, key=lambda r: abs(r['k'] - spot))
    # max pain: strike where option writers pay the least at expiry
    def pain(s):
        return sum(max(0, s - r['k']) * r['ce']['oi'] + max(0, r['k'] - s) * r['pe']['oi'] for r in out)
    mp = min(out, key=lambda r: pain(r['k']))['k']
    by_ce = sorted(out, key=lambda r: -r['ce']['oi'])
    by_pe = sorted(out, key=lambda r: -r['pe']['oi'])
    return {
        'sym': sym, 'broker': broker, 'ts': int(now_ts() * 1000), 'spot': round(spot, 2), 'expiry': raw.get('expiry'),
        'lot': raw.get('lot'), 'prev': num(raw.get('prev')) or None, 'rows': out, 'since_start': since_start,
        'sum': {'pcr': round(pe / ce, 3) if ce else None, 'ce_oi': ce, 'pe_oi': pe, 'ce_oic': cec, 'pe_oic': pec, 'atm': atm['k'],
                'straddle': round(atm['ce']['ltp'] + atm['pe']['ltp'], 2), 'max_pain': mp,
                'res': by_ce[0]['k'], 'res2': by_ce[1]['k'] if len(by_ce) > 1 else None,
                'sup': by_pe[0]['k'], 'sup2': by_pe[1]['k'] if len(by_pe) > 1 else None,
                'atm_iv': atm['ce']['iv'] or atm['pe']['iv']},
    }


def next_weekdays(start, days):
    """Weekdays from start, in date order, for `days` calendar days."""
    return [d for d in (start + timedelta(i) for i in range(days)) if d.weekday() < 5]
