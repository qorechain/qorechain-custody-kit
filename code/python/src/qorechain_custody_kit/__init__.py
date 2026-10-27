# SPDX-License-Identifier: Apache-2.0
"""QoreChain custody kit, Python port.

Address validation, transaction decoding and the deposit filter need no
dependency. ``verify_tx`` requires qorechain-qoresign 0.1.1.
"""

from .address import ACCOUNT_PREFIX, VALIDATOR_PREFIX, eip55, validate_address
from .bech32 import bech32_decode, bech32_encode
from .decode import KNOWN_MESSAGES, PQC_HYBRID_TYPE_URL, decode_message, decode_tx
from .deposits import (
    FEE_COLLECTOR,
    MSG_ETHEREUM_TX,
    MSG_MULTI_SEND,
    MSG_SEND,
    build_deposit_query,
    deposit_event_query,
    extract_deposits,
    percent_encode,
)
from .errors import INVALID_ARGUMENT, MALFORMED_TX, UNKNOWN_FIELD, CustodyKitError
from .keccak import keccak256
from .proto import from_hex
from .rest import DEFAULT_TESTNET_REST, get_json
from .verify import QORESIGN_REQUIREMENT, verify_tx

__version__ = "0.1.0"

__all__ = [
    "ACCOUNT_PREFIX",
    "VALIDATOR_PREFIX",
    "eip55",
    "validate_address",
    "bech32_decode",
    "bech32_encode",
    "KNOWN_MESSAGES",
    "PQC_HYBRID_TYPE_URL",
    "decode_message",
    "decode_tx",
    "FEE_COLLECTOR",
    "MSG_ETHEREUM_TX",
    "MSG_MULTI_SEND",
    "MSG_SEND",
    "build_deposit_query",
    "deposit_event_query",
    "extract_deposits",
    "percent_encode",
    "INVALID_ARGUMENT",
    "MALFORMED_TX",
    "UNKNOWN_FIELD",
    "CustodyKitError",
    "keccak256",
    "from_hex",
    "DEFAULT_TESTNET_REST",
    "get_json",
    "QORESIGN_REQUIREMENT",
    "verify_tx",
]
