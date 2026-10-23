#!/usr/bin/env python3
"""Local stand-in for the Dynmap web server, for testing the placer and game without the live server.

  python3 tools/mock_dynmap.py [--port 8128] [--login-required]

Serves:
  /pintland/...        -> game/            (same layout as plugins/dynmap/web/pintland/; no folder index, like Dynmap)
  /up/configuration    -> {}  (or {"error":"login-required"} with --login-required)
  /login.html          -> a stub page
  /tiles/<world>/flat/<gx>_<gy>/<prefix><nx>_<ny>.jpg -> generated test tiles

The generated world is synthetic: blobs of "land" roughly where the real landmasses sit, a one-block
checkerboard so block alignment is visible at full zoom, a red block at every (x, z) that are both
multiples of 100, a white block at (0, 0), a white 96-block square at x 1000..1095, z -1000..-905, and grid
lines every 32 blocks (one base tile). Zoomed-out tiles follow Dynmap's grid, which starts at z = -32. Tiles far out in
the ocean return 404, like unexplored areas on the live server.
"""
import argparse
import io
import json
import math
import os
import re
from functools import lru_cache
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'game')
TILE_RE = re.compile(r'^/tiles/([^/]+)/flat/(-?\d+)_(-?\d+)/((?:z+_)?)(-?\d+)_(-?\d+)\.jpg$')

# (cx, cz, rx, rz) ellipses of land, in blocks
LAND = [
    (550, -420, 600, 560),     # Pintland continent, about x 0..1100, z -1000..150
    (500, -1300, 160, 130),    # dome island to the north
    (940, -550, 90, 70),       # island city to the east
    (-1800, 900, 500, 380),    # further-out landmasses
    (2300, 1900, 420, 520),
    (-900, -2400, 300, 260),
]
EXPLORED = 2600  # tiles whose nearest point is further than this from the origin are "unexplored" (404)


def land_mask(x, z):
    m = np.zeros(x.shape, dtype=bool)
    for cx, cz, rx, rz in LAND:
        wobble = 1 + 0.08 * np.sin(x / 37.0) * np.cos(z / 53.0)
        m |= ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2 <= wobble
    return m


@lru_cache(maxsize=4096)
def render(k, nx, ny):
    """Tile with zoom-out level k (prefix 'z'*k) and Dynmap coords nx, ny -> JPEG bytes, or None for 404."""
    f = 2 ** k
    span = 32 * f                           # blocks per tile side
    # Dynmap's grid starts one base tile north of z = 0 (see makeCRS in core.js), so zoomed-out tiles are offset by 32
    x0, z0 = (nx // f) * span, (-ny // f) * span - 32
    nearest = math.hypot(max(abs(x0 + span / 2) - span / 2, 0), max(abs(z0 + span / 2) - span / 2, 0))
    if nearest > EXPLORED:
        return None
    px = (np.arange(128) + 0.5) * span / 128
    bx = np.floor(x0 + px)[None, :].repeat(128, 0)
    bz = np.floor(z0 + px)[:, None].repeat(128, 1)
    land = land_mask(bx, bz)
    img = np.zeros((128, 128, 3), dtype=np.float32)
    img[...] = (38, 70, 120)                                       # ocean
    img[land] = (86, 128, 62)                                      # grass
    if span <= 128:                                                # block checkerboard when blocks are >= 1 px
        chk = ((bx + bz) % 2 == 0)
        img[chk] *= 0.86
    if span <= 512:
        line = (np.mod(bx, 32) == 0) | (np.mod(bz, 32) == 0)
        img[line] = img[line] * 0.6 + 40
    sq = (bx >= 1000) & (bx < 1096) & (bz >= -1000) & (bz < -904)  # a white square to check alignment at every zoom
    img[sq] = (250, 250, 250)
    hund = (np.mod(bx, 100) == 0) & (np.mod(bz, 100) == 0)
    img[hund] = (220, 30, 30)
    img[(bx == 0) & (bz == 0)] = (255, 255, 255)
    out = io.BytesIO()
    Image.fromarray(img.clip(0, 255).astype(np.uint8)).save(out, 'JPEG', quality=88)
    return out.getvalue()


class Handler(SimpleHTTPRequestHandler):
    login_required = False

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        pass

    def send_bytes(self, code, body, ctype):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        if path == '/up/configuration':
            body = {'error': 'login-required'} if self.login_required else {}
            return self.send_bytes(200, json.dumps(body).encode(), 'application/json')
        if path == '/login.html':
            return self.send_bytes(200, b'<!doctype html><title>Dynmap login</title><h1>Mock Dynmap login</h1>', 'text/html')
        m = TILE_RE.match(path)
        if m:
            k = len(m.group(4)) - 1 if m.group(4) else 0
            data = render(k, int(m.group(5)), int(m.group(6)))
            if data is None:
                return self.send_bytes(404, b'not found', 'text/plain')
            return self.send_bytes(200, data, 'image/jpeg')
        if path.endswith('/'):     # like Dynmap's web server: no folder index pages, use /pintland/index.html
            return self.send_bytes(404, b'not found', 'text/plain')
        if path.startswith('/pintland/'):
            self.path = self.path[len('/pintland'):]
            return super().do_GET()
        return self.send_bytes(404, b'not found', 'text/plain')

    do_HEAD = do_GET


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--port', type=int, default=8128)
    ap.add_argument('--login-required', action='store_true')
    args = ap.parse_args()
    Handler.login_required = args.login_required
    print('Mock Dynmap on http://127.0.0.1:%d/pintland/index.html' % args.port)
    ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()


if __name__ == '__main__':
    main()
