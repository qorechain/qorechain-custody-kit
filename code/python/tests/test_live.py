# SPDX-License-Identifier: Apache-2.0
"""Read-only checks against the testnet.

Run with QORE_LIVE_TEST=1; QORE_REST overrides the endpoint
(default https://api-testnet.qore.host).
"""

import os

import pytest

from qorechain_custody_kit import (
    DEFAULT_TESTNET_REST,
    build_deposit_query,
    extract_deposits,
    get_json,
    percent_encode,
)

pytestmark = pytest.mark.skipif(os.environ.get("QORE_LIVE_TEST") != "1", reason="set QORE_LIVE_TEST=1")
REST = os.environ.get("QORE_REST", DEFAULT_TESTNET_REST)


def test_staking_and_staking_tier_params():
    staking = get_json(REST, "/cosmos/staking/v1beta1/params")["params"]
    assert staking["bond_denom"] == "uqor"
    assert staking["unbonding_time"] == "1814400s"  # 21 days
    tier = get_json(REST, "/qorechain/stakingtier/v1/params")
    assert tier["enabled"] is True
    assert [t["months"] for t in tier["lock_tiers"]] == [3, 6, 12]


def test_deposit_query_finds_a_recent_transfer():
    q = percent_encode("message.action='/cosmos.bank.v1beta1.MsgSend'")
    recent = get_json(REST, f"/cosmos/tx/v1beta1/txs?query={q}&order_by=ORDER_BY_DESC&limit=20")
    target = None
    for resp in recent.get("tx_responses") or []:
        msgs = resp["tx"]["body"]["messages"]
        msg = msgs[0]
        uqor = sum(int(c["amount"]) for c in msg.get("amount") or [] if c["denom"] == "uqor")
        if resp["code"] == 0 and len(msgs) == 1 and uqor > 0 and msg["from_address"] != msg["to_address"]:
            target = (resp, msg["to_address"], uqor)
            break
    assert target is not None, "no recent MsgSend of uqor on the testnet"
    resp, to, amount = target
    height = int(resp["height"])
    body = get_json(REST, build_deposit_query(to, min_height=height, max_height=height))
    entries = [e for r in body.get("tx_responses") or [] for e in extract_deposits(r, to)]
    hit = next(e for e in entries if e["txhash"] == resp["txhash"])
    assert hit["creditable"] is True
    assert hit["messageType"] == "/cosmos.bank.v1beta1.MsgSend"
    assert hit["amount"] == str(amount)
