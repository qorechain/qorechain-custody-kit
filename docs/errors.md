<!-- SPDX-License-Identifier: Apache-2.0 -->
# Errors and refusal codes

A refused transaction carries a `codespace` (the module) and a `code` that is only meaningful inside that codespace. Branch on the pair, and keep the raw log for support.

Decoding is already implemented in the QoreChain SDK: `decodeTxError({ code, codespace, rawLog })` and `classifyEvmWindowRejection(err)`. See the SDK guide [Gas, fees and errors](https://github.com/qorechain/qorechain-sdk/blob/main/docs/docs/guides/gas-fees-errors.md) and the source of the table, [`errors.ts`](https://github.com/qorechain/qorechain-sdk/blob/main/packages/ts/src/errors.ts). QoreSign errors have their own stable codes (`QoreSignError.code`, for example `PQ_SIGNATURE_INVALID`, `KEY_NOT_REGISTERED`, `SIMULATION_FAILED`).

## The ones a custodian meets

| Codespace | Code | Meaning | What to do |
|---|---|---|---|
| `sdk` | 3 | account sequence mismatch | re-read the account, re-sign with the right sequence |
| `sdk` | 4 | unauthorized (bad signature or signer) | check the account number, chain id and key; run `verifyTx` |
| `sdk` | 5 | insufficient funds | balance must cover amount plus fee |
| `sdk` | 11 | out of gas | simulate again; apply the gas rule for the node release |
| `sdk` | 12 | memo too large | memo limit is 256 characters |
| `sdk` | 13 | insufficient fee | gas price below 0.1 uqor |
| `sdk` | 19 | transaction already in the mempool | wait for it; do not re-sign with a new sequence |
| `pqc` | 20 | hybrid PQC signature required | the transaction has no ML-DSA-87 layer and is not a keyless-account registration |
| `pqc` | 21 | hybrid PQC signature verification failed | wrong key, or sign-bytes v1 where the network verifies v2 |
| `pqc` | 7 | PQC account already registered | the key is registered already; read `/qorechain/pqc/v1/account/{address}` |
| `pqc` | 45 | `ecdsa_pubkey` is not the signer's compressed secp256k1 key | registration: pass the sender's own 33-byte key |
| `pqc` | 230 | the ML-DSA-87 key gives no post-quantum protection | generate a proper key |
| `pqc` | 231 | proof of possession does not verify | sign the proof with the key being registered, over the exact string |
| `pqc` | 232 | the key was used by this account before | rotation must go to a new key |
| `pqc` | 234 | key maintenance from a keyed account needs the hybrid signature | sign the rotation hybrid with the current key |
| `pqc` | 26 | no open EVM authorization window (or no registered key: read the text) | register a key, then open a window |
| `pqc` | 27 | window exhausted or the transaction is outside its scope | open a new window with suitable limits and scope |
| `pqc` | 28 | invalid window parameters | `blocks` 1 to 17,280, `max_txs` 1 to 1,000, `max_value` > 0, at most 16 targets |
| `stakingtier` | 6 | invalid lock amount | at least `min_lock_amount` (10 QOR) |
| `stakingtier` | 11 | too many open locks | at most 16 |
| `stakingtier` | 12 | no bonus to claim | nothing has accrued yet |
| `stakingtier` | 13 | stake is locked | undelegate or redelegate only the unlocked part |

The texts above are the registered error descriptions of each module. Some refusals arrive as text only, for example from a failed simulation or over EVM JSON-RPC; the SDK decoder recognises the registered texts too.

## Refusals of the kit itself

The code in this repository uses three codes, identical in every language: `MALFORMED_TX` (bytes that are not a well-formed transaction), `UNKNOWN_FIELD` (a field the decoder does not know, which the network would refuse as well) and `INVALID_ARGUMENT`. `validateAddress` never throws; it returns one of the address codes listed in [addresses](addresses.md).
