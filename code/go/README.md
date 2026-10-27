# Custody kit: Go

Reference validators and helpers for custodians integrating QoreChain, built on
[QoreSign](https://github.com/qorechain/qoresign) (`github.com/qorechain/qoresign/go`).
Module `github.com/qorechain/qorechain-custody-kit/code/go`, package `custodykit`.
It is example code that you can copy or vendor; it is not published as a library.

| Function | What it does |
|---|---|
| `ValidateAddress` | `qor1...`, `qorvaloper1...` or `0x...`, with bech32 and EIP-55 checks and a stable error code |
| `DecodeTx`, `DecodeMessage` | decode a signed `TxRaw`: messages, fee, signer, ML-DSA-87 layer |
| `VerifyTx` | secp256k1 signature, ML-DSA-87 layer against the registered key, signer key match |
| `BuildDepositQuery`, `ExtractDeposits` | REST query for incoming transfers, and the credit decision per transfer |

Every function is checked against [`vectors/custody-v1.json`](../../vectors/custody-v1.json), the same file the
TypeScript, Python, Rust and Java code checks.

## Test

```bash
go vet ./... && go test ./...
../../scripts/fetch-qoresign-vectors.sh   # optional: also check the QoreSign hybrid vectors
QORE_LIVE_TEST=1 go test -run Live ./...  # read-only checks against the testnet
```

`QORE_REST` overrides the REST endpoint of the live checks and of the example
(default `https://api-testnet.qore.host`); point it at your own node in production.

## Example command line

```bash
go run ./cmd/custody-kit validate 0x9858EfFD232B4033E47d90003D41EC34EcaEda94
go run ./cmd/custody-kit decode <tx hex or base64>
go run ./cmd/custody-kit verify <tx> --chain-id qorechain-diana --account-number 868 \
  --pubkey <33-byte hex> --pq-pubkey <2592-byte hex>
go run ./cmd/custody-kit deposits qor1... --from-height 8976000
```

In `DepositQueryOptions`, a zero `Page` or `Limit` means the default (1 and 50).
