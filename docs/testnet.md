<!-- SPDX-License-Identifier: Apache-2.0 -->
# Test environment

Rehearse every flow on the testnet before mainnet. The testnet receives each node release first, so it can be ahead of mainnet.

| | Mainnet | Testnet |
|---|---|---|
| Chain id | `qorechain-vladi` | `qorechain-diana` |
| EVM chain id | 9801 | 9800 |
| REST | `https://api.qore.host` | `https://api-testnet.qore.host` |
| Consensus RPC | `https://rpc.qore.host` | `https://rpc-testnet.qore.host` |
| EVM JSON-RPC | `https://evm.qore.host` | `https://evm-testnet.qore.host` |
| Node release (27 Oct 2026) | v3.2.4 (v3.2.5 pending governance) | v3.2.6 (v3.2.5 applied at height 8,890,800) |
| Block time (measured) | about 3.1 s | about 1.3 s |
| Minimum gas price | 0.1 uqor | 0.1 uqor |
| Unbonding | 21 days | 21 days |

Read the release yourself: `GET /cosmos/upgrade/v1beta1/applied_plan/{name}` returns the height at which a release was applied (0 when not applied), and `GET /qorechain/pqc/v1/protocol_features` lists the protocol features active at the current height.

Public endpoints are rate-limited and meant for development. Run your own node for production ([connecting to mainnet](https://docs.qorechain.io/getting-started/connecting-to-mainnet)). If a script gets `403 Forbidden`, set an explicit `User-Agent` header.

## Differences that matter for a rehearsal

- **Gas rule.** The testnet runs v3.2.5 or later, where simulation includes the ML-DSA-87 verification; mainnet does not yet. Use the release check in [withdrawals](withdrawals.md#fees-and-gas) rather than assuming either.
- **Value-moving precompiles** through EVM windows (v3.2.5 rule) and some precompiles are active on the testnet only.
- **Other denominations.** The testnet carries test tokens (bank denoms `erc20:0x…` and an IBC token) that mainnet does not. A deposit scanner must credit `uqor` only on both.
- **Test funds.** Use the faucet in the [QoreChain dashboard](https://dashboard.qorechain.io) (see the [faucet guide](https://docs.qorechain.io/dashboard/faucet)). Testnet QOR has no value.

## A rehearsal, end to end

1. Create a hot address, fund it from the faucet.
2. Register its ML-DSA-87 key; confirm with `GET /qorechain/pqc/v1/account/{address}`.
3. Send a hybrid `MsgSend`, check it with `verifyTx` before broadcast, confirm it on chain.
4. Run your deposit scanner on a second address and send to it; compare with `extractDeposits`.
5. Delegate, claim rewards, undelegate; lock with `MsgLockDelegation` and see `/qorechain/stakingtier/v1/locks/{holder}`.
6. For an EVM rail: open a `native_only` window, send an EIP-1559 transfer, watch the window counters, close it.
7. Rotate the ML-DSA-87 key and repeat step 3 with the new key.

The live checks of this kit (`QORE_LIVE_TEST=1`) are read-only and need no funds.
