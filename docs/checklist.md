<!-- SPDX-License-Identifier: Apache-2.0 -->
# Integration checklist

A list of what an integration needs to have in place. It describes the network's requirements; how you meet them inside your own processes is yours to decide.

## Network and data

- [ ] Own full node(s) on the release the download manifest recommends, for deposits and broadcasting ([running a node](https://docs.qorechain.io/developer-guide/running-a-node)).
- [ ] Upgrade monitoring: a node below the network's release stops at the upgrade height.
- [ ] Chain id checked on every signing request (`qorechain-vladi` / `qorechain-diana`; EVM 9801 / 9800).

## Addresses

- [ ] One account kind chosen per wallet (`secp256k1`, coin type 118, or eth-native, coin type 60) and recorded with the key.
- [ ] `validateAddress` (or equivalent) on every user-supplied address; `qorvaloper` refused as a payment address; EIP-55 checked for mixed-case hex.
- [ ] Addresses compared on their 20 bytes, or on canonical lowercase bech32.

## Keys

- [ ] ML-DSA-87 key for every hot address, in an HSM or a key manager, under the same approval policy as the secp256k1 key.
- [ ] Key registered with `MsgRegisterPQCKeyV2` (with proof of possession) before the first withdrawal; registration confirmed by query.
- [ ] Backup and restore of both keys tested on the testnet.
- [ ] Rotation procedure (`MsgRotatePQCKey`) written and tested.

## Deposits

- [ ] Height cursor over `transfer.recipient` (or `coin_received.receiver`), ascending.
- [ ] Credit only `code == 0`, message-scoped transfers, `uqor`, `MsgSend` / `MsgMultiSend` / successful `MsgEthereumTx`; gas refunds and failed EVM executions excluded (`extractDeposits` rules).
- [ ] Memo matched when using shared addresses (max 256 characters).
- [ ] Decimals: 6 on the native lane, 18 on the EVM lane.
- [ ] Credit after the block is committed; extra confirmations are a policy choice, not a protocol need.

## Withdrawals

- [ ] Simulation before signing, gas limit by the rule of the node release, fee at 0.1 uqor per gas or more.
- [ ] Both signatures; `verifyTx` and `decodeTx` review before broadcast.
- [ ] Sequence handling per hot address; retries without double spends (same sequence on retry).
- [ ] Error handling by `(codespace, code)` ([errors](errors.md)).
- [ ] For an EVM rail: windows opened per batch, `native_only`, sized to value plus maximum fee, closed after.

## Staking (if offered)

- [ ] 21-day unbonding reflected in customer terms and liquidity planning.
- [ ] Staking tier locks only on stake that will not be needed before the term ends.
- [ ] Rewards (`MsgWithdrawDelegatorReward`) and bonus (`MsgClaimBonus`) accounted separately from deposits.
- [ ] `MsgSetWithdrawAddress` treated as privileged.

## Before mainnet

- [ ] The rehearsal in [testnet](testnet.md) completed.
- [ ] Each language implementation you use passes `vectors/custody-v1.json`.
- [ ] Security contact on file: security@qore.network.
