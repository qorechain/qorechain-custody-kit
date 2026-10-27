<!-- SPDX-License-Identifier: Apache-2.0 -->
# Key management

A QoreChain hot address holds two keys: a secp256k1 key (the address) and an ML-DSA-87 key (registered on chain). Both sign every native-lane transaction, so both belong in the same custody perimeter and the same approval policy.

## Where the ML-DSA-87 key can live

**Software (key manager, enclave or air-gapped signer).** ML-DSA-87 is a deterministic function of a 32-byte seed (`KeyGen_internal(seed)`, FIPS 204). Store and back up the seed, not the 4,896-byte secret key; QoreSign's `pqKeyFromSeed` re-creates the pair. Implementations used by QoreSign: `@noble/post-quantum` (TypeScript), `fips204` (Rust), Cloudflare CIRCL (Go), through the `qorechain-pqc` bindings. Signing is a few milliseconds of CPU; verification on chain is cheap.

**HSM.** ML-DSA is standardised as FIPS 204 ([NIST](https://csrc.nist.gov/pubs/fips/204/final)), and PKCS #11 version 3.2 ([OASIS](https://docs.oasis-open.org/pkcs11/pkcs11-spec/v3.2/)) defines ML-DSA keys and mechanisms (for example `CKM_ML_DSA`, with the parameter set chosen per key). What to check with your HSM vendor's documentation:

- the ML-DSA-87 parameter set, with **pure** signing (`CKM_ML_DSA`) over an arbitrary message and an **empty context**: QoreChain signs the sign-bytes directly, not a pre-hash (`HashML-DSA` is not accepted);
- whether keys are generated inside the HSM (then register that random key) or can be derived from an imported seed (only then can the canonical, mnemonic-based derivation be reproduced);
- FIPS 140-3 validation status of the ML-DSA implementation, in the [CMVP search](https://csrc.nist.gov/projects/cryptographic-module-validation-program/validated-modules/search), if your policy requires it.

Hedged and deterministic signatures are both accepted by the network, so an HSM that only produces hedged signatures works.

**MPC and threshold signing.** There is no standardised threshold scheme for ML-DSA today; NIST's [first call for multi-party threshold schemes](https://csrc.nist.gov/pubs/ir/8214/c/final) (NIST IR 8214C, January 2026) is collecting candidates. A custody stack built on threshold ECDSA can still:

- keep its threshold secp256k1 key for the address, and hold the ML-DSA-87 key in an HSM or a separate signer behind the same approval policy (both signatures are required, so neither key alone moves funds);
- or, for the EVM lane, sign one ML-DSA-87 window per batch and the EVM transactions with threshold ECDSA (see [signing](signing.md#evm-lane)).

## Rotation

`MsgRotatePQCKey` replaces an account's ML-DSA-87 key with a new key of the same algorithm.

| Field | Value |
|---|---|
| `sender` | the `qor1` account |
| `old_public_key`, `new_public_key` | the registered key and the new key |
| `old_signature`, `new_signature` | ML-DSA-87 signatures by each key over the same bytes |

Both keys sign:

```
"qorechain-pqc-rotate-v1|" + chain_id + "|" + algorithm_id + "|" + sender + "|" + lowercase_hex(old_public_key) + "|" + lowercase_hex(new_public_key)
```

The rotation transaction itself is a normal hybrid transaction from the account, so its ML-DSA-87 layer is made with the **current** (old) key. Rotation to a key the account used before is refused (code 232). The full node build's command line has `qorechaind tx pqc rotate-key`. Rotate when a key may be exposed, when moving from a software key to an HSM key, or on a schedule your policy sets; read `GET /qorechain/pqc/v1/account/{address}` afterwards.

If the **secp256k1** key is exposed, rotating the ML-DSA-87 key is not enough: the address itself is tied to the secp256k1 key. Move the funds to a new address with both keys fresh. Also close any open EVM window (`MsgCloseEVMWindow`), since a window lets the secp256k1 key act alone within its limits.

## Backups and recovery

- **secp256k1**: as for any Cosmos SDK or Ethereum key (mnemonic, or HSM backup).
- **ML-DSA-87, canonical derivation**: recoverable from the mnemonic and the address; nothing extra to store. `qorechaind tx pqc recover-key` (full node build) re-creates it.
- **ML-DSA-87, random or HSM key**: back up the 32-byte seed (software) or use the HSM's key backup. Losing it while the account holds funds means the account can no longer sign: an account with a registered key has no classical path at all.
- Test recovery on the testnet: restore, sign a transaction, and check it with `verifyTx` against the registered key before relying on a backup.

## Policy checklist

- Both keys of an address under the same quorum and audit trail.
- `verifyTx` and `decodeTx` on every signed transaction before broadcast, by a process that did not build it.
- EVM windows: `native_only` or `allowed_targets`, the smallest `max_value` and `blocks` that cover the batch, closed after the batch.
- `MsgSetWithdrawAddress`, `MsgRotatePQCKey`, `MsgOpenEVMWindow` and `MsgAuthorizeEVMDelegation` treated as privileged messages.
