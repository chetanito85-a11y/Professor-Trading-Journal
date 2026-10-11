"""A small WebSocket client (RFC 6455) on the standard library, enough for broker
market feeds: connect over TLS, send text frames, receive text/binary frames,
answer pings."""
import base64, os, socket, ssl, struct, urllib.parse
from core import _CTX


class WSClosed(Exception):
    pass


class WSClient:
    def __init__(self, url, timeout=15):
        self.url, self.timeout, self.sock = url, timeout, None

    def connect(self):
        u = urllib.parse.urlparse(self.url)
        secure = u.scheme == 'wss'
        host, port = u.hostname, u.port or (443 if secure else 80)
        raw = socket.create_connection((host, port), timeout=self.timeout)
        self.sock = _CTX.wrap_socket(raw, server_hostname=host) if secure else raw
        key = base64.b64encode(os.urandom(16)).decode()
        path = (u.path or '/') + ('?' + u.query if u.query else '')
        req = (f'GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n'
               f'Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nUser-Agent: ProfessorOI-Connector\r\n\r\n')
        self.sock.sendall(req.encode())
        head = b''
        while b'\r\n\r\n' not in head:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise WSClosed('connection closed during handshake')
            head += chunk
            if len(head) > 65536:
                raise WSClosed('handshake too long')
        head, self.buf = head.split(b'\r\n\r\n', 1)
        status = head.split(b'\r\n', 1)[0].decode('latin-1')
        if ' 101 ' not in status + ' ':
            raise WSClosed(f'handshake refused: {status}')
        self.sock.settimeout(60)        # brokers send heartbeats; a silent minute means the link is dead

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise WSClosed('connection closed')
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _send(self, op, data):
        mask = os.urandom(4)
        n = len(data)
        hdr = bytes([0x80 | op])
        if n < 126:
            hdr += bytes([0x80 | n])
        elif n < 65536:
            hdr += bytes([0x80 | 126]) + struct.pack('>H', n)
        else:
            hdr += bytes([0x80 | 127]) + struct.pack('>Q', n)
        self.sock.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def send_text(self, text):
        self._send(0x1, text.encode('utf-8'))

    def recv(self):
        """Next complete message: ('text', str) or ('binary', bytes). Pings are answered here."""
        parts, kind = [], None
        while True:
            b1, b2 = self._read(2)
            fin, op, n = b1 & 0x80, b1 & 0x0F, b2 & 0x7F
            if n == 126:
                n = struct.unpack('>H', self._read(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', self._read(8))[0]
            mask = self._read(4) if b2 & 0x80 else None
            data = self._read(n)
            if mask:
                data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
            if op == 0x9:
                self._send(0xA, data)
                continue
            if op == 0xA:
                continue
            if op == 0x8:
                raise WSClosed('closed by server' + (f': {data[2:].decode("utf-8", "replace")}' if len(data) > 2 else ''))
            if op in (0x1, 0x2):
                kind = 'text' if op == 0x1 else 'binary'
            parts.append(data)
            if fin:
                msg = b''.join(parts)
                return (kind, msg.decode('utf-8', 'replace')) if kind == 'text' else (kind, msg)

    def close(self):
        try:
            self._send(0x8, b'')
        except Exception:
            pass
        try:
            self.sock.close()
        except Exception:
            pass
