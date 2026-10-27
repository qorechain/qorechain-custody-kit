<!-- SPDX-License-Identifier: Apache-2.0 -->
# Deposit detection

Detecting deposits needs no signing and no registered key: you only read the chain. Run your own full node for production and treat the public endpoints as a convenience for development.

## Finality and confirmations

QoreChain finalises a block when it is committed: there are no reorganisations, so a transaction in a committed block is final after **one block**. Block time is about 3.1 seconds on mainnet and about 1.3 seconds on the testnet (measured 27 October 2026).

Confirmation policy guidance:

- Credit when the transaction is in a committed block and your own node reports it with `code == 0`.
- Waiting one or two extra blocks costs a few seconds and protects against a lagging or misbehaving RPC provider, not against reorganisations. It is an operational choice, not a protocol requirement.
- If you read through a third-party endpoint, re-check the transaction on your own node before crediting.

## Native lane: the query

Incoming transfers to an address are indexed by the `transfer` event (`recipient`) and the `coin_received` event (`receiver`). Search them with the REST API:

```
GET /cosmos/tx/v1beta1/txs?query=transfer.recipient='qor1…' AND tx.height>=100 AND tx.height<=200&order_by=ORDER_BY_ASC&page=1&limit=50
```

`buildDepositQuery` in [`code/`](../code) builds exactly this path (RFC 3986 percent-encoding, `limit` 1 to 100). It accepts a `0x` address and converts it to `qor1`, since events always carry the bech32 form. A scanner keeps a height cursor and asks for `[cursor, latest]` in ascending order. The response has `tx_responses` and a `total`.

Alternatives:

- `GET /cosmos/tx/v1beta1/txs/block/{height}` returns every transaction of a block; useful for a scanner that walks heights instead of searching.
- `GET /cosmos/bank/v1beta1/balances/{address}/by_denom?denom=uqor` for the balance, to reconcile.
- The consensus RPC (`/tx_search`, WebSocket subscriptions on `/websocket`) offers the same event queries.

## Native lane: the credit decision

A `tx_response` lists events in order. For a plain transfer they look like this (testnet, abridged):

```
coin_received  receiver=qor17xpf…(fee collector)  amount=45000uqor
transfer       recipient=qor17xpf…  sender=qor1wv0f…  amount=45000uqor
message        action=/cosmos.bank.v1beta1.MsgSend  msg_index=0
coin_received  receiver=qor156px…  amount=100000000uqor  msg_index=0
transfer       recipient=qor156px…  sender=qor1wv0f…  amount=100000000uqor  msg_index=0
```

`extractDeposits(txResponse, address)` applies these rules and returns each incoming transfer with `creditable` and a `reason`:

1. A transaction with `code != 0` moved nothing (except its fee): no entries.
2. A `transfer` without `msg_index` is the fee payment: ignored.
3. The amount is read from the `transfer` event and filtered by denom. An event can list several coins (`1500000uqor,5erc20:0x…`); only `uqor` counts unless you ask for another denom. Credit `uqor` only; the testnet carries test denoms that mainnet does not, and the rule must not depend on that.
4. `MsgSend` and `MsgMultiSend` outputs are creditable.
5. `MsgEthereumTx` (an EVM transaction, see below) is creditable unless the EVM execution failed or the transfer is a gas refund.
6. Anything else (reward withdrawals, contract calls, IBC) comes back with `reason: "unsupported_message"` for review rather than automatic credit.

Then, before crediting:

- Match the memo when you use a shared deposit address with memos (memo limit: 256 characters on both networks, `max_memo_characters`).
- Cross-check the amount against the message (`tx.body.messages[msg_index]`) and against the balance change.
- Confirm the transaction hash on your own node (`GET /cosmos/tx/v1beta1/txs/{hash}`).

The vectors (`deposits` in [`custody-v1.json`](../vectors/custody-v1.json)) cover each rule, including a failed transaction, a second denom, an EVM deposit, a failed EVM transaction, a gas refund and a mixed transaction.

## EVM lane deposits

An EVM transfer to an address also appears in the native-lane index, as a `MsgEthereumTx` whose transfers to the recipient come from the EVM module account (`qor1vqu8rska6swzdmnhf90zuv0xmelej4lqeejhp2`). Two traps, both seen on the testnet:

- **A failed EVM transaction still has `code == 0`** at the native level. The failure is in the `ethereum_tx` event attribute `ethereumTxFailed` (for example `out of gas`). Never credit such a transaction.
- **Gas refunds** go from the fee collector (`qor17xpfvakm2amg962yls6f84z3kell8c5lyj5r7l`) to the sender with a `msg_index`, so they look like incoming transfers. They are not deposits.

`extractDeposits` handles both. If you index the EVM lane with Ethereum tooling instead:

- Scan blocks (`eth_getBlockByNumber` with full transactions) for native transfers to your addresses and confirm each with `eth_getTransactionReceipt`, `status == 0x1`.
- The value is in wei: divide by 10^12 for uqor, by 10^18 for QOR.
- On the public endpoints `eth_getLogs` accepts at most 10,000 blocks per query.
- A user can only send from the EVM lane with a registered key and an open window; users without one deposit from the native lane instead.

## Live check

`QORE_LIVE_TEST=1` runs, in every language, a read-only check against the testnet: it takes a recent `MsgSend` of `uqor`, runs the deposit query for its recipient at that height, and expects `extractDeposits` to return it as creditable with the right amount. `QORE_REST` points the check at another endpoint (your node).
