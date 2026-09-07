"""Deterministic Ogg bitstream serial: libvorbisenc picks a random serial per stream, so two runs that synthesise
identical audio still write different bytes and every regeneration churns the whole asset folder in git. Rewriting the
serial to a value derived from the file name and fixing up each page's CRC makes the output byte-stable."""
import numpy as np

_TBL = np.zeros(256, dtype=np.uint32)
for _i in range(256):
    _r = _i << 24
    for _ in range(8):
        _r = ((_r << 1) ^ 0x04C11DB7) & 0xFFFFFFFF if (_r & 0x80000000) else (_r << 1) & 0xFFFFFFFF
    _TBL[_i] = _r
_TBL_L = [int(x) for x in _TBL]


def _crc(buf) -> int:
    crc = 0
    t = _TBL_L
    for b in buf:
        crc = ((crc << 8) & 0xFFFFFFFF) ^ t[((crc >> 24) & 0xFF) ^ b]
    return crc


def stamp(path: str, serial: int) -> bool:
    """Rewrite every Ogg page in `path` with `serial` and a recomputed CRC. Returns True if the file changed."""
    data = bytearray(open(path, "rb").read())
    ser = (serial & 0xFFFFFFFF).to_bytes(4, "little")
    pos = 0
    n = len(data)
    changed = False
    while pos + 27 <= n:
        if data[pos:pos + 4] != b"OggS":
            break
        nseg = data[pos + 26]
        hdr = 27 + nseg
        if pos + hdr > n:
            break
        body = sum(data[pos + 27:pos + 27 + nseg])
        end = pos + hdr + body
        if end > n:
            break
        if data[pos + 14:pos + 18] != ser:
            changed = True
        data[pos + 14:pos + 18] = ser
        data[pos + 22:pos + 26] = b"\0\0\0\0"
        c = _crc(memoryview(data)[pos:end])
        data[pos + 22:pos + 26] = (c & 0xFFFFFFFF).to_bytes(4, "little")
        pos = end
    if changed:
        open(path, "wb").write(bytes(data))
    return changed
