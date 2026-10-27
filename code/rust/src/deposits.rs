// SPDX-License-Identifier: Apache-2.0
//
// Deposit detection over the REST API: a query builder for incoming
// transfers to an address, and a parser that turns one `tx_response` into
// candidate deposits with a credit decision.

use serde::Serialize;
use serde_json::Value;

use crate::address::{validate_address, AddressCheck, ValidateAddressOptions};
use crate::errors::{Error, Result};

/// Fee collector module account (same address on both networks). Fees and EVM gas refunds move through it.
pub const FEE_COLLECTOR: &str = "qor17xpfvakm2amg962yls6f84z3kell8c5lyj5r7l";

pub const MSG_SEND: &str = "/cosmos.bank.v1beta1.MsgSend";
pub const MSG_MULTI_SEND: &str = "/cosmos.bank.v1beta1.MsgMultiSend";
pub const MSG_ETHEREUM_TX: &str = "/cosmos.evm.vm.v1.MsgEthereumTx";

/// Event to match.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum DepositEvent {
    /// `transfer.recipient` (default).
    #[default]
    Transfer,
    /// `coin_received.receiver`.
    CoinReceived,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum OrderBy {
    /// Oldest first (default), what a scanner that keeps a height cursor wants.
    #[default]
    Asc,
    Desc,
}

/// Options of [`build_deposit_query`].
#[derive(Clone, Debug, Default)]
pub struct DepositQueryOptions {
    /// `qor1...` or `0x...` account address.
    pub address: String,
    /// Inclusive lower bound on the block height.
    pub min_height: Option<u64>,
    /// Inclusive upper bound on the block height.
    pub max_height: Option<u64>,
    pub event: DepositEvent,
    /// 1-based page. Default 1.
    pub page: Option<u64>,
    /// 1 to 100. Default 50.
    pub limit: Option<u64>,
    pub order_by: OrderBy,
}

/// RFC 3986 percent-encoding: everything except unreserved characters.
pub fn percent_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(char::from(b));
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn account_bech32(address: &str) -> Result<String> {
    match validate_address(address, &ValidateAddressOptions::default()) {
        AddressCheck::Valid { bech32, .. } => Ok(bech32),
        AddressCheck::Invalid { error, .. } => {
            Err(Error::InvalidArgument(format!("deposit address: {error}")))
        }
    }
}

/// The events query, for example
/// `transfer.recipient='qor1...' AND tx.height>=100 AND tx.height<=200`.
pub fn deposit_event_query(opts: &DepositQueryOptions) -> Result<String> {
    let bech32 = account_bech32(&opts.address)?;
    let key = match opts.event {
        DepositEvent::Transfer => "transfer.recipient",
        DepositEvent::CoinReceived => "coin_received.receiver",
    };
    let mut parts = vec![format!("{key}='{bech32}'")];
    if let Some(h) = opts.min_height {
        parts.push(format!("tx.height>={h}"));
    }
    if let Some(h) = opts.max_height {
        parts.push(format!("tx.height<={h}"));
    }
    Ok(parts.join(" AND "))
}

/// Path and query string for `GET /cosmos/tx/v1beta1/txs`. Append it to a REST base URL.
pub fn build_deposit_query(opts: &DepositQueryOptions) -> Result<String> {
    let page = opts.page.unwrap_or(1);
    let limit = opts.limit.unwrap_or(50);
    if page < 1 {
        return Err(Error::InvalidArgument("page must be 1 or more".into()));
    }
    if !(1..=100).contains(&limit) {
        return Err(Error::InvalidArgument(
            "limit must be between 1 and 100".into(),
        ));
    }
    let order = match opts.order_by {
        OrderBy::Asc => "ORDER_BY_ASC",
        OrderBy::Desc => "ORDER_BY_DESC",
    };
    Ok(format!(
        "/cosmos/tx/v1beta1/txs?query={}&order_by={order}&page={page}&limit={limit}",
        percent_encode(&deposit_event_query(opts)?)
    ))
}

/// One incoming transfer with the kit's credit decision.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DepositEntry {
    pub txhash: String,
    pub height: String,
    pub msg_index: u64,
    pub message_type: String,
    pub sender: String,
    /// Integer amount in the base denom.
    pub amount: String,
    pub denom: String,
    pub memo: String,
    /// True when the kit's rules consider this a deposit to credit.
    pub creditable: bool,
    /// `evm_failed`, `fee_refund` or `unsupported_message`; `None` when creditable.
    pub reason: Option<String>,
}

fn attr<'a>(ev: &'a Value, key: &str) -> Option<&'a str> {
    ev.get("attributes")?
        .as_array()?
        .iter()
        .find(|a| a.get("key").and_then(Value::as_str) == Some(key))?
        .get("value")?
        .as_str()
}

fn as_text(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

/// Add two non-negative decimal strings exactly.
fn add_decimal(a: &str, b: &str) -> String {
    let (a, b) = (a.as_bytes(), b.as_bytes());
    let mut out = Vec::new();
    let (mut i, mut j, mut carry) = (a.len(), b.len(), 0u8);
    while i > 0 || j > 0 || carry > 0 {
        let mut d = carry;
        if i > 0 {
            i -= 1;
            d += a[i] - b'0';
        }
        if j > 0 {
            j -= 1;
            d += b[j] - b'0';
        }
        out.push(b'0' + d % 10);
        carry = d / 10;
    }
    out.reverse();
    let s = String::from_utf8(out).expect("digits");
    let trimmed = s.trim_start_matches('0');
    if trimmed.is_empty() {
        "0".into()
    } else {
        trimmed.into()
    }
}

fn sum_denom(amounts: &str, denom: &str) -> Option<String> {
    let mut total: Option<String> = None;
    for part in amounts.split(',') {
        let part = part.trim();
        let digits = part.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 || digits == part.len() {
            continue;
        }
        if &part[digits..] == denom {
            total = Some(add_decimal(
                total.as_deref().unwrap_or("0"),
                &part[..digits],
            ));
        }
    }
    total
}

/// Incoming transfers of `denom` to `address` in one `tx_response` (as
/// returned by `GET /cosmos/tx/v1beta1/txs` or `/txs/{hash}`), with a credit
/// decision for each. Same rules as the TypeScript reference:
///
/// - a failed transaction (`code != 0`) gives nothing;
/// - transfers without a `msg_index` (fee payment) are ignored;
/// - `MsgSend` and `MsgMultiSend` outputs are creditable;
/// - `MsgEthereumTx` is creditable unless the EVM execution failed
///   (`ethereumTxFailed`) or the transfer is a gas refund from the fee collector;
/// - any other message is returned with `creditable: false`,
///   `reason: "unsupported_message"`, for review.
pub fn extract_deposits(
    tx_response: &Value,
    address: &str,
    denom: &str,
) -> Result<Vec<DepositEntry>> {
    let bech32 = account_bech32(address)?;
    let code = match tx_response.get("code") {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(1.0),
        Some(Value::String(s)) => s.parse::<f64>().unwrap_or(1.0),
        _ => 0.0,
    };
    if code != 0.0 {
        return Ok(Vec::new());
    }
    let body = tx_response.get("tx").and_then(|t| t.get("body"));
    let empty = Vec::new();
    let messages = body
        .and_then(|b| b.get("messages"))
        .and_then(Value::as_array)
        .unwrap_or(&empty);
    let memo = body
        .and_then(|b| b.get("memo"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let events = tx_response
        .get("events")
        .and_then(Value::as_array)
        .unwrap_or(&empty);

    let failed_evm: Vec<&str> = events
        .iter()
        .filter(|ev| {
            ev.get("type").and_then(Value::as_str) == Some("ethereum_tx")
                && attr(ev, "ethereumTxFailed").is_some()
        })
        .map(|ev| attr(ev, "msg_index").unwrap_or(""))
        .collect();

    let mut out = Vec::new();
    for ev in events {
        if ev.get("type").and_then(Value::as_str) != Some("transfer") {
            continue;
        }
        if attr(ev, "recipient") != Some(bech32.as_str()) {
            continue;
        }
        let Some(idx) = attr(ev, "msg_index") else {
            continue;
        };
        if idx.is_empty() || !idx.bytes().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let Ok(msg_index) = idx.parse::<u64>() else {
            continue;
        };
        let Some(amount) = sum_denom(attr(ev, "amount").unwrap_or(""), denom) else {
            continue;
        };
        let message_type = usize::try_from(msg_index)
            .ok()
            .and_then(|i| messages.get(i))
            .and_then(|m| m.get("@type"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let sender = attr(ev, "sender").unwrap_or("").to_string();
        let reason = if message_type == MSG_ETHEREUM_TX && failed_evm.contains(&idx) {
            Some("evm_failed")
        } else if sender == FEE_COLLECTOR {
            Some("fee_refund")
        } else if ![MSG_SEND, MSG_MULTI_SEND, MSG_ETHEREUM_TX].contains(&message_type.as_str()) {
            Some("unsupported_message")
        } else {
            None
        };
        out.push(DepositEntry {
            txhash: as_text(tx_response.get("txhash")),
            height: as_text(tx_response.get("height")),
            msg_index,
            message_type,
            sender,
            amount,
            denom: denom.to_string(),
            memo: memo.clone(),
            creditable: reason.is_none(),
            reason: reason.map(String::from),
        });
    }
    Ok(out)
}
