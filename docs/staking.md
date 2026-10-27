<!-- SPDX-License-Identifier: Apache-2.0 -->
# Staking operations

Staking is a native-lane activity: every message below is hybrid-signed like a withdrawal (see [signing](signing.md)). Validator addresses use the `qorvaloper1…` prefix. Amounts are `uqor`.

## Parameters (read them, do not hard-code them)

`GET /cosmos/staking/v1beta1/params`, read on both networks on 27 October 2026:

| Parameter | Value |
|---|---|
| `bond_denom` | `uqor` |
| `unbonding_time` | `1814400s` (21 days) |
| `max_entries` | 7 (unbonding or redelegation entries per pair) |
| `max_validators` | 100 |

The live checks of the kit (`QORE_LIVE_TEST=1`) read this endpoint and expect `uqor` and `1814400s`.

## Messages

| Operation | Message | Fields | Notes |
|---|---|---|---|
| Delegate | `/cosmos.staking.v1beta1.MsgDelegate` | `delegator_address`, `validator_address`, `amount` | moves liquid balance to bonded |
| Undelegate | `/cosmos.staking.v1beta1.MsgUndelegate` | same | funds return after 21 days; nothing is paid out until then |
| Redelegate | `/cosmos.staking.v1beta1.MsgBeginRedelegate` | `delegator_address`, `validator_src_address`, `validator_dst_address`, `amount` | immediate; the redelegated stake cannot be redelegated again until 21 days have passed |
| Cancel an unbonding | `/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation` | `delegator_address`, `validator_address`, `amount`, `creation_height` | re-bonds an unbonding entry |
| Claim rewards | `/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward` | `delegator_address`, `validator_address` | one message per validator |
| Reward address | `/cosmos.distribution.v1beta1.MsgSetWithdrawAddress` | `delegator_address`, `withdraw_address` | changes where every future reward goes: treat as a privileged operation |

Reads: `GET /cosmos/staking/v1beta1/delegations/{delegator}`, `/cosmos/staking/v1beta1/delegators/{delegator}/unbonding_delegations`, `/cosmos/distribution/v1beta1/delegators/{delegator}/rewards`.

Reward withdrawals show up as `transfer` events from the distribution module account. `extractDeposits` reports them with `reason: "unsupported_message"` so that rewards are never mistaken for customer deposits.

Measured on the testnet, a hybrid `MsgDelegate` uses about 227,000 gas. Simulate as for withdrawals.

## Staking tiers (`x/stakingtier`)

An optional module (live on both networks since v3.2.4) lets a delegator **lock part of an existing delegation** for a fixed term and earn a bonus on top of the staking reward. Parameters, `GET /qorechain/stakingtier/v1/params`, read on both networks on 27 October 2026:

| Parameter | Value |
|---|---|
| `lock_tiers` | 3 months: +150 bps, 6 months: +300 bps, 12 months: +500 bps |
| `min_lock_amount` | `10000000` uqor (10 QOR) |
| `early_unlock_penalty_bps` | 500 (5 % of the locked stake, burned) |
| `light_node_bonus_bps`, `validator_bonus_bps` | 200, 300 |
| `max_total_apy_bps` | 2500 (cap on base yield plus bonus) |
| `enabled` | true |

| Operation | Message | Fields |
|---|---|---|
| Lock | `/qorechain.stakingtier.v1.MsgLockDelegation` | `delegator`, `validator`, `amount` (string), `months` (3, 6 or 12) |
| Unlock early | `/qorechain.stakingtier.v1.MsgUnlockEarly` | `delegator`, `lock_id` |
| Claim the bonus | `/qorechain.stakingtier.v1.MsgClaimBonus` | `holder` |

What a custodian must know:

- **Locked stake cannot be undelegated or redelegated** by any route until the lock ends (error `stakingtier` 13, "stake is locked"). Do not lock stake you may have to return to a customer before the term ends.
- The term is in calendar months from the block time. Locks are released automatically at the end; the bonus stays claimable.
- An early unlock burns 5 % of the locked stake and forfeits the unpaid bonus.
- At most 16 open locks per delegator.
- The bonus accrues and is paid only by `MsgClaimBonus`; claiming with nothing accrued is refused (code 12).
- Reads: `GET /qorechain/stakingtier/v1/locks/{holder}` (locks, accrued and projected bonus), `/qorechain/stakingtier/v1/pool`.

Every message of this page has a decoding vector in [`custody-v1.json`](../vectors/custody-v1.json) (`messages`), and `MsgDelegate` has a full hybrid-signed transaction (`transactions`).

## Not through the EVM

Stake on the native lane, where the hybrid signature covers each operation. The standard staking precompile is not active on mainnet (`GET /cosmos/evm/vm/v1/params` shows an empty `active_static_precompiles`).
