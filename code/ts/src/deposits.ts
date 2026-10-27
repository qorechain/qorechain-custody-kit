// SPDX-License-Identifier: Apache-2.0
//
// Deposit detection over the REST API: a query builder for incoming
// transfers to an address, and a parser that turns one `tx_response` into
// candidate deposits with a credit decision.

import { validateAddress } from "./address.js";
import { CustodyKitError } from "./errors.js";

/** Fee collector module account (same address on both networks). Fees and EVM gas refunds move through it. */
export const FEE_COLLECTOR = "qor17xpfvakm2amg962yls6f84z3kell8c5lyj5r7l";

export const MSG_SEND = "/cosmos.bank.v1beta1.MsgSend";
export const MSG_MULTI_SEND = "/cosmos.bank.v1beta1.MsgMultiSend";
export const MSG_ETHEREUM_TX = "/cosmos.evm.vm.v1.MsgEthereumTx";

export interface DepositQueryOptions {
  /** `qor1...` or `0x...` account address. */
  address: string;
  /** Inclusive lower bound on the block height. */
  minHeight?: number | bigint;
  /** Inclusive upper bound on the block height. */
  maxHeight?: number | bigint;
  /** Event to match: `transfer.recipient` (default) or `coin_received.receiver`. */
  event?: "transfer" | "coin_received";
  /** 1-based page. Default 1. */
  page?: number;
  /** 1 to 100. Default 50. */
  limit?: number;
  /** Default `asc` (oldest first), which is what a scanner that keeps a height cursor wants. */
  orderBy?: "asc" | "desc";
}

/** RFC 3986 percent-encoding: everything except unreserved characters. */
export function percentEncode(s: string): string {
  let out = "";
  for (const b of new TextEncoder().encode(s)) {
    const c = String.fromCharCode(b);
    if (/[A-Za-z0-9\-._~]/.test(c)) out += c;
    else out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

function nonNegativeInt(name: string, v: number | bigint): bigint {
  const n = BigInt(v);
  if (n < 0n) throw new CustodyKitError("INVALID_ARGUMENT", `${name} must not be negative`);
  return n;
}

/**
 * The events query, for example
 * `transfer.recipient='qor1...' AND tx.height>=100 AND tx.height<=200`.
 */
export function depositEventQuery(opts: DepositQueryOptions): string {
  const check = validateAddress(opts.address);
  if (!check.valid) {
    throw new CustodyKitError("INVALID_ARGUMENT", `deposit address: ${check.error}`);
  }
  const key = (opts.event ?? "transfer") === "transfer" ? "transfer.recipient" : "coin_received.receiver";
  const parts = [`${key}='${check.bech32}'`];
  if (opts.minHeight !== undefined) parts.push(`tx.height>=${nonNegativeInt("minHeight", opts.minHeight)}`);
  if (opts.maxHeight !== undefined) parts.push(`tx.height<=${nonNegativeInt("maxHeight", opts.maxHeight)}`);
  return parts.join(" AND ");
}

/** Path and query string for `GET /cosmos/tx/v1beta1/txs`. Append it to a REST base URL. */
export function buildDepositQuery(opts: DepositQueryOptions): string {
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 50;
  if (!Number.isInteger(page) || page < 1) throw new CustodyKitError("INVALID_ARGUMENT", "page must be 1 or more");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new CustodyKitError("INVALID_ARGUMENT", "limit must be between 1 and 100");
  }
  const order = (opts.orderBy ?? "asc") === "asc" ? "ORDER_BY_ASC" : "ORDER_BY_DESC";
  return (
    `/cosmos/tx/v1beta1/txs?query=${percentEncode(depositEventQuery(opts))}` +
    `&order_by=${order}&page=${page}&limit=${limit}`
  );
}

export interface DepositEntry {
  txhash: string;
  height: string;
  msgIndex: number;
  messageType: string;
  sender: string;
  /** Integer amount in the base denom. */
  amount: string;
  denom: string;
  memo: string;
  /** True when the kit's rules consider this a deposit to credit. */
  creditable: boolean;
  /** Why it is not creditable: `evm_failed`, `fee_refund` or `unsupported_message`; `null` when creditable. */
  reason: string | null;
}

interface Attr {
  key: string;
  value: string;
}
interface TxEvent {
  type: string;
  attributes?: Attr[];
}

function attr(ev: TxEvent, key: string): string | undefined {
  return ev.attributes?.find((a) => a.key === key)?.value;
}

function sumDenom(amounts: string, denom: string): bigint | undefined {
  let total: bigint | undefined;
  for (const part of amounts.split(",")) {
    const m = /^(\d+)(.+)$/.exec(part.trim());
    if (m && m[2] === denom) total = (total ?? 0n) + BigInt(m[1]!);
  }
  return total;
}

/**
 * Incoming transfers of `denom` to `address` in one `tx_response` (as
 * returned by `GET /cosmos/tx/v1beta1/txs` or `/txs/{hash}`), with a credit
 * decision for each.
 *
 * - A failed transaction (`code != 0`) gives nothing.
 * - Transfers without a `msg_index` (fee payment) are ignored.
 * - `MsgSend` and `MsgMultiSend` outputs are creditable.
 * - `MsgEthereumTx` is creditable unless the EVM execution failed
 *   (`ethereumTxFailed`) or the transfer is a gas refund from the fee collector.
 * - Any other message (rewards, contract calls, IBC) is returned with
 *   `creditable: false`, `reason: "unsupported_message"`, for review.
 */
export function extractDeposits(
  txResponse: Record<string, unknown>,
  address: string,
  opts: { denom?: string } = {},
): DepositEntry[] {
  const check = validateAddress(address);
  if (!check.valid) throw new CustodyKitError("INVALID_ARGUMENT", `deposit address: ${check.error}`);
  const denom = opts.denom ?? "uqor";
  if (Number(txResponse.code ?? 0) !== 0) return [];
  const tx = (txResponse.tx ?? {}) as { body?: { messages?: Record<string, unknown>[]; memo?: string } };
  const messages = tx.body?.messages ?? [];
  const memo = tx.body?.memo ?? "";
  const events = (Array.isArray(txResponse.events) ? txResponse.events : []) as TxEvent[];

  const failedEvm = new Set<string>();
  for (const ev of events) {
    if (ev.type === "ethereum_tx" && attr(ev, "ethereumTxFailed") !== undefined) {
      failedEvm.add(attr(ev, "msg_index") ?? "");
    }
  }

  const out: DepositEntry[] = [];
  for (const ev of events) {
    if (ev.type !== "transfer") continue;
    if (attr(ev, "recipient") !== check.bech32) continue;
    const idx = attr(ev, "msg_index");
    if (idx === undefined || !/^\d+$/.test(idx)) continue;
    const amount = sumDenom(attr(ev, "amount") ?? "", denom);
    if (amount === undefined) continue;
    const msgIndex = Number(idx);
    const messageType = String(messages[msgIndex]?.["@type"] ?? "");
    const sender = attr(ev, "sender") ?? "";
    let reason: string | null = null;
    if (messageType === MSG_ETHEREUM_TX && failedEvm.has(idx)) reason = "evm_failed";
    else if (sender === FEE_COLLECTOR) reason = "fee_refund";
    else if (![MSG_SEND, MSG_MULTI_SEND, MSG_ETHEREUM_TX].includes(messageType)) reason = "unsupported_message";
    out.push({
      txhash: String(txResponse.txhash ?? ""),
      height: String(txResponse.height ?? ""),
      msgIndex,
      messageType,
      sender,
      amount: amount.toString(),
      denom,
      memo,
      creditable: reason === null,
      reason,
    });
  }
  return out;
}
