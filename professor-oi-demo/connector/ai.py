"""AI market read: every few minutes during market hours the connector sends a
compact summary of the live numbers to Claude and gets back a short read in
English or Hinglish. Uses the official `anthropic` Python SDK, installed on
request from the Broker page (the rest of the connector needs no packages).
Your Anthropic API key stays in connector/config.json on this PC."""
import importlib, json, subprocess, sys, threading, time
from core import market_open, now_ist

MODELS = {   # USD per million tokens (input, output), for the cost estimate shown on the page
    'claude-opus-5-5': ('Claude Opus 5.5', 4.0, 20.0),
    'claude-sonnet-5-5': ('Claude Sonnet 5.5', 2.0, 10.0),
    'claude-haiku-5-5': ('Claude Haiku 5.5', 0.10, 0.50),
}
DEFAULT_MODEL = 'claude-opus-5-5'
EST_IN, EST_OUT = 1800, 700                     # rough tokens per read (prompt, answer incl. thinking)

SYSTEM = """You are the market-read writer inside Professor OI, an Indian index-options analytics app.
You get a JSON snapshot of live NSE data: NIFTY and BANKNIFTY spot, PCR, max pain, option-writing walls
(support = strike with the biggest put writing, resistance = biggest call writing), ATM IV and straddle,
the strikes with the most fresh writing or unwinding, intraday changes, recent wall-shift alerts and
F&O stock buildups.

Write a short read for a retail options trader:
- 5 to 7 bullet points, each one line, most important first; each bullet starts with "- ".
- Use only the numbers in the snapshot and quote the key levels. If something is missing, skip it.
- Say what the option writers are doing and which levels matter next. Mention the range implied by the walls.
- Describe; do not tell the reader to buy or sell anything, and do not predict with certainty.
- No heading, no preamble, no closing line."""

LANG = {'en': 'Write in plain English.',
        'hi': 'Write in Hinglish: Hindi in Roman script mixed with common English market words (support, resistance, PCR, writing, unwinding), the way Indian traders chat.'}


class AIRead:
    def __init__(self, cfg, save, log, snapshot, broadcast):
        self.cfg, self.save, self.log, self.snapshot, self.broadcast = cfg, save, log, snapshot, broadcast
        self.reads, self.err, self.busy, self.last = [], '', False, 0.0
        self.install = {'state': 'idle', 'out': ''}
        threading.Thread(target=self._loop, daemon=True).start()

    @property
    def conf(self):
        return self.cfg.setdefault('ai', {})

    @staticmethod
    def sdk():
        try:
            importlib.invalidate_caches()
            return importlib.import_module('anthropic')
        except ImportError:
            return None

    def public(self):
        c = self.conf
        model = c.get('model') or DEFAULT_MODEL
        every = int(c.get('every') or 15)
        per_day = 375 / every
        cost = {m: round(per_day * (EST_IN * p[1] + EST_OUT * p[2]) / 1e6, 3) for m, p in MODELS.items()}
        return {'sdk': bool(self.sdk()), 'install': self.install, 'key': bool(c.get('api_key')), 'enabled': bool(c.get('enabled')),
                'model': model, 'models': {m: p[0] for m, p in MODELS.items()}, 'cost_per_day': cost, 'every': every,
                'lang': c.get('lang') or 'hi', 'busy': self.busy, 'error': self.err, 'reads': self.reads[-8:]}

    def configure(self, d):
        c = self.conf
        key = str(d.get('api_key') or '').strip()
        if key:
            if not key.startswith('sk-ant-') or len(key) > 300:
                raise ValueError('That does not look like an Anthropic API key (it starts with sk-ant-).')
            c['api_key'] = key
        if d.get('clear_key'):
            c['api_key'] = ''
        if d.get('model') in MODELS:
            c['model'] = d['model']
        if d.get('lang') in LANG:
            c['lang'] = d['lang']
        if d.get('every') is not None:
            c['every'] = max(5, min(60, int(d['every'])))
        if 'enabled' in d:
            c['enabled'] = bool(d['enabled'])
        self.save()

    # ---- one-time install of the official SDK, only when the user asks ----
    def install_sdk(self):
        if self.install['state'] == 'running':
            return
        self.install = {'state': 'running', 'out': 'Installing the anthropic package...'}

        def run():
            cmd = [sys.executable, '-m', 'pip', 'install', '--upgrade', 'anthropic']
            if sys.prefix == sys.base_prefix:
                cmd.insert(4, '--user')               # no admin rights needed outside a virtualenv
            try:
                p = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
                ok = p.returncode == 0 and self.sdk() is not None
                tail = (p.stdout + p.stderr).strip().splitlines()[-4:]
                self.install = {'state': 'done' if ok else 'failed', 'out': '\n'.join(tail)}
            except Exception as e:
                self.install = {'state': 'failed', 'out': str(e)}
            self.log(f"AI library install: {self.install['state']}")
            self.broadcast('ai', self.public())
        threading.Thread(target=run, daemon=True).start()

    # ---- the read itself ----
    def _loop(self):
        while True:
            time.sleep(20)
            c = self.conf
            if c.get('enabled') and c.get('api_key') and market_open() and time.time() - self.last >= int(c.get('every') or 15) * 60:
                self.generate()

    def generate(self):
        if self.busy:
            return
        a = self.sdk()
        c = self.conf
        if not a:
            self.err = 'Install the Claude library first (button below).'
            return self.broadcast('ai', self.public())
        if not c.get('api_key'):
            self.err = 'Add your Anthropic API key first.'
            return self.broadcast('ai', self.public())
        snap = self.snapshot()
        if not snap:
            self.err = 'No live data yet. Log in to your broker first.'
            return self.broadcast('ai', self.public())
        self.busy, self.last = True, time.time()
        self.broadcast('ai', self.public())
        model = c.get('model') or DEFAULT_MODEL
        try:
            client = a.Anthropic(api_key=c['api_key'], timeout=90.0, max_retries=2)
            kw = dict(model=model, max_tokens=4000, system=SYSTEM + '\n' + LANG.get(c.get('lang') or 'hi', LANG['hi']),
                      output_config={'effort': 'low'},           # a short summary does not need deep thinking
                      messages=[{'role': 'user', 'content': 'Live snapshot (JSON):\n' + json.dumps(snap, separators=(',', ':'))}])
            if model != 'claude-haiku-5-5':                      # Haiku has no server-side fallback
                kw.update(betas=['server-side-fallback-2026-07-01'], fallbacks='default')
            r = client.beta.messages.create(**kw)
            if r.stop_reason == 'refusal':
                cat = getattr(r.stop_details, 'category', None) if r.stop_details else None
                raise RuntimeError(f'Claude declined this request ({cat or "no category"}). Try again later.')
            text = '\n'.join(b.text for b in r.content if b.type == 'text').strip()
            if not text:
                raise RuntimeError(f'Empty answer (stop reason: {r.stop_reason}).')
            self.reads.append({'t': int(time.time() * 1000), 'at': now_ist().strftime('%H:%M'), 'model': r.model, 'text': text,
                               'tokens': [r.usage.input_tokens, r.usage.output_tokens]})
            del self.reads[:-20]
            self.err = ''
            self.log(f'AI read ready ({r.model}, {r.usage.input_tokens}+{r.usage.output_tokens} tokens).')
        except a.AuthenticationError:
            self.err = 'Anthropic rejected the API key. Check it at console.anthropic.com and save it again.'
        except a.PermissionDeniedError as e:
            self.err = f'This API key cannot use {model}: {e.message}'
        except a.NotFoundError:
            self.err = f'Model {model} is not available to this key. Pick another model.'
        except a.RateLimitError:
            self.err = 'Rate limited by Anthropic. The next read will try again.'
        except a.BadRequestError as e:
            self.err = f'Request rejected: {e.message}'
        except a.APIStatusError as e:
            self.err = f'Anthropic error {e.status_code}. Will retry at the next interval.'
        except a.APIConnectionError:
            self.err = 'Could not reach api.anthropic.com. Check the internet connection.'
        except Exception as e:
            self.err = str(e)[:200]
        finally:
            self.busy = False
            if self.err:
                self.log(f'AI read failed: {self.err}')
            self.broadcast('ai', self.public())
