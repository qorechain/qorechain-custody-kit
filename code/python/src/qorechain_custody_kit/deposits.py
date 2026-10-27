# SPDX-License-Identifier: Apache-2.0
"""Deposit detection over the REST API.

A query builder for incoming transfers to an address, and a parser that turns
one ``tx_response`` into candidate deposits with a credit decision.
"""

import re
from typing import Any, Dict, List, Optional

from .address import validate_address
from .errors import INVALID_ARGUMENT, CustodyKitError

#: Fee collector module account (same address on both networks). Fees and EVM gas refunds move through it.
FEE_COLLECTOR = "qor17xpfvakm2amg962yls6f84z3kell8c5lyj5r7l"

MSG_SEND = "/cosmos.bank.v1beta1.MsgSend"
MSG_MULTI_SEND = "/cosmos.bank.v1beta1.MsgMultiSend"
MSG_ETHEREUM_TX = "/cosmos.evm.vm.v1.MsgEthereumTx"

_UNRESERVED = re.compile(r"[A-Za-z0-9\-._~]")
_COIN = re.compile(r"^(\d+)(.+)$", re.DOTALL)


def percent_encode(text: str) -> str:
    """RFC 3986 percent-encoding: everything except unreserved characters."""
    out = []
    for b in text.encode("utf-8"):
        c = chr(b)
        out.append(c if _UNRESERVED.match(c) else "%{:02X}".format(b))
    return "".join(out)


def _non_negative(name: str, v: int) -> int:
    n = int(v)
    if n < 0:
        raise CustodyKitError(INVALID_ARGUMENT, f"{name} must not be negative")
    return n


def deposit_event_query(
    address: str,
    min_height: Optional[int] = None,
    max_height: Optional[int] = None,
    event: str = "transfer",
) -> str:
    """The events query, e.g. ``transfer.recipient='qor1...' AND tx.height>=100``."""
    check = validate_address(address)
    if not check["valid"]:
        raise CustodyKitError(INVALID_ARGUMENT, f"deposit address: {check['error']}")
    key = "transfer.recipient" if event == "transfer" else "coin_received.receiver"
    parts = [f"{key}='{check['bech32']}'"]
    if min_height is not None:
        parts.append(f"tx.height>={_non_negative('min_height', min_height)}")
    if max_height is not None:
        parts.append(f"tx.height<={_non_negative('max_height', max_height)}")
    return " AND ".join(parts)


def build_deposit_query(
    address: str,
    min_height: Optional[int] = None,
    max_height: Optional[int] = None,
    event: str = "transfer",
    page: int = 1,
    limit: int = 50,
    order_by: str = "asc",
) -> str:
    """Path and query string for ``GET /cosmos/tx/v1beta1/txs``. Append it to a REST base URL."""
    if not isinstance(page, int) or isinstance(page, bool) or page < 1:
        raise CustodyKitError(INVALID_ARGUMENT, "page must be 1 or more")
    if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1 or limit > 100:
        raise CustodyKitError(INVALID_ARGUMENT, "limit must be between 1 and 100")
    order = "ORDER_BY_ASC" if order_by == "asc" else "ORDER_BY_DESC"
    query = deposit_event_query(address, min_height, max_height, event)
    return f"/cosmos/tx/v1beta1/txs?query={percent_encode(query)}&order_by={order}&page={page}&limit={limit}"


def _attr(ev: Dict[str, Any], key: str) -> Optional[str]:
    for a in ev.get("attributes") or []:
        if a.get("key") == key:
            return a.get("value")
    return None


def _sum_denom(amounts: str, denom: str) -> Optional[int]:
    total: Optional[int] = None
    for part in amounts.split(","):
        m = _COIN.match(part.strip())
        if m and m.group(2) == denom:
            total = (total or 0) + int(m.group(1))
    return total


def extract_deposits(tx_response: Dict[str, Any], address: str, denom: str = "uqor") -> List[Dict[str, Any]]:
    """Incoming transfers of ``denom`` to ``address`` in one ``tx_response``, with a credit decision.

    - A failed transaction (``code != 0``) gives nothing.
    - Transfers without a ``msg_index`` (fee payment) are ignored.
    - ``MsgSend`` and ``MsgMultiSend`` outputs are creditable.
    - ``MsgEthereumTx`` is creditable unless the EVM execution failed
      (``ethereumTxFailed``) or the transfer is a gas refund from the fee collector.
    - Any other message is returned with ``creditable: False``,
      ``reason: "unsupported_message"``, for review.
    """
    check = validate_address(address)
    if not check["valid"]:
        raise CustodyKitError(INVALID_ARGUMENT, f"deposit address: {check['error']}")
    if int(tx_response.get("code") or 0) != 0:
        return []
    body = (tx_response.get("tx") or {}).get("body") or {}
    messages = body.get("messages") or []
    memo = body.get("memo") or ""
    events = tx_response.get("events")
    if not isinstance(events, list):
        events = []

    failed_evm = set()
    for ev in events:
        if ev.get("type") == "ethereum_tx" and _attr(ev, "ethereumTxFailed") is not None:
            failed_evm.add(_attr(ev, "msg_index") or "")

    out: List[Dict[str, Any]] = []
    for ev in events:
        if ev.get("type") != "transfer" or _attr(ev, "recipient") != check["bech32"]:
            continue
        idx = _attr(ev, "msg_index")
        if idx is None or not re.fullmatch(r"\d+", idx):
            continue
        amount = _sum_denom(_attr(ev, "amount") or "", denom)
        if amount is None:
            continue
        msg_index = int(idx)
        message_type = str(messages[msg_index].get("@type", "")) if msg_index < len(messages) else ""
        sender = _attr(ev, "sender") or ""
        reason: Optional[str] = None
        if message_type == MSG_ETHEREUM_TX and idx in failed_evm:
            reason = "evm_failed"
        elif sender == FEE_COLLECTOR:
            reason = "fee_refund"
        elif message_type not in (MSG_SEND, MSG_MULTI_SEND, MSG_ETHEREUM_TX):
            reason = "unsupported_message"
        out.append(
            {
                "txhash": str(tx_response.get("txhash", "")),
                "height": str(tx_response.get("height", "")),
                "msgIndex": msg_index,
                "messageType": message_type,
                "sender": sender,
                "amount": str(amount),
                "denom": denom,
                "memo": memo,
                "creditable": reason is None,
                "reason": reason,
            }
        )
    return out
