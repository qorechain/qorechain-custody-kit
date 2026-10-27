<!-- SPDX-License-Identifier: Apache-2.0 -->
# FAQ

**Can we withdraw with secp256k1 signatures only?**
On the native lane, no: an account with a registered ML-DSA-87 key has no classical path, and an account without one can only register its key (or unjail a validator). On the EVM lane the transactions themselves are secp256k1, but each needs a live window that only a hybrid native-lane transaction can open: one ML-DSA-87 signature per window.

**Do deposits need anything post-quantum?**
No. Receiving needs no signature and no registered key. Only accounts that send need a key.

**Which key do we register?**
Any ML-DSA-87 key you control. The canonical derivation reproduces what QoreChain wallets register from a mnemonic; an HSM-generated random key works as well. See [addresses](addresses.md#the-ml-dsa-87-key).

**Does the HSM have to sign deterministically?**
No. The network accepts hedged and deterministic FIPS 204 signatures. It does need pure ML-DSA-87 over the sign-bytes with an empty context.

**How many confirmations?**
One block is final; there are no reorganisations. See [deposits](deposits.md#finality-and-confirmations).

**Are `qor1…` and `0x…` different accounts?**
No, they are two spellings of the same 20 bytes. Which key controls the `0x` form on the EVM lane depends on the account kind (coin type 118 or 60), see [addresses](addresses.md#two-kinds-of-account).

**Why did a "failed" EVM transaction show `code: 0`?**
The native-level result of a `MsgEthereumTx` is success even when the EVM execution failed; the failure is in the `ethereum_tx` event (`ethereumTxFailed`). Never credit it.

**Why do we see small incoming transfers from the fee collector?**
EVM gas refunds to the sender. They are not deposits.

**What does a hybrid transaction cost?**
Fee = gas limit × gas price, at least 0.1 uqor per gas. A hybrid transfer uses roughly 160,000 to 210,000 gas, so its minimum fee is around 0.016 to 0.021 QOR. Simulate for the exact figure.

**Can we use memos?**
Yes, on the native lane, up to 256 characters. The EVM lane has no memo; use one address per user there.

**Is there a hardware wallet or MPC library for ML-DSA-87?**
Not as part of this kit. See [key management](key-management.md) for HSM criteria and for combining a threshold secp256k1 key with a separately held ML-DSA-87 key.

**Can we stake through the EVM?**
Use the native lane. The staking precompile is not active on mainnet.

**Where do we report a vulnerability?**
security@qore.network, see [SECURITY.md](../SECURITY.md).
