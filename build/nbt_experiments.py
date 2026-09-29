#!/usr/bin/env python3
"""Minimal NBT parser (little-endian, Bedrock) to extract the 'experiments' compound."""
import struct, sys, gzip, zlib

class R:
    def __init__(self, b):
        self.b = b
        self.i = 0
    def u8(self):
        v = self.b[self.i]; self.i += 1; return v
    def i16(self):
        v = struct.unpack_from("<h", self.b, self.i)[0]; self.i += 2; return v
    def i32(self):
        v = struct.unpack_from("<i", self.b, self.i)[0]; self.i += 4; return v
    def i64(self):
        v = struct.unpack_from("<q", self.b, self.i)[0]; self.i += 8; return v
    def f32(self):
        v = struct.unpack_from("<f", self.b, self.i)[0]; self.i += 4; return v
    def f64(self):
        v = struct.unpack_from("<d", self.b, self.i)[0]; self.i += 8; return v
    def s(self):
        n = struct.unpack_from("<H", self.b, self.i)[0]; self.i += 2
        v = self.b[self.i:self.i+n].decode("utf-8", "replace")
        self.i += n
        return v

def read_payload(r, t):
    if t == 1: return r.u8()
    if t == 2: return r.i16()
    if t == 3: return r.i32()
    if t == 4: return r.i64()
    if t == 5: return r.f32()
    if t == 6: return r.f64()
    if t == 7:
        n = r.i32(); v = r.b[r.i:r.i+n]; r.i += n; return v
    if t == 8: return r.s()
    if t == 9:
        et = r.u8(); n = r.i32()
        return [read_payload(r, et) for _ in range(n)]
    if t == 10:
        d = {}
        while True:
            ct = r.u8()
            if ct == 0:
                return d
            cn = r.s()
            d[cn] = read_payload(r, ct)
    raise ValueError(f"unknown tag {t}")

def load(path):
    raw = open(path, "rb").read()
    version, declared_len = struct.unpack_from("<ii", raw, 0)
    body = raw[8:]  # skip int32 storage version + int32 payload length
    print(f"header: version={version} declared_len={declared_len} actual_payload={len(body)}")
    try:
        body = zlib.decompress(body)
        print("(zlib)")
    except Exception:
        try:
            body = gzip.decompress(body)
            print("(gzip)")
        except Exception:
            print("(cru)")
    r = R(body)
    t = r.u8()
    name = r.s()
    print(f"root: {t} '{name}'")
    return read_payload(r, t)

if __name__ == "__main__":
    data = load(sys.argv[1])
    exp = data.get("experiments", {})
    print("experiments:", exp)
    print("experimental_creator_cameras:", exp.get("experimental_creator_cameras", "ABSENT"))
    print("experiments_ever_used:", exp.get("experiments_ever_used"))
    print("saved_with_toggled_experiments:", exp.get("saved_with_toggled_experiments"))
