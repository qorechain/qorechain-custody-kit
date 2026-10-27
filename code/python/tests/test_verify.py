# SPDX-License-Identifier: Apache-2.0
"""verify_tx: requires qorechain-qoresign 0.1.1 (skipped when it is not installed)."""

import json

import pytest

from qorechain_custody_kit import from_hex, verify_tx

from .conftest import VECTORS_DIR

pytest.importorskip("qoresign", reason="verify_tx requires qorechain-qoresign 0.1.1")

V = json.loads((VECTORS_DIR / "custody-v1.json").read_text(encoding="utf-8"))
CASES = [(t, c) for t in V["transactions"] for c in t["verifyCases"]]


@pytest.mark.parametrize("tx,case", CASES, ids=[f"{t['name']}: {c['description']}" for t, c in CASES])
def test_verify_tx(tx, case):
    r = verify_tx(
        from_hex(tx["txBytes"]),
        case.get("chainId", tx["chainId"]),
        case.get("accountNumber", tx["accountNumber"]),
        from_hex(case.get("classicalPublicKey", tx["classicalPublicKey"])),
        classical_key_type=case.get("classicalKeyType", tx["classicalKeyType"]),
        pq_public_key=None if case.get("omitPqPublicKey") else from_hex(case.get("pqPublicKey", tx["pqPublicKey"])),
    )
    assert r == case["expected"]


QS = VECTORS_DIR / "qoresign-v1.json"


@pytest.mark.skipif(not QS.exists(), reason="run scripts/fetch-qoresign-vectors.sh first")
def test_qoresign_vectors_hybrid_tx():
    q = json.loads(QS.read_text(encoding="utf-8"))
    for c in q["hybridTx"]["cases"]:
        r = verify_tx(
            from_hex(c["txBytes"]),
            q["chainId"],
            q["hybridTx"]["accountNumber"],
            from_hex(q["accounts"]["secp256k1"]["publicKey"]),
            pq_public_key=from_hex(q["canonical"][0]["publicKey"]),
            sign_bytes_version="either",
        )
        assert r == {
            "valid": True,
            "classical": True,
            "signerKey": "match",
            "pq": {"valid": True, "signBytesVersion": c["signBytesVersion"], "reason": None},
        }
