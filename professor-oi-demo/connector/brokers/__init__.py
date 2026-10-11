"""Broker adapters. Each one turns a broker's API into the same raw chain shape:
{'spot', 'expiry': 'YYYY-MM-DD', 'lot'?, 'rows': [{'k': strike, 'ce': leg(...), 'pe': leg(...)}]}"""


class Adapter:
    id = 'base'
    name = 'Base'
    # 'redirect': broker login page sends the user back to /callback
    # 'direct'  : the connector logs in itself (TOTP / ready token), no redirect
    login_kind = 'redirect'
    gap = 1.0            # seconds to wait between API calls (broker rate limits)
    symbols = ('NIFTY', 'BANKNIFTY')
    needs = ()           # config keys that must be filled in
    # what the Broker page form asks for: k, label, secret (hide while typing), optional, group, help
    fields = ()
    redirect_needed = False   # True when the broker's app must have our /callback as its redirect URL

    def __init__(self, cfg, redirect_url):
        self.cfg = cfg or {}
        self.redirect_url = redirect_url
        self.token = None
        self.user = None

    def missing(self):
        return [k for k in self.needs if not str(self.cfg.get(k, '')).strip()]

    # ---- login ----
    def login_url(self):
        raise NotImplementedError

    def finish_login(self, params):
        """params: query/form values from the broker's redirect."""
        raise NotImplementedError

    def direct_login(self, form):
        raise NotImplementedError

    def direct_fields(self):
        """Fields the Broker page should ask for when login_kind == 'direct'."""
        return []

    def session(self):
        return {'token': self.token, 'user': self.user}

    def restore(self, saved):
        self.token = saved.get('token')
        self.user = saved.get('user')

    @property
    def logged_in(self):
        return bool(self.token)

    # ---- data ----
    def chain(self, sym, n):
        raise NotImplementedError


class NoBroker(Adapter):
    id = 'none'
    name = 'No broker selected'
    login_kind = 'none'
    symbols = ('NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY')

    def missing(self):
        return ['broker']


ALL = ('kite', 'dhan', 'upstox', 'angel', 'fyers', 'breeze', 'demo')


def F(k, label, secret=False, optional=False, group=None, help=''):
    return {'k': k, 'label': label, 'secret': secret, 'optional': optional, 'group': group, 'help': help}


def load(broker_id):
    broker_id = (broker_id or '').strip().lower()
    if broker_id in ('', 'none'):
        return NoBroker
    if broker_id == 'demo':
        from .demo import Demo as A
    elif broker_id in ('kite', 'zerodha'):
        from .kite import Kite as A
    elif broker_id == 'upstox':
        from .upstox import Upstox as A
    elif broker_id == 'fyers':
        from .fyers import Fyers as A
    elif broker_id == 'dhan':
        from .dhan import Dhan as A
    elif broker_id in ('angel', 'angelone', 'smartapi'):
        from .angel import Angel as A
    elif broker_id in ('breeze', 'icici'):
        from .breeze import Breeze as A
    else:
        raise ValueError(f'Unknown broker "{broker_id}". Use one of: demo, kite, upstox, fyers, dhan, angel, breeze')
    return A
