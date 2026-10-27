# SPDX-License-Identifier: Apache-2.0
"""Decode a signed native-lane transaction (``TxRaw``).

The result is what a custody operator reviews before broadcasting: the
messages and their fields, the fee, the signer, and whether the ML-DSA-87
layer is present.
"""

import hashlib
from typing import Any, Dict, List, Optional, Tuple

from .errors import MALFORMED_TX, UNKNOWN_FIELD, CustodyKitError
from .proto import WIRE_LEN, Field, as_bytes, as_string, as_uint, expect_wire, read_fields

PQC_HYBRID_TYPE_URL = "/qorechain.pqc.v1.PQCHybridSignature"

_DELEGATION = [(1, "delegator_address", "string"), (2, "validator_address", "string"), (3, "amount", "coin")]

#: Field layouts of the message types a custodian handles.
KNOWN_MESSAGES: Dict[str, List[Tuple[int, str, str]]] = {
    "/cosmos.bank.v1beta1.MsgSend": [(1, "from_address", "string"), (2, "to_address", "string"), (3, "amount", "coins")],
    "/cosmos.bank.v1beta1.MsgMultiSend": [(1, "inputs", "io"), (2, "outputs", "io")],
    "/cosmos.staking.v1beta1.MsgDelegate": _DELEGATION,
    "/cosmos.staking.v1beta1.MsgUndelegate": _DELEGATION,
    "/cosmos.staking.v1beta1.MsgBeginRedelegate": [
        (1, "delegator_address", "string"),
        (2, "validator_src_address", "string"),
        (3, "validator_dst_address", "string"),
        (4, "amount", "coin"),
    ],
    "/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation": [
        (1, "delegator_address", "string"),
        (2, "validator_address", "string"),
        (3, "amount", "coin"),
        (4, "creation_height", "uint"),
    ],
    "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward": [
        (1, "delegator_address", "string"),
        (2, "validator_address", "string"),
    ],
    "/cosmos.distribution.v1beta1.MsgSetWithdrawAddress": [
        (1, "delegator_address", "string"),
        (2, "withdraw_address", "string"),
    ],
    "/qorechain.stakingtier.v1.MsgLockDelegation": [
        (1, "delegator", "string"),
        (2, "validator", "string"),
        (3, "amount", "string"),
        (4, "months", "uint"),
    ],
    "/qorechain.stakingtier.v1.MsgUnlockEarly": [(1, "delegator", "string"), (2, "lock_id", "uint")],
    "/qorechain.stakingtier.v1.MsgClaimBonus": [(1, "holder", "string")],
    "/qorechain.pqc.v1.MsgRegisterPQCKeyV2": [
        (1, "sender", "string"),
        (2, "public_key", "bytes"),
        (3, "algorithm_id", "uint"),
        (4, "ecdsa_pubkey", "bytes"),
        (5, "key_type", "string"),
        (6, "proof_of_possession", "bytes"),
    ],
    "/qorechain.pqc.v1.MsgRotatePQCKey": [
        (1, "sender", "string"),
        (2, "old_public_key", "bytes"),
        (3, "new_public_key", "bytes"),
        (4, "old_signature", "bytes"),
        (5, "new_signature", "bytes"),
    ],
    "/qorechain.pqc.v1.MsgOpenEVMWindow": [
        (1, "sender", "string"),
        (2, "blocks", "uint"),
        (3, "max_txs", "uint"),
        (4, "max_value", "string"),
        (5, "native_only", "bool"),
        (6, "allowed_targets", "strings"),
    ],
    "/qorechain.pqc.v1.MsgCloseEVMWindow": [(1, "sender", "string")],
}

_SINGLE_KEY_TYPES = {"/cosmos.crypto.secp256k1.PubKey", "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey"}


def _unknown(what: str, f: Field) -> CustodyKitError:
    return CustodyKitError(UNKNOWN_FIELD, f"{what}: unknown field {f.num}")


def _coin(data: bytes) -> Dict[str, str]:
    coin = {"denom": "", "amount": ""}
    for f in read_fields(data):
        if f.num == 1:
            coin["denom"] = as_string(f, "Coin")
        elif f.num == 2:
            coin["amount"] = as_string(f, "Coin")
        else:
            raise _unknown("Coin", f)
    return coin


def _io(data: bytes) -> Dict[str, Any]:
    io: Dict[str, Any] = {"address": "", "coins": []}
    for f in read_fields(data):
        if f.num == 1:
            io["address"] = as_string(f, "Input/Output")
        elif f.num == 2:
            io["coins"].append(_coin(as_bytes(f, "Input/Output")))
        else:
            raise _unknown("Input/Output", f)
    return io


def _default(kind: str) -> Any:
    if kind in ("string", "bytes"):
        return ""
    if kind == "uint":
        return "0"
    if kind == "bool":
        return False
    if kind == "coin":
        return None
    return []


def decode_message(type_url: str, value: bytes) -> Dict[str, Any]:
    """Decode one message. Unknown types come back with their bytes in hex."""
    layout = KNOWN_MESSAGES.get(type_url)
    if layout is None:
        return {"typeUrl": type_url, "fields": None, "value": bytes(value).hex()}
    fields: Dict[str, Any] = {name: _default(kind) for _, name, kind in layout}
    for f in read_fields(value):
        spec = next((s for s in layout if s[0] == f.num), None)
        if spec is None:
            raise _unknown(type_url, f)
        _, name, kind = spec
        if kind == "string":
            fields[name] = as_string(f, type_url)
        elif kind == "bytes":
            fields[name] = as_bytes(f, type_url).hex()
        elif kind == "uint":
            fields[name] = str(as_uint(f, type_url))
        elif kind == "bool":
            fields[name] = as_uint(f, type_url) != 0
        elif kind == "coin":
            fields[name] = _coin(as_bytes(f, type_url))
        elif kind == "coins":
            fields[name].append(_coin(as_bytes(f, type_url)))
        elif kind == "strings":
            fields[name].append(as_string(f, type_url))
        elif kind == "io":
            fields[name].append(_io(as_bytes(f, type_url)))
    return {"typeUrl": type_url, "fields": fields, "value": None}


def _any(data: bytes, what: str) -> Tuple[str, bytes]:
    type_url = ""
    value = b""
    for f in read_fields(data):
        if f.num == 1:
            type_url = as_string(f, what)
        elif f.num == 2:
            value = as_bytes(f, what)
        else:
            raise _unknown(what, f)
    return type_url, value


def _pqc_layer(data: bytes) -> Dict[str, int]:
    out = {"algorithmId": 0, "signatureLength": 0, "publicKeyLength": 0}
    for f in read_fields(data):
        if f.num == 1:
            out["algorithmId"] = as_uint(f, "PQCHybridSignature")
        elif f.num == 2:
            out["signatureLength"] = len(as_bytes(f, "PQCHybridSignature"))
        elif f.num == 3:
            out["publicKeyLength"] = len(as_bytes(f, "PQCHybridSignature"))
        else:
            raise _unknown("PQCHybridSignature", f)
    return out


def _signer(data: bytes) -> Dict[str, Any]:
    s: Dict[str, Any] = {"publicKeyType": None, "publicKey": None, "sequence": "0", "signMode": None}
    for f in read_fields(data):
        if f.num == 1:
            type_url, value = _any(as_bytes(f, "SignerInfo"), "SignerInfo.public_key")
            s["publicKeyType"] = type_url
            if type_url in _SINGLE_KEY_TYPES:
                for k in read_fields(value):
                    if k.num == 1:
                        s["publicKey"] = as_bytes(k, "PubKey").hex()
                    else:
                        raise _unknown("PubKey", k)
        elif f.num == 2:
            for m in read_fields(as_bytes(f, "ModeInfo")):
                if m.num == 1:
                    s["signMode"] = 0
                    for single in read_fields(as_bytes(m, "ModeInfo.Single")):
                        if single.num == 1:
                            s["signMode"] = as_uint(single, "ModeInfo.Single")
                        else:
                            raise _unknown("ModeInfo.Single", single)
                elif m.num == 2:
                    expect_wire(m, WIRE_LEN, "ModeInfo.Multi")
                    s["signMode"] = None
                else:
                    raise _unknown("ModeInfo", m)
        elif f.num == 3:
            s["sequence"] = str(as_uint(f, "SignerInfo"))
        else:
            raise _unknown("SignerInfo", f)
    return s


def decode_tx(tx_bytes: bytes) -> Dict[str, Any]:
    """Decode a signed ``TxRaw``. Raises ``CustodyKitError`` (``MALFORMED_TX`` or ``UNKNOWN_FIELD``)."""
    body: Optional[bytes] = None
    auth: Optional[bytes] = None
    signature_count = 0
    for f in read_fields(tx_bytes):
        if f.num == 1:
            body = as_bytes(f, "TxRaw")
        elif f.num == 2:
            auth = as_bytes(f, "TxRaw")
        elif f.num == 3:
            as_bytes(f, "TxRaw")
            signature_count += 1
        else:
            raise _unknown("TxRaw", f)
    if body is None or auth is None:
        raise CustodyKitError(MALFORMED_TX, "TxRaw needs body_bytes and auth_info_bytes")

    tx: Dict[str, Any] = {
        "txHash": hashlib.sha256(tx_bytes).hexdigest().upper(),
        "messages": [],
        "memo": "",
        "timeoutHeight": "0",
        "unordered": False,
        "timeoutTimestampSeconds": "0",
        "extensionOptions": [],
        "nonCriticalExtensionOptions": [],
        "pqcLayers": [],
        "signers": [],
        "fee": {"amount": [], "gasLimit": "0", "payer": "", "granter": ""},
        "signatureCount": signature_count,
    }

    for f in read_fields(body):
        if f.num == 1:
            type_url, value = _any(as_bytes(f, "TxBody"), "TxBody.messages")
            tx["messages"].append(decode_message(type_url, value))
        elif f.num == 2:
            tx["memo"] = as_string(f, "TxBody")
        elif f.num == 3:
            tx["timeoutHeight"] = str(as_uint(f, "TxBody"))
        elif f.num == 4:
            tx["unordered"] = as_uint(f, "TxBody") != 0
        elif f.num == 5:
            for t in read_fields(as_bytes(f, "TxBody")):
                if t.num == 1:
                    tx["timeoutTimestampSeconds"] = str(as_uint(t, "Timestamp"))
                elif t.num == 2:
                    as_uint(t, "Timestamp")
                else:
                    raise _unknown("Timestamp", t)
        elif f.num == 1023:
            type_url, value = _any(as_bytes(f, "TxBody"), "TxBody.extension_options")
            tx["extensionOptions"].append(type_url)
            if type_url == PQC_HYBRID_TYPE_URL:
                tx["pqcLayers"].append(_pqc_layer(value))
        elif f.num == 2047:
            type_url, _ = _any(as_bytes(f, "TxBody"), "TxBody.non_critical_extension_options")
            tx["nonCriticalExtensionOptions"].append(type_url)
        else:
            raise _unknown("TxBody", f)

    for f in read_fields(auth):
        if f.num == 1:
            tx["signers"].append(_signer(as_bytes(f, "AuthInfo")))
        elif f.num == 2:
            for g in read_fields(as_bytes(f, "AuthInfo")):
                if g.num == 1:
                    tx["fee"]["amount"].append(_coin(as_bytes(g, "Fee")))
                elif g.num == 2:
                    tx["fee"]["gasLimit"] = str(as_uint(g, "Fee"))
                elif g.num == 3:
                    tx["fee"]["payer"] = as_string(g, "Fee")
                elif g.num == 4:
                    tx["fee"]["granter"] = as_string(g, "Fee")
                else:
                    raise _unknown("Fee", g)
        else:
            raise _unknown("AuthInfo", f)
    return tx
