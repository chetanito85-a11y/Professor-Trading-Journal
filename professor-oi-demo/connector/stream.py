"""Fast feed: a broker WebSocket that streams ticks between the REST option-chain
calls. The REST chain stays the source of structure (strikes, IV, previous
close); ticks overwrite LTP, OI and volume when they are newer and look sane."""
import json, random, struct, threading, time
from core import log_safe, market_open
from ws import WSClient, WSClosed


class Stream(threading.Thread):
    daemon = True
    name_ = 'stream'

    def __init__(self):
        super().__init__()
        self.ticks, self.want, self.sent = {}, set(), set()
        self.state, self.msg, self.count, self.rate = 'connecting', '', 0, 0.0
        self.stop_flag, self.lock = False, threading.Lock()
        self.ws = None

    # keys to stream; new ones are sent on the open socket, all of them after a reconnect
    def subscribe(self, keys):
        with self.lock:
            self.want |= set(keys)

    def tick(self, key, **kw):
        t = self.ticks.get(key) or {}
        t.update({k: v for k, v in kw.items() if v is not None})
        t['ts'] = time.time()
        self.ticks[key] = t
        self.count += 1

    def run(self):
        delay = 2
        while not self.stop_flag:
            try:
                self.state, self.msg = 'connecting', ''
                self.ws = self.open()
                self.sent = set()
                self.state, delay = 'live', 2
                last_n, last_t = self.count, time.time()
                while not self.stop_flag:
                    with self.lock:
                        new = self.want - self.sent
                    if new:
                        self.send_subs(sorted(new))
                        self.sent |= new
                    kind, data = self.ws.recv()
                    if kind == 'binary':
                        self.on_binary(data)
                    else:
                        self.on_text(data)
                    if time.time() - last_t >= 5:
                        self.rate, last_n, last_t = (self.count - last_n) / (time.time() - last_t), self.count, time.time()
            except Exception as e:
                if self.stop_flag:
                    break
                self.state, self.msg = 'error', str(e)[:160]
                log_safe(f'Fast feed: {self.msg}. Reconnecting in {delay}s (REST keeps working).')
            finally:
                if self.ws:
                    self.ws.close()
            time.sleep(delay)
            delay = min(60, delay * 2)
        self.state = 'off'

    def stop(self):
        self.stop_flag = True
        if self.ws:
            self.ws.close()

    # subclasses
    def open(self):
        raise NotImplementedError

    def send_subs(self, keys):
        raise NotImplementedError

    def on_binary(self, data):
        pass

    def on_text(self, text):
        pass


class KiteStream(Stream):
    """Zerodha Kite ticker: wss://ws.kite.trade, big-endian packets, prices in paise."""
    def __init__(self, api_key, token, url='wss://ws.kite.trade'):
        super().__init__()
        self.url = f'{url}?api_key={api_key}&access_token={token}'

    def open(self):
        ws = WSClient(self.url)
        ws.connect()
        return ws

    def send_subs(self, keys):
        toks = [int(k) for k in keys]
        self.ws.send_text(json.dumps({'a': 'subscribe', 'v': toks}))
        self.ws.send_text(json.dumps({'a': 'mode', 'v': ['full', toks]}))

    def on_text(self, text):
        try:
            m = json.loads(text)
        except ValueError:
            return
        if m.get('type') == 'error':
            self.msg = str(m.get('data'))[:160]

    def on_binary(self, b):
        if len(b) < 2:
            return                                         # heartbeat
        n, j = struct.unpack('>H', b[0:2])[0], 2
        for _ in range(n):
            ln = struct.unpack('>H', b[j:j + 2])[0]
            p, j = b[j + 2:j + 2 + ln], j + 2 + ln
            if len(p) < 8:
                continue
            tok = struct.unpack('>I', p[0:4])[0]
            seg = tok & 0xff
            div = 10000000.0 if seg == 3 else 10000.0 if seg in (6, 12) else 100.0
            u = lambda a, z: struct.unpack('>I', p[a:z])[0]
            if len(p) == 8:
                self.tick(str(tok), ltp=u(4, 8) / div)
            elif len(p) in (28, 32):                       # index
                self.tick(str(tok), ltp=u(4, 8) / div, close=u(20, 24) / div)
            elif len(p) in (44, 184):
                self.tick(str(tok), ltp=u(4, 8) / div, vol=u(16, 20), close=u(40, 44) / div, oi=u(48, 52) if len(p) == 184 else None)


class DhanStream(Stream):
    """DhanHQ v2 market feed: wss://api-feed.dhan.co, little-endian packets, float prices."""
    def __init__(self, client_id, token, url='wss://api-feed.dhan.co'):
        super().__init__()
        self.url = f'{url}?version=2&token={token}&clientId={client_id}&authType=2'

    def open(self):
        ws = WSClient(self.url)
        ws.connect()
        return ws

    def send_subs(self, keys):
        by = {}
        for k in keys:                                     # key = "SEGMENT:securityId"
            seg, sid = k.split(':', 1)
            by.setdefault(seg, []).append(sid)
        for seg, ids in by.items():
            code = 15 if seg == 'IDX_I' else 21            # ticker for indices, full for options
            for i in range(0, len(ids), 100):
                part = ids[i:i + 100]
                self.ws.send_text(json.dumps({'RequestCode': code, 'InstrumentCount': len(part),
                                              'InstrumentList': [{'ExchangeSegment': seg, 'SecurityId': x} for x in part]}))

    SEGS = {0: 'IDX_I', 1: 'NSE_EQ', 2: 'NSE_FNO'}

    def on_binary(self, b):
        j = 0
        while j + 8 <= len(b):
            code, ln, seg, sid = struct.unpack('<BHBI', b[j:j + 8])
            p = b[j:j + max(ln, 8)]
            key = f"{self.SEGS.get(seg, seg)}:{sid}"
            if code == 2 and len(p) >= 16:
                self.tick(key, ltp=struct.unpack('<f', p[8:12])[0])
            elif code == 4 and len(p) >= 50:
                q = struct.unpack('<BHBIfHIfIIIffff', p[:50])
                self.tick(key, ltp=q[4], vol=q[8])
            elif code == 5 and len(p) >= 12:
                self.tick(key, oi=struct.unpack('<I', p[8:12])[0])
            elif code == 6 and len(p) >= 16:
                self.tick(key, close=struct.unpack('<f', p[8:12])[0], prev_oi=struct.unpack('<I', p[12:16])[0])
            elif code == 8 and len(p) >= 62:
                q = struct.unpack('<BHBIfHIfIIIIIIffff', p[:62])
                self.tick(key, ltp=q[4], vol=q[8], oi=q[11])
            elif code == 50:
                self.msg = 'server asked to disconnect'
            if ln <= 0:
                break
            j += ln


class DemoStream(Stream):
    """No network: wiggles the subscribed prices so the fast path can be tried without keys."""
    def __init__(self, base):
        super().__init__()
        self.base = base                                   # key -> (ltp, oi)

    def open(self):
        class Fake:
            def __init__(s, me):
                s.me = me

            def recv(s):
                time.sleep(0.25)
                if market_open() or s.me.base.get('_always'):
                    for k in list(s.me.sent)[:40]:
                        b = s.me.base.get(k)
                        if b:
                            s.me.tick(k, ltp=round(b[0] * (1 + random.gauss(0, 0.002)), 2), oi=b[1])
                return ('binary', b'')

            def close(s):
                pass
        return Fake(self)

    def send_subs(self, keys):
        pass


def overlay(raw, keymap, ticks, since):
    """Copy of a raw chain with fresher, sane ticks applied. Returns (chain, applied_count)."""
    if not keymap:
        return raw, 0
    out = dict(raw)
    n = 0
    sk = keymap.get('spot')
    t = ticks.get(sk) if sk else None
    if t and t['ts'] > since and t.get('ltp') and raw.get('spot') and abs(t['ltp'] / raw['spot'] - 1) < 0.1:
        out['spot'] = t['ltp']
        n += 1
    legs = keymap.get('legs') or {}
    rows = []
    for r in raw['rows']:
        r2 = {'k': r['k']}
        for side in ('ce', 'pe'):
            leg = dict(r[side])
            t = ticks.get(legs.get((r['k'], side)))
            if t and t['ts'] > since:
                if t.get('ltp') and (not leg['ltp'] or 0.2 < t['ltp'] / leg['ltp'] < 5):
                    leg['ltp'] = t['ltp']
                    n += 1
                if t.get('oi') and (not leg['oi'] or 0.5 < t['oi'] / leg['oi'] < 2):
                    leg['oi'] = t['oi']
                if t.get('vol') and t['vol'] >= leg['vol']:
                    leg['vol'] = t['vol']
            r2[side] = leg
        rows.append(r2)
    out['rows'] = rows
    return out, n
