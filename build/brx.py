#!/usr/bin/env python3
"""Extract the camera preset names from a .brarchive file.

The format, worked out with a hexdump, is:

    offset 0    magic  7d 27 25 b1
    offset 4    uint32 (hash/version, not needed here)
    offset 8    uint32 entry count
    offset 12   uint32 (1 in the files shipped with 26.50)
    offset 16   count entries of 256 bytes each: 1-byte name length + 255-byte name buffer
    then        the payloads, packed together

`presets.brarchive` in the vanilla pack holds the normal camera presets; the one in
`experimental_creator_cameras` holds the ones that only exist when the experiment is on.
Knowing which is which is the difference between "this preset needs the experiment" and a
confusing silent failure.

  python3 build/brx.py <file.brarchive> [--dump <entry name>]
"""
import struct
import sys
from pathlib import Path

MAGIC = b"\x7d\x27\x25\xb1"
HEADER = 16
NAME_BUFFER = 255
ENTRY = 1 + NAME_BUFFER


def entries(raw):
    if raw[:4] != MAGIC:
        raise ValueError(f"not a brarchive (magic {raw[:4].hex()})")
    (count,) = struct.unpack_from("<I", raw, 8)
    names = []
    for i in range(count):
        off = HEADER + i * ENTRY
        name_len = raw[off]
        names.append(raw[off + 1 : off + 1 + name_len].decode("utf-8", "replace"))
    payloads_at = HEADER + count * ENTRY
    return names, raw[payloads_at:].decode("utf-8", "replace")


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(2)
    path = Path(args[0])
    names, payloads = entries(path.read_bytes())
    print(f"{path}: {len(names)} entries")
    for name in names:
        print(f"  {name}")
    if "--dump" in args:
        wanted = args[args.index("--dump") + 1]
        marker = f'"identifier":"minecraft:{Path(wanted).stem}"'
        at = payloads.find(marker)
        if at < 0:
            print(f"\n(no payload for {wanted})")
            return
        end = payloads.find("}{", at)
        print(f"\n--- {wanted} ---\n{payloads[at : end + 1 if end > 0 else len(payloads)]}")


if __name__ == "__main__":
    main()
