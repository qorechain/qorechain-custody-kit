<!-- SPDX-License-Identifier: Apache-2.0 -->
# Signing, per lane

QoreChain has one account model and three execution lanes. The same 20-byte account holds one QOR balance on all of them. What a custodian must sign differs per lane.

| Lane | Transaction format | Signatures the network requires | Status |
|---|---|---|---|
| Native (Cosmos SDK) | `TxRaw`, `SIGN_MODE_DIRECT` | secp256k1 **and** ML-DSA-87 (FIPS 204) | open on both networks |
| EVM | Ethereum typed transactions (EIP-155 / EIP-1559 / EIP-2930 / EIP-7702) | secp256k1 only, but admitted only inside an authorization window opened by a hybrid native-lane transaction | open on both networks |
| SVM | Solana-style transactions | n/a | not open for transactions |

The normative specification of the hybrid format is [QoreSign `spec/hybrid-signing-v1.md`](https://github.com/qorechain/qoresign/blob/v0.1.0/spec/hybrid-signing-v1.md). This page summarises what a custody signer needs from it and adds the rules of the chain around it.

## Native lane

### When the ML-DSA-87 layer is required

The chain-wide parameter `hybrid_signature_mode` is `required` (read it at `GET /qorechain/pqc/v1/params` on the testnet; the mainnet node release does not serve that route yet, and every mainnet transfer we inspected carries the layer). Under `required`:

- **An account that has a registered ML-DSA-87 key has no classical path at all.** Every transaction it signs needs the ML-DSA-87 layer, including key maintenance (rotation, migration) and `MsgUnjail`.
- **An account without a registered key** can send a classical-only transaction only when every message in it is one of `MsgRegisterPQCKey`, `MsgRegisterPQCKeyV2`, `MsgMigratePQCKey` or `MsgUnjail`. In practice a custodian uses this once per hot address: to register the key with `MsgRegisterPQCKeyV2`.
- Anything else from a keyless account is refused (codespace `pqc`, code 20, "hybrid PQC signature required").

Deposits need none of this: receiving funds requires no signature and no registered key.

### The format

A hybrid transaction is an ordinary `TxRaw` signed twice by the same account:

1. The ML-DSA-87 signature travels in the body as the extension option `/qorechain.pqc.v1.PQCHybridSignature` (`TxBody` field 1023): `{ algorithm_id = 1, pqc_signature (4627 bytes), pqc_public_key (optional, 2592 bytes) }`.
2. The secp256k1 signature is the usual `SIGN_MODE_DIRECT` signature over `SignDoc { body_bytes, auth_info_bytes, chain_id, account_number }`, and it covers the final body, extension included.

The ML-DSA-87 signature is computed over sign-bytes that exclude the extension itself. Let `B0` be the body without the PQC extension and `A` the `AuthInfo` bytes as broadcast:

```
v1 = BE32(len(B0)) || B0 || BE32(len(A)) || A
v2 = "qorechain-pqc-hybrid-v2" || BE64(len(chain_id)) || chain_id || v1
```

Both public networks verify **v2** (mainnet since its `v3.2.0` upgrade at height 2,981,742; testnet since `v3.1.98` at height 5,746,000; check with `GET /cosmos/upgrade/v1beta1/applied_plan/v3.2.0`). `v1` matters only for reproducing old signatures. Sign with `ML-DSA.Sign(sk, v2, ctx = "")`; the network accepts both the hedged and the deterministic variant of FIPS 204.

Order of operations: encode body and auth info (fee and gas fixed), compute the v2 sign-bytes, sign with ML-DSA-87, append the extension, sign the `SignDoc` with secp256k1, broadcast.

### Sizes

| Item | Bytes |
|---|---|
| ML-DSA-87 public key | 2,592 |
| ML-DSA-87 secret key | 4,896 |
| ML-DSA-87 signature | 4,627 |
| ML-DSA-87 seed (what to back up) | 32 |
| secp256k1 compressed public key | 33 |
| secp256k1 signature (`r` and `s`) | 64 |
| PQC extension in a body | about 4,640 (plus 2,595 if the public key is embedded) |

A hybrid transaction is about 4.7 KB larger than a classical one. Gas includes a per-byte cost (`tx_size_cost_per_byte` = 10 on both networks), so the layer adds roughly 47,000 gas. Measured examples: hybrid `MsgSend` on mainnet used 160,000 to 206,000 gas; a hybrid `MsgDelegate` on the testnet used about 227,000. Always simulate (see [withdrawals](withdrawals.md#fees-and-gas)).

### Registering the key

`MsgRegisterPQCKeyV2 { sender, public_key, algorithm_id = 1, ecdsa_pubkey (33-byte compressed key of sender), key_type = "hybrid", proof_of_possession }`, signed classically from the keyless account. The proof of possession is optional on account keys today, and recommended: an ML-DSA-87 signature over

```
"qorechain-pqc-pop-v1|" + chain_id + "|" + algorithm_id + "|" + sender + "|" + lowercase_hex(public_key)
```

QoreSign builds the whole message (`buildRegisterPqKeyMessage`). Check `GET /qorechain/pqc/v1/account/{address}` before and after: a repeated registration is refused (code 7), and once a key exists any further key message must be hybrid-signed. The 2,592-byte key needs a larger gas limit than a plain transfer; simulate it.

### Verifying before broadcast

`verifyTx` in [`code/`](../code) checks a signed transaction the way the network does: the secp256k1 signature over the `SignDoc`, the ML-DSA-87 layer against the key registered for the account, and that the public key in `AuthInfo` is the one you expect. Run it on the output of your signer before anything is broadcast.

## EVM lane

Ethereum transactions carry no field for a second signature, so the EVM lane accepts ordinary secp256k1 transactions (EIP-155 replay protection is mandatory: unprotected legacy transactions are refused) under one extra rule:

> Every EVM transaction needs a sender with a registered ML-DSA-87 key **and** a live EVM authorization window that covers it. There are no per-account exceptions. Simulation (`eth_call`, `eth_estimateGas`) needs no window.

The window is opened by a native-lane transaction, which is hybrid-signed like any other, so the ML-DSA-87 key authorises EVM activity ahead of time. For an ECDSA-only custody stack this means **one ML-DSA-87 signature per window**, then any number of ordinary secp256k1 EVM signatures within its limits.

### Window messages

| Message | Fields |
|---|---|
| `/qorechain.pqc.v1.MsgOpenEVMWindow` | `sender` (`qor1` form), `blocks` (1 to 17,280), `max_txs` (1 to 1,000), `max_value` (uqor, > 0), `native_only` (bool, optional), `allowed_targets` (up to 16 `0x` addresses, optional) |
| `/qorechain.pqc.v1.MsgCloseEVMWindow` | `sender`: revokes the window in the same block |

Read the state with `GET /qorechain/pqc/v1/evm_window/{address}` (`found`, `live`, `expiry_height`, `used_txs`, `used_value`, `remaining_*`, scope). The QoreChain SDK has composers (`openEvmWindowMsg`, `closeEvmWindowMsg`) and a refusal classifier; see its [`evm-window.ts`](https://github.com/qorechain/qorechain-sdk/blob/main/packages/ts/src/pqc/evm-window.ts).

Rules that matter for a hot wallet:

- **Opening replaces** any existing window; limits do not add up.
- **`max_value` counts value plus the maximum fee** of every admitted transaction (gas limit times max fee per gas), converted from wei to uqor rounding up. With the base fee at 100 gwei, a 21,000-gas transfer at a 112.5 gwei fee cap consumes 2,363 uqor of fee budget on top of its value.
- **`blocks` is a block count.** 17,280 blocks is about 15 hours on mainnet (about 3.1 s per block) and about 6 hours on the testnet (about 1.3 s), measured on 27 October 2026.
- **Opening a window advances the account's sequence, which is also its EVM nonce.** Open, then read the nonce, then sign EVM transactions.
- **Scope.** `native_only` admits plain QOR transfers only (no calldata, no contract creation, no recipient with code, no EIP-7702 authorizations). `allowed_targets` admits listed recipients only. A hot wallet that only pays out QOR should open `native_only` windows. Token transfers carry value zero, so without a scope a stolen secp256k1 key could move tokens while the window lasts.
- **Value-moving precompiles** (staking `0x…0800`, distribution `0x…0801`, ICS-20 `0x…0802`, governance `0x…0805`) are reachable through a window only when listed in `allowed_targets`. This rule ships with v3.2.5: active on the testnet, pending on mainnet. On mainnet no static precompile is active today (`active_static_precompiles` is empty). Stake on the native lane (see [staking](staking.md)).

Refusals are codespace `pqc`: 26 (no window, or no registered key; read the message text), 27 (window exhausted or out of scope), 28 (invalid window parameters).

### Other EVM facts a custodian may meet

- Chain ids 9801 (mainnet) and 9800 (testnet). Accepted transaction types: 0, 1, 2 and 4. Blob transactions (type 3) are refused.
- Native QOR has 18 decimals on the EVM lane: 1 uqor = 10^12 wei. The base fee is at its floor, 0.1 uqor per gas = 100 gwei; `eth_gasPrice` returns 112.5 gwei (base plus a 12.5 gwei tip).
- EIP-7702 (type 4) is accepted, but every authority whose delegation would take effect needs its own registered key and a single-use consent recorded with `MsgAuthorizeEVMDelegation`. A sponsor's window is not consent for the authorities.
- `PREVRANDAO` is a constant (`0xff…ff`), not randomness.
- The `debug`, `personal`, `admin` and `miner` namespaces are not available. `eth_getProof` returns IAVL proofs, not Merkle-Patricia proofs.

## SVM lane

Transaction submission on the SVM lane is disabled network-wide. The public SVM endpoints answer reads only. Do not build deposit or withdrawal flows on it; QoreSign reports it as `LANE_NOT_AVAILABLE`.

## Vectors

[`vectors/custody-v1.json`](../vectors/custody-v1.json) holds a hybrid-signed `MsgDelegate` (secp256k1 account) and a hybrid-signed `MsgOpenEVMWindow` (eth-native account), with their expected decodings and verification outcomes. The QoreSign vectors (sign-bytes v1 and v2, proof of possession, registration message) are reused by reference; see [`vectors/README.md`](../vectors/README.md).
