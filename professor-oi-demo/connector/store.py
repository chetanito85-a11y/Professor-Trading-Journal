"""Minute-by-minute history of every option chain, in SQLite on this PC.

One row per (day, symbol, minute since 09:15). The app rebuilds the whole
trading day from it, so every page can show real intraday data and any stored
day can be replayed later."""
import json, os, sqlite3, threading
from core import CACHE, market_open, now_ist

N = 375          # minutes 09:15 -> 15:30


def minute_of(t):
    return max(0, min(N, t.hour * 60 + t.minute - 555))


class Store:
    def __init__(self, path=None):
        os.makedirs(CACHE, exist_ok=True)
        self.path = path or os.path.join(CACHE, 'history.db')
        self.db = sqlite3.connect(self.path, check_same_thread=False)
        self.lock = threading.Lock()
        self.hl = {}                                   # (day, sym, m) -> [hi, lo] of spot within the minute
        with self.lock:
            self.db.execute('PRAGMA journal_mode=WAL')
            self.db.execute('CREATE TABLE IF NOT EXISTS snap (day TEXT, sym TEXT, m INTEGER, ts INTEGER, spot REAL, hi REAL, lo REAL, rows TEXT, PRIMARY KEY (day, sym, m))')
            self.db.execute('CREATE TABLE IF NOT EXISTS meta (day TEXT, sym TEXT, expiry TEXT, lot INTEGER, prev REAL, broker TEXT, PRIMARY KEY (day, sym))')
            self.db.execute('CREATE TABLE IF NOT EXISTS stk (day TEXT, m INTEGER, ts INTEGER, rows TEXT, PRIMARY KEY (day, m))')
            self.db.commit()

    @staticmethod
    def pack(c):
        """Chain rows -> compact arrays: k, then ltp, oi, oic, vol, iv, chg for CE and for PE."""
        out = []
        for r in c['rows']:
            row = [r['k']]
            for s in ('ce', 'pe'):
                x = r[s]
                row += [x['ltp'], x['oi'], x['oic'], x['vol'], x['iv'], x['chg']]
            out.append(row)
        return out

    def put(self, c, broker):
        """Save a normalised chain into the current minute. Only during market hours."""
        t = now_ist()
        if not market_open(t):
            return
        day, m, sym, S = t.date().isoformat(), minute_of(t), c['sym'], c['spot']
        key = (day, sym, m)
        hl = self.hl.get(key)
        hl = [max(hl[0], S), min(hl[1], S)] if hl else [S, S]
        self.hl = {k: v for k, v in self.hl.items() if k[2] >= m - 1}
        self.hl[key] = hl
        with self.lock:
            self.db.execute('INSERT OR REPLACE INTO snap VALUES (?,?,?,?,?,?,?,?)', (day, sym, m, c['ts'], S, hl[0], hl[1], json.dumps(self.pack(c), separators=(',', ':'))))
            self.db.execute('INSERT OR REPLACE INTO meta VALUES (?,?,?,?,?,?)', (day, sym, c.get('expiry'), c.get('lot'), c.get('prev'), broker))
            self.db.commit()

    def put_stocks(self, ts, items):
        """items: [[s, ltp, prev, oi, oic, vol, lot], ...] for the current minute."""
        t = now_ist()
        if not market_open(t):
            return
        with self.lock:
            self.db.execute('INSERT OR REPLACE INTO stk VALUES (?,?,?,?)', (t.date().isoformat(), minute_of(t), ts, json.dumps(items, separators=(',', ':'))))
            self.db.commit()

    def stocks_day(self, day=None):
        with self.lock:
            if not day:
                r = self.db.execute('SELECT MAX(day) FROM stk').fetchone()
                day = r[0] if r else None
            if not day:
                return None
            rows = self.db.execute('SELECT m, ts, rows FROM stk WHERE day=? ORDER BY m', (day,)).fetchall()
        return {'day': day, 'minutes': [[m, ts, json.loads(rw)] for m, ts, rw in rows]} if rows else None

    def days(self):
        with self.lock:
            cur = self.db.execute('SELECT day, sym, COUNT(*), MIN(m), MAX(m) FROM snap GROUP BY day, sym ORDER BY day DESC, sym')
            return [{'day': d, 'sym': s, 'minutes': n, 'from': a, 'to': b} for d, s, n, a, b in cur.fetchall()]

    def prev_close(self, sym, day):
        """Last stored spot of the trading day before `day` (fallback for the index's previous close)."""
        with self.lock:
            r = self.db.execute('SELECT spot FROM snap WHERE sym=? AND day<? ORDER BY day DESC, m DESC LIMIT 1', (sym, day)).fetchone()
        return r[0] if r else None

    def day(self, sym, day=None):
        with self.lock:
            if not day:
                r = self.db.execute('SELECT MAX(day) FROM snap WHERE sym=?', (sym,)).fetchone()
                day = r[0] if r else None
            if not day:
                return None
            rows = self.db.execute('SELECT m, ts, spot, hi, lo, rows FROM snap WHERE day=? AND sym=? ORDER BY m', (day, sym)).fetchall()
            meta = self.db.execute('SELECT expiry, lot, prev, broker FROM meta WHERE day=? AND sym=?', (day, sym)).fetchone()
        if not rows:
            return None
        expiry, lot, prev, broker = meta or (None, None, None, None)
        return {'sym': sym, 'day': day, 'expiry': expiry, 'lot': lot, 'prev': prev or self.prev_close(sym, day), 'broker': broker,
                'minutes': [[m, ts, spot, hi, lo, json.loads(rw)] for m, ts, spot, hi, lo, rw in rows]}
