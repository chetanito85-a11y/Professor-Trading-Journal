#!/usr/bin/env python3
"""Professor OI Connector

Runs on your own PC. It logs in to your broker, polls the option chain, and
streams it to the Professor OI app at http://127.0.0.1:8765.

Pick your broker on the app's Broker page and type its details there. They
are sent only to this program on 127.0.0.1 and saved in connector/config.json
on this PC; the page never reads them back. The page only gets chain numbers.

    python server.py                 start (opens the app in your browser)
    python server.py --broker demo   try it without any keys
"""
import argparse, json, os, queue, shutil, sys, threading, time, traceback, urllib.parse, webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import core  # noqa: E402
from core import AuthError, BrokerError, cache_path, load_json, normalise, save_json, today_ist  # noqa: E402
import brokers  # noqa: E402
from store import N as MINUTES, Store  # noqa: E402
from alerts import Alerts  # noqa: E402

VERSION = '1.0'
APP = os.path.join(os.path.dirname(HERE), 'index.html')
CONFIG = os.path.join(HERE, 'config.json')
SESSION = os.path.join(HERE, 'session.json')


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def load_config(path):
    if not os.path.exists(path):
        ex = os.path.join(HERE, 'config.example.json')
        if os.path.exists(ex):
            shutil.copy(ex, path)
            log('Created connector/config.json. Choose your broker on the Broker page.')
    try:
        with open(path, encoding='utf-8-sig') as f:
            return json.load(f)
    except FileNotFoundError:
        return {'broker': ''}
    except ValueError as e:
        sys.exit(f'config.json has a typo: {e}\nCheck commas and quotes near that line, then start again.')


class Hub:
    """Shared state: config, the active broker, login status, latest chains,
    minute history and the SSE clients. The broker can be switched at runtime."""

    def __init__(self, cfg, cfg_path, redirect):
        self.cfg, self.cfg_path, self.redirect = cfg, cfg_path, redirect
        self.lock = threading.Lock()
        self.alock = threading.RLock()            # one broker call at a time
        self.clients = []
        self.state, self.msg = 'starting', ''
        self.calls = self.errors = 0
        self.started = time.time()
        self.wake = threading.Event()
        self.a = None
        self.store = Store()
        self.stocks, self.stk_base = None, None
        self.alerts = Alerts(cfg, self.save_config, log)

    def use(self, bid):
        """Make `bid` the active broker (reads its section from config) and log in if possible."""
        A = brokers.load(bid)
        with self.alock:
            self.a = A(self.cfg.get(A.id) or {}, self.redirect)
            self.syms = [s for s in (self.cfg.get('symbols') or ['NIFTY', 'BANKNIFTY']) if s in A.symbols] or ['NIFTY']
            self.chains, self.hist = {}, {}
            day = today_ist().isoformat()
            for s in self.syms:
                self.hist[s] = load_json(self.hist_path(s, day), []) or []
            self.base = core.OIBase(A.id)
            self.stk_base = core.OIBase(A.id + '-stk')
            self.stocks = None
            self.calls = self.errors = 0
        self.boot()
        self.wake.set()

    def boot(self):
        a = self.a
        if a.id == 'none':
            return self.set('need_setup', 'Pick your broker below and click Connect.')
        if a.missing():
            return self.set('need_config', f'Enter your {a.name} details: click Connect on the {a.name} card.')
        if self.restore():
            return
        if a.login_kind == 'direct' and not a.direct_fields():
            try:
                with self.alock:
                    a.direct_login({})
                return self.logged_in('direct')
            except Exception as e:
                a.token = None
                return self.set('need_login', str(e))
        self.set('need_login', f'Click "Login with {a.name}".')

    def setup(self, bid, values, clear):
        """Save details typed on the Broker page into config.json, then switch to that broker."""
        A = brokers.load(bid)
        allowed = {f['k'] for f in A.fields}
        sec = dict(self.cfg.get(A.id) or {})
        for k, v in (values or {}).items():
            v = str(v if v is not None else '').strip()
            if k in allowed and v:
                if len(v) > 800:
                    raise ValueError(f'{k} is too long')
                sec[k] = v
        for k in clear or []:
            if k in allowed:
                sec[k] = ''
        if A.id != 'none':
            self.cfg[A.id] = sec
        self.cfg['broker'] = A.id
        self.save_config()
        if self.a and self.a.id == A.id:          # same broker, new details: drop the old login
            try:
                os.remove(SESSION)
            except OSError:
                pass
        log(f'Saved {A.name} details to config.json.')
        self.use(A.id)

    def save_config(self):
        tmp = self.cfg_path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(self.cfg, f, indent=2, ensure_ascii=False)
        os.replace(tmp, self.cfg_path)

    def catalog(self):
        """Broker list with field specs for the setup form. Saved values are never sent, only whether they exist."""
        out = []
        for bid in brokers.ALL:
            A = brokers.load(bid)
            sec = self.cfg.get(A.id) or {}
            out.append({'id': A.id, 'name': A.name, 'redirect': A.redirect_needed, 'fields': [dict(f, saved=bool(str(sec.get(f['k'], '')).strip())) for f in A.fields]})
        return {'current': self.a.id, 'redirect_url': self.redirect, 'brokers': out}

    def hist_path(self, sym, day):
        return cache_path(f'hist-{self.a.id}-{day}-{sym}.json')

    def status(self):
        a = self.a
        return {'app': 'professor-oi-connector', 'version': VERSION, 'broker': a.id, 'broker_name': a.name, 'setup': True,
                'login_kind': a.login_kind, 'state': self.state, 'msg': self.msg, 'user': a.user,
                'missing': a.missing(), 'fields': a.direct_fields() if a.login_kind == 'direct' else [],
                'symbols': self.syms, 'redirect_url': a.redirect_url, 'market_open': core.market_open(),
                'stocks': a.stocks_supported, 'calls': self.calls, 'errors': self.errors, 'gap': a.gap, 'started': int(self.started * 1000), 'now': int(core.now_ts() * 1000),
                'last': {s: c['ts'] for s, c in self.chains.items()}}

    def set(self, state, msg=''):
        changed = (state, msg) != (self.state, self.msg)
        self.state, self.msg = state, msg
        if changed:
            log(f'[{state}] {msg}' if msg else f'[{state}]')
            self.broadcast('status', self.status())

    def publish(self, c):
        s = c['sym']
        self.chains[s] = c
        try:
            self.store.put(c, self.a.id)
        except Exception as e:                    # history is a bonus; never stop the live feed for it
            log(f'History not saved: {e}')
        sm = c['sum']
        pt = {'t': c['ts'], 's': c['spot'], 'pcr': sm['pcr'], 'ce': sm['ce_oi'], 'pe': sm['pe_oi'], 'cc': sm['ce_oic'], 'pc': sm['pe_oic'],
              'mp': sm['max_pain'], 'sup': sm['sup'], 'res': sm['res'], 'iv': sm['atm_iv'], 'sd': sm['straddle']}
        h = self.hist.setdefault(s, [])
        if h and h[-1]['t'] // 60000 == pt['t'] // 60000:
            h[-1] = pt
        else:
            h.append(pt)
            del h[:-450]
            if len(h) % 5 == 0:
                save_json(self.hist_path(s, today_ist().isoformat()), h)
        try:
            self.alerts.on_chain(c)
        except Exception as e:
            log(f'Alert check failed: {e}')
        self.broadcast('chain', c)
        self.broadcast('point', {'sym': s, 'pt': pt})
        self.broadcast('stats', {'calls': self.calls, 'errors': self.errors, 'market_open': core.market_open(), 'now': int(core.now_ts() * 1000)})

    def publish_stocks(self, raw):
        """raw: adapter list -> compact rows with OI change (vs the first reading today) for the app, history and alerts."""
        rows = []
        for x in raw:
            oi = core.num(x.get('oi'))
            rows.append([x['s'], round(core.num(x.get('ltp')), 2), round(core.num(x.get('prev')), 2) or None, int(oi),
                         int(oi - self.stk_base.get('stk|' + x['s'], oi)), int(core.num(x.get('vol'))), x.get('lot')])
        self.stk_base.flush()
        ts = int(core.now_ts() * 1000)
        self.stocks = {'ts': ts, 'items': rows}
        try:
            self.store.put_stocks(ts, rows)
        except Exception as e:
            log(f'Stock history not saved: {e}')
        try:
            self.alerts.on_stocks(rows)
        except Exception as e:
            log(f'Stock alert check failed: {e}')
        self.broadcast('stocks', self.stocks)

    def broadcast(self, ev, data):
        msg = f'event: {ev}\ndata: {json.dumps(data, separators=(",", ":"))}\n\n'.encode('utf-8')
        with self.lock:
            for q in list(self.clients):
                try:
                    q.put_nowait(msg)
                except queue.Full:
                    pass

    def subscribe(self):
        q = queue.Queue(maxsize=200)
        with self.lock:
            self.clients.append(q)
        return q

    def unsubscribe(self, q):
        with self.lock:
            if q in self.clients:
                self.clients.remove(q)

    # ---- login / session ----
    def logged_in(self, how):
        save_json(SESSION, {'broker': self.a.id, 'day': today_ist().isoformat(), **self.a.session()})
        log(f'Logged in to {self.a.name} ({how}){" as " + str(self.a.user) if self.a.user else ""}.')
        self.set('connecting', 'Logged in. Fetching the first option chain...')
        self.wake.set()

    def logout(self, why=''):
        self.a.token = None
        try:
            os.remove(SESSION)
        except OSError:
            pass
        self.set('need_login', why)

    def restore(self):
        s = load_json(SESSION, {}) or {}
        if s.get('broker') == self.a.id and s.get('day') == today_ist().isoformat() and s.get('token'):
            self.a.restore(s)
            log('Reusing today\'s saved login.')
            self.set('connecting', 'Using today\'s saved login...')
            return True
        return False


class Poller(threading.Thread):
    daemon = True

    def __init__(self, hub, n, slow):
        super().__init__()
        self.hub, self.n, self.slow = hub, n, slow
        self.last_stk, self.stk_err = 0.0, ''

    def run(self):
        h = self.hub
        backoff = 0
        while True:
            a, syms, base = h.a, list(h.syms), h.base
            if not a.logged_in:
                h.wake.wait(2)
                h.wake.clear()
                continue
            for sym in syms:
                if h.a is not a or not a.logged_in:
                    break
                try:
                    with h.alock:
                        if h.a is not a:
                            break
                        raw = a.chain(sym, self.n)
                    h.calls += 1
                    c = normalise(sym, raw, self.n, base, a.id)
                    if h.a is a:
                        h.publish(c)
                        h.set('live', '')
                    backoff = 0
                except AuthError as e:
                    h.errors += 1
                    if h.a is a:
                        h.logout(f'Login expired or rejected: {e}. Log in again.')
                    break
                except Exception as e:
                    h.errors += 1
                    backoff = min(60, backoff * 2 or 3)
                    msg = str(e) if isinstance(e, BrokerError) else f'{type(e).__name__}: {e}'
                    if h.a is a:
                        h.set('error', f'{sym}: {msg} (retrying in {backoff}s)')
                    if not isinstance(e, BrokerError):
                        traceback.print_exc()
                    time.sleep(backoff)
                time.sleep(a.gap if core.market_open() else max(a.gap, self.slow))
            self.poll_stocks(a)

    def poll_stocks(self, a):
        h = self.hub
        due = a.stocks_gap if core.market_open() else 300
        if not (a.stocks_supported and a.logged_in and h.a is a) or time.time() - self.last_stk < due:
            return
        self.last_stk = time.time()
        try:
            with h.alock:
                if h.a is not a:
                    return
                raw = a.stocks()
            if h.a is a:
                h.publish_stocks(raw)
            self.stk_err = ''
        except AuthError as e:
            if h.a is a:
                h.logout(f'Login expired or rejected: {e}. Log in again.')
        except Exception as e:
            msg = str(e) if isinstance(e, BrokerError) else f'{type(e).__name__}: {e}'
            if msg != self.stk_err:
                log(f'F&O stocks not updated: {msg}')
                self.stk_err = msg
        time.sleep(a.gap)


PAGE = '''<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Professor OI Connector</title><meta http-equiv="refresh" content="{wait};url=/#{to}">
<style>body{{font:15px/1.5 system-ui,sans-serif;background:#000;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}}
div{{max-width:520px;padding:24px;border:1px solid #333;border-radius:10px}}b{{color:{c}}}a{{color:#8ab4ff}}</style></head>
<body><div><p><b>{head}</b></p><p>{body}</p><p><a href="/#{to}">Open Professor OI</a></p></div></body></html>'''


def page(ok, body, to='livechain'):
    import html
    return PAGE.format(wait=1 if ok else 30, to=to, c='#3ddc84' if ok else '#ff6b6b',
                       head='Connected' if ok else 'Login did not complete', body=html.escape(body)).encode('utf-8')


def make_handler(hub, port):
    hosts = {f'127.0.0.1:{port}', f'localhost:{port}'}
    origins = {f'http://{h}' for h in hosts}

    class H(BaseHTTPRequestHandler):
        server_version = 'ProfessorOI/' + VERSION

        def log_message(self, fmt, *args):
            pass

        def out(self, code, body, ctype='application/json; charset=utf-8', extra=None):
            if not isinstance(body, bytes):
                body = json.dumps(body).encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(body)

        def redirect(self, url):
            self.send_response(302)
            self.send_header('Location', url)
            self.send_header('Content-Length', '0')
            self.end_headers()

        def guard(self, api=False):
            # DNS-rebinding / cross-site protection: only this PC's own pages may talk to us
            if self.headers.get('Host', '') not in hosts:
                self.out(403, {'error': 'bad host'})
                return False
            o = self.headers.get('Origin')
            if api and o is not None and o not in origins:
                self.out(403, {'error': 'bad origin'})
                return False
            return True

        def body(self):
            n = int(self.headers.get('Content-Length') or 0)
            raw = self.rfile.read(min(n, 65536)).decode('utf-8', 'replace') if n else ''
            if 'json' in (self.headers.get('Content-Type') or ''):
                try:
                    return json.loads(raw or '{}')
                except ValueError:
                    return {}
            return dict(urllib.parse.parse_qsl(raw))

        def finish_login(self, params):
            a = hub.a
            try:
                with hub.alock:
                    a.finish_login(params)
                hub.logged_in('redirect')
                return True, f'Logged in to {a.name}. Live data starts in a few seconds.'
            except Exception as e:
                hub.set('need_login', str(e))
                return False, str(e)

        def do_GET(self):
            u = urllib.parse.urlparse(self.path)
            p, q = u.path, dict(urllib.parse.parse_qsl(u.query))
            if not self.guard(api=p.startswith('/api/')):
                return
            a = hub.a
            if p in ('/', '/index.html'):
                try:
                    with open(APP, 'rb') as f:
                        return self.out(200, f.read(), 'text/html; charset=utf-8')
                except OSError:
                    return self.out(404, b'index.html not found next to the connector folder', 'text/plain')
            if p == '/api/status':
                return self.out(200, hub.status())
            if p == '/api/chain':
                c = hub.chains.get(q.get('sym', 'NIFTY'))
                return self.out(200, c) if c else self.out(404, {'error': 'no data yet'})
            if p == '/api/history':
                return self.out(200, hub.hist.get(q.get('sym', 'NIFTY'), []))
            if p == '/api/brokers':
                return self.out(200, hub.catalog())
            if p == '/api/days':
                return self.out(200, hub.store.days())
            if p == '/api/stocks':
                d = hub.store.stocks_day(q.get('day') or None)
                if not d and hub.stocks:
                    d = {'day': core.last_close().date().isoformat(), 'synthetic': True, 'minutes': [[MINUTES, hub.stocks['ts'], hub.stocks['items']]]}
                return self.out(200, d) if d else self.out(404, {'error': 'no stock data yet'})
            if p == '/api/alerts':
                return self.out(200, hub.alerts.public())
            if p == '/api/day':
                sym = q.get('sym', 'NIFTY')
                d = hub.store.day(sym, q.get('day') or None)
                c = hub.chains.get(sym)
                if not d and c:                     # nothing stored yet (e.g. after hours): the latest chain stands for the whole day
                    day = core.last_close().date().isoformat()
                    d = {'sym': sym, 'day': day, 'expiry': c['expiry'], 'lot': c['lot'], 'prev': c.get('prev') or hub.store.prev_close(sym, day),
                         'broker': c['broker'], 'synthetic': True, 'minutes': [[MINUTES, c['ts'], c['spot'], c['spot'], c['spot'], Store.pack(c)]]}
                return self.out(200, d) if d else self.out(404, {'error': 'no data yet'})
            if p == '/api/login':
                if a.id == 'none' or a.missing():
                    return self.redirect('/#broker')
                if a.login_kind == 'direct':
                    if a.direct_fields():
                        return self.redirect('/#broker')
                    try:
                        with hub.alock:
                            a.direct_login({})
                        hub.logged_in('direct')
                        return self.redirect('/#livechain')
                    except Exception as e:
                        a.token = None
                        hub.set('need_login', str(e))
                        return self.redirect('/#broker')
                try:
                    url = a.login_url()
                except Exception as e:
                    hub.set('need_login', f'Could not start login: {e}')
                    return self.redirect('/#broker')
                return self.redirect(url)
            if p == '/callback':
                ok, msg = self.finish_login(q)
                return self.out(200 if ok else 400, page(ok, msg, 'livechain' if ok else 'broker'), 'text/html; charset=utf-8')
            if p == '/stream':
                return self.stream()
            if p == '/favicon.ico':
                return self.out(204, b'', 'image/x-icon')
            return self.out(404, {'error': 'not found'})

        def do_POST(self):
            p = urllib.parse.urlparse(self.path).path
            if p == '/callback':                     # some brokers POST the redirect form
                if not self.guard():
                    return
                ok, msg = self.finish_login(self.body())
                return self.out(200 if ok else 400, page(ok, msg, 'livechain' if ok else 'broker'), 'text/html; charset=utf-8')
            if not self.guard(api=True):
                return
            if 'json' not in (self.headers.get('Content-Type') or ''):
                return self.out(415, {'error': 'send JSON'})
            d = self.body()
            a = hub.a
            if p == '/api/setup':
                try:
                    hub.setup(str(d.get('broker', '')), d.get('values') or {}, d.get('clear') or [])
                except ValueError as e:
                    return self.out(400, {'ok': False, 'error': str(e)})
                a = hub.a
                st = hub.status()
                if st['state'] == 'need_config':
                    return self.out(400, {'ok': False, 'error': 'Still missing: ' + ', '.join(a.missing()), 'status': st})
                nxt = 'login' if a.login_kind == 'redirect' and not a.logged_in else 'form' if st['state'] == 'need_login' and st['fields'] else 'live' if a.logged_in else 'error'
                return self.out(200, {'ok': nxt != 'error', 'next': nxt, 'error': st['msg'] if nxt == 'error' else None, 'status': st})
            if p == '/api/login':
                try:
                    with hub.alock:
                        a.direct_login(d)
                    hub.logged_in('direct')
                    return self.out(200, {'ok': True})
                except Exception as e:
                    a.token = None
                    hub.set('need_login', str(e))
                    return self.out(400, {'ok': False, 'error': str(e)})
            if p == '/api/session':
                url = str(d.get('url', '')).strip()
                qs = urllib.parse.urlparse(url).query or url.lstrip('?')
                params = dict(urllib.parse.parse_qsl(qs))
                if not params:
                    return self.out(400, {'ok': False, 'error': 'Paste the full address from the browser bar after login.'})
                ok, msg = self.finish_login(params)
                return self.out(200 if ok else 400, {'ok': ok, 'error': None if ok else msg})
            if p.startswith('/api/alerts/'):
                try:
                    act = p.rsplit('/', 1)[1]
                    if act == 'config':
                        hub.alerts.configure(d)
                    elif act == 'findchat':
                        hub.alerts.find_chat()
                    elif act == 'test':
                        hub.alerts.test()
                    else:
                        return self.out(404, {'error': 'not found'})
                    return self.out(200, {'ok': True, 'alerts': hub.alerts.public()})
                except (ValueError, BrokerError, AuthError) as e:
                    return self.out(400, {'ok': False, 'error': str(e), 'alerts': hub.alerts.public()})
            if p == '/api/logout':
                hub.logout('Logged out.')
                return self.out(200, {'ok': True})
            return self.out(404, {'error': 'not found'})

        def stream(self):
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Accel-Buffering', 'no')
            self.end_headers()
            q = hub.subscribe()
            try:
                first = [('status', hub.status())] + [('history', {'sym': s, 'rows': h}) for s, h in hub.hist.items()] + [('chain', c) for c in hub.chains.values()] + ([('stocks', hub.stocks)] if hub.stocks else [])
                for ev, data in first:
                    self.wfile.write(f'event: {ev}\ndata: {json.dumps(data, separators=(",", ":"))}\n\n'.encode('utf-8'))
                self.wfile.flush()
                while True:
                    try:
                        msg = q.get(timeout=15)
                    except queue.Empty:
                        msg = b': ping\n\n'
                    self.wfile.write(msg)
                    self.wfile.flush()
            except OSError:
                pass
            finally:
                hub.unsubscribe(q)

    return H


def main():
    for st in (sys.stdout, sys.stderr):              # Windows consoles choke on non-ASCII broker messages
        try:
            st.reconfigure(errors='replace')
        except Exception:
            pass
    ap = argparse.ArgumentParser(description='Professor OI broker connector')
    ap.add_argument('--broker', help='override the broker in config.json (demo, kite, upstox, fyers, dhan, angel, breeze)')
    ap.add_argument('--port', type=int)
    ap.add_argument('--config', default=CONFIG)
    ap.add_argument('--no-browser', action='store_true')
    args = ap.parse_args()

    cfg = load_config(args.config)
    bid = (args.broker if args.broker is not None else cfg.get('broker') or '').strip().lower()
    port = args.port or int(cfg.get('port') or 8765)
    n = max(5, min(30, int(cfg.get('strikes_each_side') or 15)))
    redirect = (cfg.get('redirect_url') or f'http://127.0.0.1:{port}/callback').strip()
    hub = Hub(cfg, args.config, redirect)
    try:
        hub.use(bid)
    except ValueError as e:
        print(f'{e} -- starting without a broker; choose one on the Broker page.')
        hub.use('')

    try:
        srv = ThreadingHTTPServer(('127.0.0.1', port), make_handler(hub, port))
    except OSError:
        print(f'\nPort {port} is busy. The connector may already be running (http://127.0.0.1:{port}),'
              '\nor another program uses it. Close the other window, or set "port" in config.json.\n')
        if not args.no_browser:
            webbrowser.open(f'http://127.0.0.1:{port}/#broker')
        return
    srv.daemon_threads = True
    Poller(hub, n, float(cfg.get('closed_poll_seconds') or 15)).start()
    url = f'http://127.0.0.1:{port}/#' + ('livechain' if hub.a.logged_in else 'broker')
    print('\n  Professor OI Connector ' + VERSION)
    print(f'  Broker   : {hub.a.name}   (change it on the Broker page)')
    print(f'  Open     : http://127.0.0.1:{port}')
    print(f'  Redirect : {redirect}   <- broker app mein yahi Redirect URL daalo')
    print('  Stop     : close this window or press Ctrl+C\n', flush=True)
    if not args.no_browser:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('\nStopped.')


if __name__ == '__main__':
    main()
