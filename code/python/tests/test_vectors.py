# SPDX-License-Identifier: Apache-2.0
"""Checks the Python port against vectors/custody-v1.json (no QoreSign needed)."""

import json

import pytest

from qorechain_custody_kit import (
    CustodyKitError,
    build_deposit_query,
    decode_message,
    decode_tx,
    extract_deposits,
    from_hex,
    keccak256,
    validate_address,
)

from .conftest import VECTORS_DIR

V = json.loads((VECTORS_DIR / "custody-v1.json").read_text(encoding="utf-8"))


def _code(fn):
    try:
        fn()
    except CustodyKitError as e:
        return e.code
    return "NO_ERROR"


def _query(opts):
    return build_deposit_query(
        opts["address"],
        min_height=opts.get("minHeight"),
        max_height=opts.get("maxHeight"),
        event=opts.get("event", "transfer"),
        page=opts.get("page", 1),
        limit=opts.get("limit", 50),
        order_by=opts.get("orderBy", "asc"),
    )


@pytest.mark.parametrize(
    "data,digest",
    [
        (b"", "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470"),
        (b"abc", "4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45"),
        (b"a" * 135, "34367dc248bbd832f4e3e69dfaac2f92638bd0bbd18f2912ba4ef454919cf446"),
        (b"a" * 136, "a6c4d403279fe3e0af03729caada8374b5ca54d8065329a3ebcaeb4b60aa386e"),
        (b"a" * 200, "96ea54061def936c4be90b518992fdc6f12f535068a256229aca54267b4d084d"),
    ],
)
def test_keccak256(data, digest):
    assert keccak256(data).hex() == digest


@pytest.mark.parametrize("case", V["addresses"]["valid"], ids=lambda c: repr(c["input"]))
def test_valid_address(case):
    r = validate_address(case["input"], allow=case.get("allow"), require_eip55=case.get("requireEip55", False))
    assert r == dict(valid=True, **case["expected"])


@pytest.mark.parametrize("case", V["addresses"]["invalid"], ids=lambda c: repr(c["input"]))
def test_invalid_address(case):
    r = validate_address(case["input"], allow=case.get("allow"), require_eip55=case.get("requireEip55", False))
    assert r["valid"] is False
    assert r["error"] == case["error"]


@pytest.mark.parametrize("tx", V["transactions"], ids=lambda t: t["name"])
def test_decode_tx(tx):
    assert decode_tx(from_hex(tx["txBytes"])) == tx["decoded"]


@pytest.mark.parametrize("m", V["messages"], ids=lambda m: m["typeUrl"])
def test_decode_message(m):
    assert decode_message(m["typeUrl"], from_hex(m["value"])) == m["decoded"]


@pytest.mark.parametrize("m", V["malformed"], ids=lambda m: m["name"])
def test_malformed(m):
    assert _code(lambda: decode_tx(from_hex(m["txBytes"]))) == m["error"]


@pytest.mark.parametrize("q", V["depositQueries"], ids=lambda q: q["expected"][:50])
def test_deposit_query(q):
    assert _query(q["options"]) == q["expected"]


@pytest.mark.parametrize("q", V["depositQueryErrors"], ids=lambda q: json.dumps(q["options"]))
def test_deposit_query_errors(q):
    assert _code(lambda: _query(q["options"])) == q["error"]


@pytest.mark.parametrize("d", V["deposits"], ids=lambda d: d["name"])
def test_extract_deposits(d):
    assert extract_deposits(d["txResponse"], d["address"], denom=d.get("denom", "uqor")) == d["expected"]
