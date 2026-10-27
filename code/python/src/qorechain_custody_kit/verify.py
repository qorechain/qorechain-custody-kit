# SPDX-License-Identifier: Apache-2.0
"""Verify a signed native-lane transaction before it is broadcast.

Requires qorechain-qoresign 0.1.1 (``pip install qorechain-qoresign==0.1.1``),
which provides the secp256k1 and ML-DSA-87 verification. The rest of this
package works without it.

Checks the secp256k1 signature, the ML-DSA-87 layer against the account's
registered key, and that the signer recorded in the transaction is the
expected key.
"""

from typing import Any, Dict, Optional

from .decode import decode_tx

QORESIGN_REQUIREMENT = "qorechain-qoresign==0.1.1"


def _qoresign() -> Any:
    try:
        import qoresign  # type: ignore[import-not-found]
    except ImportError as e:
        raise ImportError(
            f"verify_tx requires qorechain-qoresign 0.1.1 (pip install {QORESIGN_REQUIREMENT})"
        ) from e
    return qoresign


def verify_tx(
    tx_bytes: bytes,
    chain_id: str,
    account_number: int,
    classical_public_key: bytes,
    classical_key_type: str = "secp256k1",
    pq_public_key: Optional[bytes] = None,
    sign_bytes_version: str = "v2",
) -> Dict[str, Any]:
    """Verify a single-signer transaction. Requires qorechain-qoresign 0.1.1.

    ``classical_key_type`` is ``secp256k1`` (coin type 118 accounts) or
    ``eth_secp256k1`` (eth-native accounts). Omit ``pq_public_key`` to check
    the classical signature only. Returns ``{"valid", "classical",
    "signerKey", "pq"}`` with ``signerKey`` one of ``match``, ``absent``,
    ``mismatch``. Raises on malformed input, never on a bad signature.
    """
    qs = _qoresign()
    decoded = decode_tx(tx_bytes)
    signers = decoded["signers"]
    signer_key = "absent"
    if len(signers) == 1 and signers[0]["publicKey"]:
        signer_key = "match" if signers[0]["publicKey"] == bytes(classical_public_key).hex() else "mismatch"
    elif len(signers) != 1:
        signer_key = "mismatch"
    key_type = qs.ClassicalKeyType.ETH_SECP256K1 if classical_key_type == "eth_secp256k1" else qs.ClassicalKeyType.SECP256K1
    version = {"v1": qs.VerifyVersion.V1, "v2": qs.VerifyVersion.V2, "either": qs.VerifyVersion.EITHER}[sign_bytes_version]
    r = qs.verify_hybrid_tx(
        bytes(tx_bytes),
        chain_id,
        int(account_number),
        bytes(classical_public_key),
        pq_public_key=bytes(pq_public_key) if pq_public_key is not None else None,
        classical_key_type=key_type,
        version=version,
    )
    pq = None
    if r.pq is not None:
        pq = {
            "valid": r.pq.valid,
            "signBytesVersion": r.pq.sign_bytes_version.name.lower() if r.pq.sign_bytes_version is not None else None,
            "reason": r.pq.reason.name.lower() if r.pq.reason is not None else None,
        }
    return {"valid": r.valid and signer_key != "mismatch", "classical": r.classical, "signerKey": signer_key, "pq": pq}
