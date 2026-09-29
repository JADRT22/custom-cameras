#!/usr/bin/env python3
"""Enable/disable experiments in a Bedrock world's level.dat (little-endian NBT).

Usage: python3 toggle_experiment.py <world_dir> <experiment_name> <on|off>
"""
import struct, sys, gzip, zlib, shutil
from pathlib import Path

class R:
    def __init__(self, b): self.b = b; self.i = 0
    def u8(self): v = self.b[self.i]; self.i += 1; return v
    def i16(self): v = struct.unpack_from("<h", self.b, self.i)[0]; self.i += 2; return v
    def i32(self): v = struct.unpack_from("<i", self.b, self.i)[0]; self.i += 4; return v
    def i64(self): v = struct.unpack_from("<q", self.b, self.i)[0]; self.i += 8; return v
    def f32(self): v = struct.unpack_from("<f", self.b, self.i)[0]; self.i += 4; return v
    def f64(self): v = struct.unpack_from("<d", self.b, self.i)[0]; self.i += 8; return v
    def s(self):
        n = struct.unpack_from("<H", self.b, self.i)[0]; self.i += 2
        v = self.b[self.i:self.i+n].decode("utf-8", "replace"); self.i += n
        return v

def read_payload(r, t):
    if t == 1: return r.u8()
    if t == 2: return r.i16()
    if t == 3: return r.i32()
    if t == 4: return r.i64()
    if t == 5: return r.f32()
    if t == 6: return r.f64()
    if t == 7:
        n = r.i32(); v = r.b[r.i:r.i+n]; r.i += n; return bytearray(v)
    if t == 8: return r.s()
    # lists/compounds are only read by _payload_with_name (they need the element type)
    raise ValueError(f"tag {t} must be read by _payload_with_name")

def _payload_with_name(r, t, name):
    # for compounds/lists the name only matters when serializing; the payload comes next
    if t == 10:
        d = {}
        while True:
            ct = r.u8()
            if ct == 0: return d
            cn = r.s()
            d[cn] = (ct, _payload_with_name(r, ct, cn))
    if t == 9:
        et = r.u8(); n = r.i32()
        items = []
        for _ in range(n):
            if et == 10:
                items.append(_payload_with_name(r, 10, ""))
            else:
                items.append(read_payload(r, et))
        return (et, items)
    return read_payload(r, t)

def read_root(path):
    # level.dat header (Bedrock): [int32 storage version][int32 payload length].
    raw = path.read_bytes()
    storage_version, declared_len = struct.unpack_from("<ii", raw, 0)
    body = raw[8:]
    if declared_len != len(body):
        print(f"warning: declared length ({declared_len}) != actual payload ({len(body)})",
              file=sys.stderr)
    comp = None
    try:
        body = zlib.decompress(body); comp = "zlib"
    except Exception:
        try:
            body = gzip.decompress(body); comp = "gzip"
        except Exception:
            pass
    r = R(body)
    t = r.u8(); name = r.s()
    if t != 10:
        raise ValueError("root is not a compound")
    return _payload_with_name(r, 10, name), comp, storage_version

# ---------- writing ----------
def w_u8(out, v): out.append(v & 0xFF)
def w_i16(out, v): out += struct.pack("<h", v)
def w_i32(out, v): out += struct.pack("<i", v)
def w_s(out, s):
    b = s.encode("utf-8")
    out += struct.pack("<H", len(b)); out += b

def write_value(out, t, v):
    if t == 1: w_u8(out, v)
    elif t == 2: out += struct.pack("<h", v)
    elif t == 3: out += struct.pack("<i", v)
    elif t == 4: out += struct.pack("<q", v)
    elif t == 5: out += struct.pack("<f", v)
    elif t == 6: out += struct.pack("<d", v)
    elif t == 7: out += struct.pack("<i", len(v)); out += v
    elif t == 8: w_s(out, v)
    elif t == 9:
        et, items = v
        w_u8(out, et); out += struct.pack("<i", len(items))
        for it in items:
            if et == 10: dump_compound(out, it)
            else: write_value(out, et, it)
    elif t == 10:
        dump_compound(out, v)
    else:
        raise ValueError(f"tag {t}")

def dump_compound(out, d):
    for name, (t, v) in d.items():
        w_u8(out, t); w_s(out, name)
        write_value(out, t, v)
    out.append(0)

def main():
    world_dir = Path(sys.argv[1])
    exp_name = sys.argv[2]
    on = sys.argv[3].lower() == "on"
    path = world_dir / "level.dat"
    backup = world_dir / "level.dat.camera-menu-backup"

    raw = path.read_bytes()
    if not backup.exists():
        shutil.copy2(path, backup)
        print(f"backup: {backup}")

    root, comp, storage_version = read_root(path)

    t, exps = root.get("experiments", (10, {}))
    if t != 10 or not isinstance(exps, dict):
        exps = {}
    exps[exp_name] = (1, 1 if on else 0)
    exps["experiments_ever_used"] = (1, 1)
    exps["saved_with_toggled_experiments"] = (1, 1)
    root["experiments"] = (10, exps)

    out = bytearray()
    w_u8(out, 10); w_s(out, "")
    dump_compound(out, root)

    payload = bytes(out)
    if comp == "zlib": payload = zlib.compress(payload)
    elif comp == "gzip": payload = gzip.compress(payload)

    header = struct.pack("<ii", storage_version, len(payload))
    path.write_bytes(header + payload)

    # read it back to verify
    root2, _, ver2 = read_root(path)
    t2, exps2 = root2["experiments"]
    print(f"storage version: {ver2} | experiments now: "
          f"{ {k: v[1] for k, v in exps2.items()} }")

if __name__ == "__main__":
    main()
