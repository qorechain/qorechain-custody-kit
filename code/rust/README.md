# Custody kit: Rust

Rust port of the kit's validators and helpers, built on the
[`qorechain-qoresign`](https://crates.io/crates/qorechain-qoresign) crate. It is
reference code for custodians and exchanges and is not published to crates.io.

| Function | What it does |
|---|---|
| `validate_address` | `qor1...`, `qorvaloper1...` and `0x...` addresses: bech32 and EIP-55 checksums, prefix, length, with stable error codes |
| `decode_tx`, `decode_message` | decode a signed `TxRaw`: messages and their fields, memo, fee, signer, ML-DSA-87 layer |
| `verify_tx` | secp256k1 signature, ML-DSA-87 layer against the registered key, and the signer key recorded in the transaction |
| `build_deposit_query`, `extract_deposits` | REST query for incoming transfers to an address, and the credit decision for each transfer in a `tx_response` |

Outputs serialize (serde) to the same JSON shapes as the TypeScript reference
in `code/ts`, and every function is checked against `vectors/custody-v1.json`.

## Test

```bash
cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
../../scripts/fetch-qoresign-vectors.sh   # optional: also check the QoreSign hybrid vectors
QORE_LIVE_TEST=1 cargo test --test live   # read-only checks against the testnet
```

`QORE_REST` points the live checks and the example at another REST endpoint,
for example your own node.

## Example

```bash
cargo run --example custody-kit -- validate 0x9858EfFD232B4033E47d90003D41EC34EcaEda94
cargo run --example custody-kit -- decode <tx hex or base64>
cargo run --example custody-kit -- verify <tx hex> --chain-id qorechain-diana \
  --account-number 7 --pubkey <hex> [--eth] [--pq-pubkey <hex>]
cargo run --example custody-kit -- deposits qor1... --from-height 100 --to-height 200
```

The live checks and the example use `ureq` over `native-tls` with the system
root certificates; the library itself makes no network calls.
