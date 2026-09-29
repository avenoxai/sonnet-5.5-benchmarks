#!/usr/bin/env python3
"""Sunum için küçük yerel sunucu (sadece 127.0.0.1).

python3 -m http.server'dan farkı:
  - Range isteklerini destekler: büyük videolarda (mars inişi/video.mp4, 260 MB) ileri sarma çalışır,
    tarayıcı dosyanın tamamını indirmeden oynatmaya başlar.
  - /__durum?yol=a&yol=b  ->  {"a": true, "b": false}  (dosya var mı). Sunum eksik görsel ve poster
    için boşuna istek atmasın, konsola 404 düşmesin diye.
  - html/js/css/json için önbellek kapalı: Sonnet bir sonucu yeniden derlerse sayfa yenilenince görünür.

Kullanım: python3 sunucu.py <port> <kök klasör>
"""
import http.server
import json
import os
import re
import sys
import urllib.parse

NO_CACHE = ('.html', '.htm', '.js', '.mjs', '.css', '.json', '.map')


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = dict(http.server.SimpleHTTPRequestHandler.extensions_map, **{
        '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
        '.json': 'application/json', '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.webm': 'video/webm',
        '.glsl': 'text/plain', '.wgsl': 'text/plain', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
    })

    def log_message(self, *args):
        pass

    def end_headers(self):
        path = urllib.parse.urlsplit(self.path).path.lower()
        if path.endswith(NO_CACHE) or path.endswith('/'):
            self.send_header('Cache-Control', 'no-store')
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    def do_GET(self):
        parts = urllib.parse.urlsplit(self.path)
        if parts.path == '/__durum':
            out = {}
            for p in urllib.parse.parse_qs(parts.query).get('yol', [])[:200]:
                fs = self.translate_path('/' + urllib.parse.quote(p.lstrip('/')))
                out[p] = os.path.isfile(fs)
            body = json.dumps(out, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def send_head(self):
        self._left = None
        rng = self.headers.get('Range')
        path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path):
            return super().send_head()
        m = re.match(r'\s*bytes=(\d*)-(\d*)\s*$', rng)
        if not m or (m.group(1) == '' and m.group(2) == ''):
            return super().send_head()
        size = os.path.getsize(path)
        a, b = m.groups()
        if a == '':
            start, end = max(0, size - int(b)), size - 1
        else:
            start = int(a)
            end = min(int(b), size - 1) if b else size - 1
        if start >= size or start > end:
            self.send_response(416)
            self.send_header('Content-Range', 'bytes */%d' % size)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return None
        f = open(path, 'rb')
        f.seek(start)
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        self._left = end - start + 1
        return f

    def copyfile(self, src, dst):
        left = getattr(self, '_left', None)
        try:
            if left is None:
                super().copyfile(src, dst)
                return
            while left > 0:
                buf = src.read(min(1 << 20, left))
                if not buf:
                    break
                dst.write(buf)
                left -= len(buf)
        except (BrokenPipeError, ConnectionResetError):
            pass  # tarayıcı videoyu sarınca eski isteği keser; normal


class Server(http.server.ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    root = sys.argv[2] if len(sys.argv) > 2 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)
    with Server(('127.0.0.1', port), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
