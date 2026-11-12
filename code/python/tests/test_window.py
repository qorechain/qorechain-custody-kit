# SPDX-License-Identifier: Apache-2.0
"""MsgOpenEVMWindow with every optional field (5 to 9) set, encoded field by
field here rather than read from the vectors file."""

from qorechain_custody_kit import CustodyKitError, decode_message

TYPE = "/qorechain.pqc.v1.MsgOpenEVMWindow"
SENDER = "qor1npvwllfr9dqr8erajqqr6s0vxnk2ak55am9g2c"
TARGET = "0x000000000000000000000000000000000000dEaD"
VALIDATOR = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"
VALOPER1 = "qorvaloper19rl4cm2hmr8afy4kldpxz3fka4jguq0a5ws5he"
VALOPER2 = "qorvaloper1npvwllfr9dqr8erajqqr6s0vxnk2ak55p70zhk"
RECEIVER = "channel-0/cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4"


def _varint(v: int) -> bytes:
    out = bytearray()
    while True:
        b = v & 0x7F
        v >>= 7
        if v:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def _str(num: int, s: str) -> bytes:
    b = s.encode("utf-8")
    return _varint(num << 3 | 2) + _varint(len(b)) + b


def _uint(num: int, v: int) -> bytes:
    return _varint(num << 3) + _varint(v)


FULL = b"".join(
    [
        _str(1, SENDER),
        _uint(2, 600),
        _uint(3, 10),
        _str(4, "25000000"),
        _uint(5, 1),
        _str(6, TARGET),
        _str(7, VALIDATOR),
        _str(8, VALOPER1),
        _str(8, VALOPER2),
        _str(9, RECEIVER),
    ]
)


def _code(fn):
    try:
        fn()
    except CustodyKitError as e:
        return e.code
    return "NO_ERROR"


def test_decodes_every_field():
    assert decode_message(TYPE, FULL) == {
        "typeUrl": TYPE,
        "fields": {
            "sender": SENDER,
            "blocks": "600",
            "max_txs": "10",
            "max_value": "25000000",
            "native_only": True,
            "allowed_targets": [TARGET],
            "validators": [VALIDATOR],
            "staking_validators": [VALOPER1, VALOPER2],
            "ibc_receivers": [RECEIVER],
        },
        "value": None,
    }


def test_still_refuses_unknown_field_10():
    assert _code(lambda: decode_message(TYPE, FULL + _str(10, "x"))) == "UNKNOWN_FIELD"
    assert _code(lambda: decode_message(TYPE, FULL + _uint(10, 1))) == "UNKNOWN_FIELD"


def test_refuses_list_field_with_wrong_wire_type():
    assert _code(lambda: decode_message(TYPE, FULL + _uint(9, 1))) == "MALFORMED_TX"
