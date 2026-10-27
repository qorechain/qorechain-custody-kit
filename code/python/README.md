# Custody kit: Python

Pure-Python port of the kit's validators and helpers. No runtime dependency.

| Function | Needs |
|---|---|
| `validate_address` (`qor1`, `qorvaloper1`, `0x` with EIP-55) | nothing |
| `decode_tx`, `decode_message` | nothing |
| `build_deposit_query`, `deposit_event_query`, `extract_deposits` | nothing |
| `verify_tx` | **requires qorechain-qoresign 0.1.1** (`pip install qorechain-qoresign==0.1.1`) |

`verify_tx` uses QoreSign for the secp256k1 and ML-DSA-87 verification. Until
qorechain-qoresign 0.1.1 is on PyPI, `verify_tx` raises `ImportError` and its
tests are skipped. The Keccak-256 in this package is used only for the EIP-55
address checksum, never for signatures.

Errors are `CustodyKitError` with a stable `code` (`MALFORMED_TX`,
`UNKNOWN_FIELD`, `INVALID_ARGUMENT`); `validate_address` never raises and
returns `{"valid": False, "error": CODE}` instead.

## Test

```bash
cd code/python
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
pytest                                   # vectors; verify_tx tests skip without qoresign
pip install qorechain-qoresign==0.1.1    # once published: runs the verify_tx tests too
QORE_LIVE_TEST=1 pytest tests/test_live.py   # read-only testnet checks
```

`QORE_REST` overrides the REST endpoint of the live checks and of the
`deposits` command (default `https://api-testnet.qore.host`). Run
`scripts/fetch-qoresign-vectors.sh` from the repository root to add the
QoreSign vectors to the run.

## Command line

```bash
cd code/python/src
python -m qorechain_custody_kit validate qor19rl4cm2hmr8afy4kldpxz3fka4jguq0agt672h
python -m qorechain_custody_kit decode <tx hex or base64>
python -m qorechain_custody_kit verify <tx> --chain-id qorechain-diana --account-number N --pubkey HEX [--eth] [--pq-pubkey HEX]
python -m qorechain_custody_kit deposits <address> --from-height H --to-height H
```

Python 3.9 or later. Not published to PyPI.
