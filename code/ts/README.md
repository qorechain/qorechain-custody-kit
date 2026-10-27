<!-- SPDX-License-Identifier: Apache-2.0 -->
# Custody kit: TypeScript (reference)

Reference validators and helpers for custodians integrating QoreChain, built on [`@qorechain/qoresign`](https://www.npmjs.com/package/@qorechain/qoresign). Example code to copy or vendor; not published.

| Export | What it does |
|---|---|
| `validateAddress` | `qor1...`, `qorvaloper1...` or `0x...`, with bech32 and EIP-55 checks and a stable error code |
| `decodeTx`, `decodeMessage` | decode a signed `TxRaw`: messages, fee, signer, ML-DSA-87 layer |
| `verifyTx` | secp256k1 signature, ML-DSA-87 layer against the registered key, signer key match |
| `buildDepositQuery`, `extractDeposits` | REST query for incoming transfers, and the credit decision per transfer |

This implementation also generates [`vectors/custody-v1.json`](../../vectors/custody-v1.json) (`scripts/gen-vectors.mjs`).

## Test

```bash
pnpm install && pnpm build && pnpm typecheck && pnpm test
../../scripts/fetch-qoresign-vectors.sh   # optional: also check the QoreSign hybrid vectors
QORE_LIVE_TEST=1 pnpm test                # read-only checks against the testnet
pnpm vectors                              # regenerate the vectors
```

`QORE_REST` overrides the REST endpoint of the live checks and of the example (default `https://api-testnet.qore.host`). The live checks read the staking parameters, find a recent transfer through the deposit query, and verify a committed hybrid transaction of the public test account against its registered key.

## Example command line

```bash
node dist/src/cli.js validate 0x9858EfFD232B4033E47d90003D41EC34EcaEda94
node dist/src/cli.js decode <tx hex or base64>
node dist/src/cli.js verify <tx> --chain-id qorechain-diana --account-number 7 --pubkey <hex> [--eth] [--pq-pubkey <hex>]
node dist/src/cli.js deposits qor1... --from-height 8976000 --to-height 8976400
```
