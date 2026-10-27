# SPDX-License-Identifier: Apache-2.0
"""Address validation for deposit and withdrawal forms.

A QoreChain account has one 20-byte address with two spellings: bech32
``qor1...`` and hex ``0x...`` (EIP-55 checksummed). Validator operator
addresses use the ``qorvaloper1...`` prefix over the same kind of 20 bytes.
"""

import re
from typing import Any, Dict, Iterable, Optional

from .bech32 import Bech32DecodeError, bech32_decode, bech32_encode
from .keccak import keccak256

ACCOUNT_PREFIX = "qor"
VALIDATOR_PREFIX = "qorvaloper"

_HEX40 = re.compile(r"^[0-9a-fA-F]{40}$")


def eip55(address_bytes: bytes) -> str:
    """EIP-55 checksummed hex form of 20 address bytes."""
    lower = address_bytes.hex()
    digest = keccak256(lower.encode("ascii")).hex()
    return "0x" + "".join(c.upper() if int(digest[i], 16) >= 8 else c for i, c in enumerate(lower))


def _fail(error: str, detail: str) -> Dict[str, Any]:
    return {"valid": False, "error": error, "detail": detail}


def validate_address(
    text: str,
    allow: Optional[Iterable[str]] = None,
    require_eip55: bool = False,
) -> Dict[str, Any]:
    """Validate a ``qor1...``, ``qorvaloper1...`` or ``0x...`` address.

    Never raises for a bad input: returns ``{"valid": False, "error": CODE, "detail": ...}``
    or ``{"valid": True, "kind", "format", "checksum", "bech32", "hex"}``.
    Accepts accounts only unless ``allow`` lists ``"validator"`` too.
    """
    allowed = list(allow) if allow is not None else ["account"]
    if not isinstance(text, str) or text == "":
        return _fail("EMPTY", "the address is empty")
    if text.strip() != text:
        return _fail("WHITESPACE", "the address has leading or trailing whitespace")

    if text.startswith("0x"):
        body = text[2:]
        if not _HEX40.match(body):
            return _fail("BAD_HEX", "a hex address is 0x followed by 40 hex digits")
        raw = bytes.fromhex(body)
        canonical = eip55(raw)
        mixed = re.search(r"[a-f]", body) is not None and re.search(r"[A-F]", body) is not None
        if text == canonical:
            checksum = "eip55"
        elif mixed:
            return _fail("BAD_EIP55", "the EIP-55 checksum (letter case) does not match")
        else:
            checksum = "none"
        if checksum == "none" and require_eip55:
            return _fail("NO_CHECKSUM", "the hex address carries no EIP-55 checksum")
        if "account" not in allowed:
            return _fail("KIND_NOT_ALLOWED", "a hex address is an account address")
        return {
            "valid": True,
            "kind": "account",
            "format": "hex",
            "checksum": checksum,
            "bech32": bech32_encode(ACCOUNT_PREFIX, raw),
            "hex": canonical,
        }

    try:
        hrp, raw = bech32_decode(text)
    except Bech32DecodeError as e:
        return _fail(e.code, str(e))
    if hrp == ACCOUNT_PREFIX:
        kind = "account"
    elif hrp == VALIDATOR_PREFIX:
        kind = "validator"
    else:
        return _fail("WRONG_PREFIX", f'expected the "{ACCOUNT_PREFIX}" or "{VALIDATOR_PREFIX}" prefix, got "{hrp}"')
    if len(raw) != 20:
        return _fail("BAD_LENGTH", f"addresses are 20 bytes, this one has {len(raw)}")
    if kind not in allowed:
        return _fail("KIND_NOT_ALLOWED", f"a {kind} address is not accepted here")
    return {
        "valid": True,
        "kind": kind,
        "format": "bech32",
        "checksum": "bech32",
        "bech32": bech32_encode(hrp, raw),
        "hex": eip55(raw),
    }
