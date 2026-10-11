"""Market alerts worked out on this PC from the live chain, sent to Telegram.

Kinds: support/resistance shifts (confirmed over 3 minutes), PCR crossing
1.25 / 0.80, spot testing a wall, and big buildups in F&O stocks. Alerts are
only raised while the market is open."""
import queue, threading, time
from core import AuthError, BrokerError, http, market_open, now_ist

KINDS = {'walls': 'Support / resistance shifts', 'pcr': 'PCR crossing 1.25 or 0.80', 'tests': 'Spot testing a wall', 'stocks': 'Big buildups in F&O stocks'}


def tg_send(token, chat, text):
    r = http('POST', f'https://api.telegram.org/bot{token}/sendMessage', body={'chat_id': chat, 'text': text, 'disable_web_page_preview': True})
    if not r.get('ok'):
        raise BrokerError('Telegram: ' + str(r.get('description') or r))


def tg_find_chat(token):
    """The chat that most recently messaged the bot: (chat_id, name) or (None, None)."""
    r = http('GET', f'https://api.telegram.org/bot{token}/getUpdates')
    for u in reversed(r.get('result') or []):
        m = u.get('message') or u.get('channel_post') or u.get('my_chat_member') or {}
        c = m.get('chat')
        if c:
            return c['id'], c.get('first_name') or c.get('title') or c.get('username') or ''
    return None, None


class Alerts:
    def __init__(self, cfg, save, log):
        self.cfg, self.save, self.log_fn = cfg, save, log
        self.st, self.log = {}, []
        self.q = queue.Queue(maxsize=100)
        threading.Thread(target=self._sender, daemon=True).start()

    # ---- settings ----
    @property
    def conf(self):
        return self.cfg.setdefault('alerts', {})

    def public(self):
        c = self.conf
        kinds = c.get('kinds') or {}
        return {'telegram': bool(c.get('telegram_token')), 'chat': bool(c.get('telegram_chat')), 'chat_name': c.get('chat_name', ''),
                'kinds': {k: kinds.get(k, True) for k in KINDS}, 'labels': KINDS, 'log': self.log[-30:]}

    def configure(self, d):
        c = self.conf
        tok = str(d.get('token') or '').strip()
        if tok:
            if ':' not in tok or len(tok) > 200:
                raise ValueError('That does not look like a Telegram bot token (it has the form 123456:ABC...).')
            c['telegram_token'], c['telegram_chat'], c['chat_name'] = tok, '', ''
        if d.get('clear'):
            c['telegram_token'] = c['telegram_chat'] = c['chat_name'] = ''
        if isinstance(d.get('kinds'), dict):
            c['kinds'] = {k: bool(d['kinds'].get(k, True)) for k in KINDS}
        self.save()

    def find_chat(self):
        tok = self.conf.get('telegram_token')
        if not tok:
            raise ValueError('Save the bot token first.')
        try:
            cid, name = tg_find_chat(tok)
        except AuthError:
            raise ValueError('Telegram rejected the bot token. Copy it again from @BotFather.')
        if not cid:
            raise ValueError('No message found. Open your bot in Telegram, press Start (or send "hi"), then try again.')
        self.conf['telegram_chat'], self.conf['chat_name'] = cid, name
        self.save()
        return name

    def test(self):
        c = self.conf
        if not (c.get('telegram_token') and c.get('telegram_chat')):
            raise ValueError('Connect Telegram first.')
        tg_send(c['telegram_token'], c['telegram_chat'], 'Professor OI: test alert. Alerts are working.')

    # ---- engine ----
    def _emit(self, kind, sym, text):
        if not (self.conf.get('kinds') or {}).get(kind, True):
            return
        item = {'t': int(time.time() * 1000), 'at': now_ist().strftime('%H:%M'), 'kind': kind, 'sym': sym, 'text': text, 'sent': False}
        self.log.append(item)
        del self.log[:-100]
        self.log_fn(f'Alert: {text}')
        if self.conf.get('telegram_token') and self.conf.get('telegram_chat'):
            try:
                self.q.put_nowait(item)
            except queue.Full:
                pass

    def _sender(self):
        while True:
            item = self.q.get()
            c = self.conf
            try:
                tg_send(c['telegram_token'], c['telegram_chat'], f"{item['at']} · {item['text']}")
                item['sent'] = True
            except Exception as e:
                item['error'] = str(e)[:120]
            time.sleep(1.1)                                  # stay well under Telegram's rate limit

    def on_chain(self, c):
        if not market_open():
            return
        sym, rows, S = c['sym'], c['rows'], c['spot']
        if len(rows) < 3:
            return
        step = abs(rows[1]['k'] - rows[0]['k']) or 1
        st = self.st.setdefault(sym, {'pcr': None, 'walls': {}, 'test': {}})
        m = int(c['ts'] // 60000)
        # PCR crossing, with a dead band so it does not chatter
        pcr = c['sum'].get('pcr')
        if pcr:
            z = 1 if pcr > 1.25 else -1 if pcr < 0.8 else 0 if 0.95 < pcr < 1.1 else st['pcr']
            if st['pcr'] is not None and z and z != st['pcr']:
                self._emit('pcr', sym, f"{sym} PCR {'crossed above 1.25' if z > 0 else 'fell below 0.80'} (now {pcr:.2f})")
            st['pcr'] = z if z is not None else st['pcr']
        # walls: the strike with the most fresh writing, confirmed for 3 minutes
        for side, leg, name in (('S', 'pe', 'support'), ('R', 'ce', 'resistance')):
            fresh = max(rows, key=lambda r: r[leg]['oic'])
            k = fresh['k'] if fresh[leg]['oic'] > 0 else max(rows, key=lambda r: r[leg]['oi'])['k']
            w = st['walls'].setdefault(side, {'cur': k, 'cand': None, 'since': m})
            if k == w['cur']:
                w['cand'] = None
            elif k != w['cand']:
                w['cand'], w['since'] = k, m
            elif m - w['since'] >= 3:
                self._emit('walls', sym, f"{sym} {name} moved {'up' if k > w['cur'] else 'down'} {w['cur']:g} -> {k:g}")
                w['cur'], w['cand'] = k, None
            lvl = w['cur']
            if abs(S - lvl) <= 0.25 * step and m - st['test'].get(side, -999) > 30:
                st['test'][side] = m
                self._emit('tests', sym, f"{sym} spot {S:,.2f} testing {name} {lvl:g}")

    def on_stocks(self, items):
        if not market_open():
            return
        seen = self.st.setdefault('_stk', {'day': None, 'done': set()})
        day = now_ist().date().isoformat()
        if seen['day'] != day:
            seen['day'], seen['done'] = day, set()
        for s, ltp, prev, oi, oic, vol, lot in items:
            if not prev or not oi or s in seen['done'] or s in ('NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'):
                continue
            p, oc = (ltp / prev - 1) * 100, oic / max(1, oi - oic) * 100
            if abs(p) >= 2 and oc >= 5:
                seen['done'].add(s)
                self._emit('stocks', s, f"{s} {'long' if p > 0 else 'short'} buildup: price {p:+.1f}%, OI {oc:+.1f}%")
