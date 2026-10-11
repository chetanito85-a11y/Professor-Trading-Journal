"""Fyers API v3 (REST). Login: generate-authcode redirect with ?auth_code=."""
import urllib.parse
from datetime import datetime
from core import AuthError, BrokerError, http, leg, sha256
from . import Adapter, F

API = 'https://api-t1.fyers.in/api/v3'
DATA = 'https://api-t1.fyers.in/data'
SYM = {'NIFTY': 'NSE:NIFTY50-INDEX', 'BANKNIFTY': 'NSE:NIFTYBANK-INDEX', 'FINNIFTY': 'NSE:FINNIFTY-INDEX', 'MIDCPNIFTY': 'NSE:MIDCPNIFTY-INDEX'}
AUTH_CODES = {-8, -15, -16, -17, -300}


class Fyers(Adapter):
    id = 'fyers'
    name = 'Fyers'
    gap = 0.5
    needs = ('app_id', 'secret_key')
    fields = (F('app_id', 'App ID', help='Looks like XXXXXXXX-100'), F('secret_key', 'Secret key', secret=True))
    redirect_needed = True
    symbols = tuple(SYM)

    def login_url(self):
        return API + '/generate-authcode?' + urllib.parse.urlencode(
            {'client_id': self.cfg['app_id'].strip(), 'redirect_uri': self.redirect_url, 'response_type': 'code', 'state': 'poi'})

    def finish_login(self, p):
        code = p.get('auth_code')
        if not code:
            raise AuthError(f"Fyers did not send an auth_code (s={p.get('s', '?')}, message={p.get('message', '')}).")
        app, sec = self.cfg['app_id'].strip(), self.cfg['secret_key'].strip()
        r = http('POST', API + '/validate-authcode', body={'grant_type': 'authorization_code', 'appIdHash': sha256(f'{app}:{sec}'), 'code': code})
        if r.get('s') != 'ok' or not r.get('access_token'):
            raise AuthError('Fyers login failed: ' + str(r.get('message') or r))
        self.token = r['access_token']

    def chain(self, sym, n):
        h = {'Authorization': f"{self.cfg['app_id'].strip()}:{self.token}", 'version': '3'}
        r = http('GET', DATA + '/options-chain-v3', params={'symbol': SYM[sym], 'strikecount': min(50, n + 2), 'timestamp': self.cfg.get('expiry_ts_' + sym, '')}, headers=h)
        if r.get('s') != 'ok':
            msg = str(r.get('message') or r)
            if r.get('code') in AUTH_CODES or 'token' in msg.lower() or 'authenticate' in msg.lower():
                raise AuthError('Fyers: ' + msg)
            raise BrokerError('Fyers: ' + msg)
        d = r.get('data') or {}
        S, by = 0, {}
        for it in d.get('optionsChain') or []:
            t = it.get('option_type')
            if t not in ('CE', 'PE'):
                S = it.get('ltp') or S
                continue
            ltp, ch = it.get('ltp'), it.get('ltpch')
            prev = ltp - ch if ltp is not None and ch is not None else None
            by.setdefault(it.get('strike_price'), {})[t.lower()] = leg(ltp, prev, it.get('oi'), it.get('prev_oi'), it.get('oich'), it.get('volume'))
        exp = None
        ed = d.get('expiryData') or []
        if ed:
            try:
                exp = datetime.strptime(ed[0].get('date'), '%d-%m-%Y').date().isoformat()
            except (TypeError, ValueError):
                exp = None
        rows = [{'k': k, 'ce': v.get('ce') or leg(), 'pe': v.get('pe') or leg()} for k, v in by.items()]
        return {'spot': S, 'expiry': exp, 'rows': rows}
