#!/usr/bin/env python3
"""Generate a 64x64 pack_icon.png (blue gradient + centered 'lens') with no PIL."""
import struct, zlib, os

W = H = 64

def px(x, y):
    # background gradient (dark blue -> blue)
    r = int(20 + (x / W) * 30)
    g = int(40 + (y / H) * 60)
    b = int(90 + ((x + y) / (W + H)) * 80)
    # camera "lens" in the center
    dx, dy = x - 32, y - 32
    d = (dx * dx + dy * dy) ** 0.5
    if d < 14:
        r, g, b = 240, 240, 245  # bright center
    elif d < 18:
        r, g, b = 30, 30, 40     # dark ring
    return r, g, b

def main(out):
    raw = b""
    for y in range(H):
        raw += b"\x00" + bytes(v for x in range(W) for v in px(x, y))

    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "wb") as f:
        f.write(png)
    print(f"icon written: {out}")

if __name__ == "__main__":
    import sys
    main(sys.argv[1] if len(sys.argv) > 1 else "pack_icon.png")
