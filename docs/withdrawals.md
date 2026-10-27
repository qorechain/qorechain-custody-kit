<!-- SPDX-License-Identifier: Apache-2.0 -->
# Withdrawals

## Native lane (recommended)

One-time setup per hot address:

1. Create the account (receive any amount so it exists on chain) and read `GET /cosmos/auth/v1beta1/account_info/{address}` for `account_number` and `sequence`.
2. Register its ML-DSA-87 key with `MsgRegisterPQCKeyV2`, signed classically (see [signing](signing.md#registering-the-key)). Confirm with `GET /qorechain/pqc/v1/account/{address}` (`found: true`, the expected `public_key`).

Every withdrawal:

1. **Build** `TxBody { messages: [MsgSend { from_address, to_address, amount: [{ denom: "uqor", amount }] }], memo }` and `AuthInfo { signer_infos: [{ public_key, mode_info: DIRECT, sequence }], fee: { amount, gas_limit } }`. Validate `to_address` with `validateAddress` first.
2. **Simulate** to get the gas (below).
3. **Sign**: ML-DSA-87 layer over the v2 sign-bytes, then secp256k1 over the `SignDoc` ([QoreSign](https://github.com/qorechain/qoresign) `signHybrid`, or your HSM for each key).
4. **Verify** the signed bytes with `verifyTx` against the account's registered key and expected secp256k1 key, and review `decodeTx` output (messages, recipient, amount, fee, memo). This is the place for a second approver.
5. **Broadcast** `POST /cosmos/tx/v1beta1/txs` with `{ "tx_bytes": base64, "mode": "BROADCAST_MODE_SYNC" }`. `code == 0` means the mempool accepted it; the hash is the uppercase hex SHA-256 of the bytes.
6. **Confirm** with `GET /cosmos/tx/v1beta1/txs/{hash}`: in a block and `code == 0` is final.

Sequence: each account's transactions must carry consecutive sequences. A refusal at the mempool check does not consume the sequence; a transaction that fails in a block does. Keep one signer queue per hot address, or use several hot addresses for parallel payouts.

## Fees and gas

- **Fee = ceil(gas_limit × gas_price)** in `uqor`. The minimum gas price is **0.1 uqor** on both networks (`GET /cosmos/base/node/v1beta1/config` reports `minimum_gas_price`). The fee is charged on the gas limit, not on the gas used, so a tight limit is cheaper.
- **Simulate** with `POST /cosmos/tx/v1beta1/simulate` and `{ "tx_bytes": base64 }` of the fully signed transaction (signatures are not checked in simulation, but the ML-DSA-87 layer must be present so the size is right). Read `gas_info.gas_used`.
- **Gas limit from the simulation**, depending on the node release:

  | Node | Rule | Why |
  |---|---|---|
  | v3.2.5 and later | `ceil(gas_used × 1.02) + 2000` | simulation charges the ML-DSA-87 verification exactly |
  | before v3.2.5 | `ceil((gas_used + 40000) × 1.4)` | about 35,000 gas of the verification is not part of the simulation |

  Tell which applies with `GET /cosmos/upgrade/v1beta1/applied_plan/v3.2.5`: a height above 0 means the exact rule. Today the testnet has applied v3.2.5 and mainnet has not (pending governance); switch rules automatically rather than by date. QoreSign's `suggestGasLimit` and `simulateTx` implement both.
- After choosing the gas limit, rebuild `AuthInfo` with the final fee and **sign again**: both signatures cover the fee.
- Simulation returns balance changes as `coin_spent` / `coin_received` events; check them against what you intend to send. A failed simulation is a reason not to sign.

## EVM lane

An EVM payout rail needs the same ML-DSA-87 key, plus window management:

1. Register the key (native lane, once).
2. Open a window with a hybrid-signed `MsgOpenEVMWindow`. Size `max_value` to cover every payout's value **plus** its maximum fee (gas limit × max fee per gas), and use `native_only: true` for QOR payouts. Opening advances the nonce: open first, then read the nonce.
3. Sign EIP-1559 transactions with secp256k1 as usual (chain id 9801 on mainnet, 9800 on the testnet). Base fee 100 gwei; `eth_gasPrice` returns 112.5 gwei. `eth_estimateGas` needs no window.
4. Watch `GET /qorechain/pqc/v1/evm_window/{address}` and open a new window before `remaining_txs`, `remaining_value` or `remaining_blocks` runs out, so a batch does not stop half way. Close it (`MsgCloseEVMWindow`) when the batch is done.

Measured on the testnet, a hybrid `MsgOpenEVMWindow` uses about 187,000 gas. Refusals: codespace `pqc`, codes 26, 27 and 28 (see [errors](errors.md)).

## SVM lane

Not open for transactions. Use the native lane.
