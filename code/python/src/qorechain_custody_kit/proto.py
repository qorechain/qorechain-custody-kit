# SPDX-License-Identifier: Apache-2.0
"""A strict protobuf reader, enough to decode transactions.

It refuses truncated input, overlong varints and the group wire types.
"""

import re
from typing import List, NamedTuple, Optional

from .errors import MALFORMED_TX, CustodyKitError

WIRE_VARINT = 0
WIRE_FIXED64 = 1
WIRE_LEN = 2
WIRE_FIXED32 = 5


class Field(NamedTuple):
    num: int
    wire: int
    int_value: Optional[int]
    data: Optional[bytes]


def _malformed(message: str) -> CustodyKitError:
    return CustodyKitError(MALFORMED_TX, message)


def _read_varint(buf: bytes, pos: int):
    result = 0
    shift = 0
    for _ in range(10):
        if pos >= len(buf):
            raise _malformed("truncated varint")
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if b & 0x80 == 0:
            if result >= 1 << 64:
                raise _malformed("varint overflows 64 bits")
            return result, pos
        shift += 7
    raise _malformed("varint longer than 10 bytes")


def read_fields(buf: bytes) -> List[Field]:
    """Read every field of a message, in order."""
    out: List[Field] = []
    pos = 0
    while pos < len(buf):
        key, pos = _read_varint(buf, pos)
        num = key >> 3
        wire = key & 7
        if num == 0:
            raise _malformed("field number 0")
        if wire == WIRE_VARINT:
            v, pos = _read_varint(buf, pos)
            out.append(Field(num, wire, v, None))
        elif wire in (WIRE_FIXED64, WIRE_FIXED32):
            n = 8 if wire == WIRE_FIXED64 else 4
            if pos + n > len(buf):
                raise _malformed("truncated fixed field")
            out.append(Field(num, wire, None, bytes(buf[pos : pos + n])))
            pos += n
        elif wire == WIRE_LEN:
            length, pos = _read_varint(buf, pos)
            if length > len(buf) - pos:
                raise _malformed("length-delimited field runs past the end")
            out.append(Field(num, wire, None, bytes(buf[pos : pos + length])))
            pos += length
        else:
            raise _malformed(f"unsupported wire type {wire}")
    return out


def expect_wire(f: Field, wire: int, what: str) -> None:
    if f.wire != wire:
        raise _malformed(f"{what}: field {f.num} has wire type {f.wire}, expected {wire}")


def as_string(f: Field, what: str) -> str:
    expect_wire(f, WIRE_LEN, what)
    try:
        return f.data.decode("utf-8")  # type: ignore[union-attr]
    except UnicodeDecodeError:
        raise _malformed(f"{what}: field {f.num} is not valid UTF-8") from None


def as_bytes(f: Field, what: str) -> bytes:
    expect_wire(f, WIRE_LEN, what)
    return f.data  # type: ignore[return-value]


def as_uint(f: Field, what: str) -> int:
    expect_wire(f, WIRE_VARINT, what)
    return f.int_value  # type: ignore[return-value]


def from_hex(text: str) -> bytes:
    """Bytes from a hex string, with or without ``0x``."""
    clean = text[2:] if text.startswith("0x") else text
    if len(clean) % 2 or re.fullmatch(r"[0-9a-fA-F]*", clean) is None:
        raise CustodyKitError("INVALID_ARGUMENT", "not a hex string")
    return bytes.fromhex(clean)
