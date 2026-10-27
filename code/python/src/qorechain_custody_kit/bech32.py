# SPDX-License-Identifier: Apache-2.0
"""Bech32 (BIP-173) with error classification.

QoreChain addresses use the original bech32 checksum, not bech32m.
"""

from typing import List, Tuple

CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
_GENERATOR = (0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3)


class Bech32DecodeError(ValueError):
    """``code`` is ``MIXED_CASE``, ``BAD_BECH32`` or ``BAD_CHECKSUM``."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def _polymod(values: List[int]) -> int:
    chk = 1
    for v in values:
        top = chk >> 25
        chk = ((chk & 0x1FFFFFF) << 5) ^ v
        for i in range(5):
            if (top >> i) & 1:
                chk ^= _GENERATOR[i]
    return chk


def _hrp_expand(hrp: str) -> List[int]:
    return [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp]


def _convert_bits(data: List[int], frm: int, to: int, pad: bool) -> List[int]:
    acc = 0
    bits = 0
    out: List[int] = []
    maxv = (1 << to) - 1
    for value in data:
        acc = (acc << frm) | value
        bits += frm
        while bits >= to:
            bits -= to
            out.append((acc >> bits) & maxv)
        acc &= (1 << bits) - 1
    if pad:
        if bits > 0:
            out.append((acc << (to - bits)) & maxv)
    elif bits >= frm or ((acc << (to - bits)) & maxv) != 0:
        raise Bech32DecodeError("BAD_BECH32", "invalid padding in the data part")
    return out


def bech32_decode(text: str) -> Tuple[str, bytes]:
    """Decode a bech32 string into its human-readable part and data bytes."""
    lower = text.lower()
    upper = text.upper()
    if text != lower and text != upper:
        raise Bech32DecodeError("MIXED_CASE", "bech32 strings must be all lowercase or all uppercase")
    pos = lower.rfind("1")
    if pos < 1 or pos + 7 > len(lower):
        raise Bech32DecodeError("BAD_BECH32", "missing separator, prefix or checksum")
    hrp = lower[:pos]
    for c in hrp:
        if ord(c) < 33 or ord(c) > 126:
            raise Bech32DecodeError("BAD_BECH32", "invalid character in the prefix")
    data: List[int] = []
    for ch in lower[pos + 1 :]:
        v = CHARSET.find(ch)
        if v == -1:
            raise Bech32DecodeError("BAD_BECH32", f"invalid character {ch!r}")
        data.append(v)
    if _polymod(_hrp_expand(hrp) + data) != 1:
        raise Bech32DecodeError("BAD_CHECKSUM", "bech32 checksum does not match")
    return hrp, bytes(_convert_bits(data[:-6], 5, 8, False))


def bech32_encode(hrp: str, data: bytes) -> str:
    """Encode bytes as bech32 (lowercase)."""
    words = _convert_bits(list(data), 8, 5, True)
    mod = _polymod(_hrp_expand(hrp) + words + [0] * 6) ^ 1
    check = [(mod >> (5 * (5 - i))) & 31 for i in range(6)]
    return hrp + "1" + "".join(CHARSET[w] for w in words + check)
