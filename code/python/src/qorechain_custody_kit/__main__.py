# SPDX-License-Identifier: Apache-2.0
"""Example command line over the kit.

    python -m qorechain_custody_kit validate <address> [--allow-validator] [--require-eip55]
    python -m qorechain_custody_kit decode <tx hex or base64>
    python -m qorechain_custody_kit verify <tx hex or base64> --chain-id ID --account-number N
                                           --pubkey HEX [--eth] [--pq-pubkey HEX]
    python -m qorechain_custody_kit deposits <address> [--from-height H] [--to-height H] [--rest URL]

``verify`` requires qorechain-qoresign 0.1.1.
"""

import argparse
import base64
import json
import os
import re
import sys
from typing import List, Optional

from .address import validate_address
from .decode import decode_tx
from .deposits import build_deposit_query, extract_deposits
from .errors import CustodyKitError
from .proto import from_hex
from .rest import DEFAULT_TESTNET_REST, get_json
from .verify import verify_tx


def _tx_bytes(text: str) -> bytes:
    if re.fullmatch(r"(0x)?[0-9a-fA-F]+", text):
        return from_hex(text)
    return base64.b64decode(text, validate=True)


def _print(value: object) -> None:
    print(json.dumps(value, indent=2))


def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(prog="python -m qorechain_custody_kit")
    sub = p.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate")
    v.add_argument("address")
    v.add_argument("--allow-validator", action="store_true")
    v.add_argument("--require-eip55", action="store_true")
    d = sub.add_parser("decode")
    d.add_argument("tx")
    vt = sub.add_parser("verify")
    vt.add_argument("tx")
    vt.add_argument("--chain-id", required=True)
    vt.add_argument("--account-number", required=True, type=int)
    vt.add_argument("--pubkey", required=True)
    vt.add_argument("--eth", action="store_true")
    vt.add_argument("--pq-pubkey")
    dep = sub.add_parser("deposits")
    dep.add_argument("address")
    dep.add_argument("--from-height", type=int)
    dep.add_argument("--to-height", type=int)
    dep.add_argument("--rest", default=os.environ.get("QORE_REST", DEFAULT_TESTNET_REST))
    a = p.parse_args(argv)

    if a.cmd == "validate":
        allow = ["account", "validator"] if a.allow_validator else ["account"]
        r = validate_address(a.address, allow=allow, require_eip55=a.require_eip55)
        _print(r)
        return 0 if r["valid"] else 1
    if a.cmd == "decode":
        _print(decode_tx(_tx_bytes(a.tx)))
        return 0
    if a.cmd == "verify":
        r = verify_tx(
            _tx_bytes(a.tx),
            a.chain_id,
            a.account_number,
            from_hex(a.pubkey),
            classical_key_type="eth_secp256k1" if a.eth else "secp256k1",
            pq_public_key=from_hex(a.pq_pubkey) if a.pq_pubkey else None,
        )
        _print(r)
        return 0 if r["valid"] else 1
    path = build_deposit_query(a.address, min_height=a.from_height, max_height=a.to_height)
    body = get_json(a.rest, path)
    entries = []
    for resp in body.get("tx_responses") or []:
        entries.extend(extract_deposits(resp, a.address))
    _print(entries)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (CustodyKitError, ImportError) as e:
        print(e, file=sys.stderr)
        sys.exit(1)
