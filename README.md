<!-- SPDX-License-Identifier: Apache-2.0 -->
# QoreChain custody kit

Documentation, reference code and test vectors for custodians and exchanges that integrate [QoreChain](https://www.qorechain.io): what the network requires on each lane, how to detect deposits, sign and verify withdrawals, stake, and manage the ML-DSA-87 (FIPS 204) key that native-lane transactions carry next to secp256k1.

The code is deliberately small: address validation, transaction decoding and verification, and a deposit filter, in TypeScript, Python, Go, Rust and Java. It builds on [QoreSign](https://github.com/qorechain/qoresign), which does the signing and the cryptographic verification, and it is meant to be read, copied or vendored rather than installed as a package.

## Lanes

| Lane | What a custodian signs | Status |
|---|---|---|
| **Native** (Cosmos SDK) | secp256k1 `SIGN_MODE_DIRECT` plus an ML-DSA-87 layer. An account with a registered key has no classical path; a keyless account can only register its key (or unjail). | open |
| **EVM** | Ordinary secp256k1 Ethereum transactions (EIP-155 / EIP-1559), admitted only for a sender with a registered ML-DSA-87 key and a live authorization window opened by a hybrid native-lane transaction: one ML-DSA-87 signature per window. | open |
| **SVM** | n/a | not open for transactions |

Networks: mainnet `qorechain-vladi` (REST `https://api.qore.host`, EVM chain id 9801), testnet `qorechain-diana` (REST `https://api-testnet.qore.host`, EVM chain id 9800). Denomination `uqor` (6 decimals; 18 on the EVM lane), minimum gas price 0.1 uqor, unbonding 21 days.

## Contents

| Path | What |
|---|---|
| [`docs/`](docs) | [signing per lane](docs/signing.md), [addresses](docs/addresses.md), [deposits](docs/deposits.md), [withdrawals](docs/withdrawals.md), [staking](docs/staking.md), [errors](docs/errors.md), [key management](docs/key-management.md), [testnet](docs/testnet.md), [checklist](docs/checklist.md), [FAQ](docs/faq.md) |
| [`code/ts`](code/ts) | TypeScript reference, over `@qorechain/qoresign` |
| [`code/python`](code/python) | Python; `verify_tx` requires `qorechain-qoresign` 0.1.1 |
| [`code/go`](code/go) | Go, over `github.com/qorechain/qoresign/go` |
| [`code/rust`](code/rust) | Rust, over the `qorechain-qoresign` crate |
| [`code/java`](code/java) | Java, over `io.github.qorechain:qoresign` |
| [`vectors/`](vectors) | `custody-v1.json`, checked by every language; the QoreSign vectors by reference |

Each language offers the same four things, with the same results and error codes:

| Function | Does |
|---|---|
| `validateAddress` | `qor1…`, `qorvaloper1…`, `0x…`: bech32 and EIP-55 checksums, length, kind |
| `decodeTx` | a signed `TxRaw` into messages, fee, signer and ML-DSA-87 layer, for review before broadcast |
| `verifyTx` | the secp256k1 signature and the ML-DSA-87 layer against a given key, and the signer key |
| `buildDepositQuery` / `extractDeposits` | the REST query for incoming transfers, and a credit decision per transfer |

Plus a small command-line example per language (`validate`, `decode`, `verify`, `deposits`).

## Quick start

The reference code is meant to be read and copied; each language folder runs as is. With Go (reads use the testnet REST endpoint; set `QORE_REST` for another one, your own node in production):

```bash
git clone https://github.com/qorechain/qorechain-custody-kit
cd qorechain-custody-kit/code/go

# Validate a deposit address (offline)
go run ./cmd/custody-kit validate 0x9858EfFD232B4033E47d90003D41EC34EcaEda94

# Decode a signed transaction, then verify both signatures before broadcast
go run ./cmd/custody-kit decode <tx hex or base64>
go run ./cmd/custody-kit verify <tx> --chain-id qorechain-diana --account-number <n> \
  --pubkey <33-byte hex> --pq-pubkey <2592-byte hex>

# Scan incoming transfers to an address in a height range (read-only)
go run ./cmd/custody-kit deposits qor1... --from-height <h1> --to-height <h2>
```

The same four commands exist in TypeScript, Python, Rust and Java; see each `code/<language>/README.md`. Start with [the checklist](docs/checklist.md), then [signing per lane](docs/signing.md).

## Tests

Every language checks [`vectors/custody-v1.json`](vectors/custody-v1.json). Run `scripts/fetch-qoresign-vectors.sh` first to also check the QoreSign hybrid-transaction vectors. With `QORE_LIVE_TEST=1`, read-only checks run against the testnet (staking parameters, a deposit query for a recent transfer); `QORE_REST` points them at another endpoint. Commands are in each `code/<language>/README.md` and in [CONTRIBUTING.md](CONTRIBUTING.md).

## Scope

This kit describes the network's requirements and gives reference code for them. It does not hold keys, does not provide threshold or MPC signing, and makes no statement about any custodian's internal processes.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md). Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE). Copyright 2026 QoreChain Association.
