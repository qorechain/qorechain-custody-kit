// SPDX-License-Identifier: Apache-2.0
//
// Read-only checks against the testnet. Run with QORE_LIVE_TEST=1; QORE_REST
// overrides the endpoint (default https://api-testnet.qore.host).

use custody_kit::*;
use serde_json::Value;

fn rest() -> Option<String> {
    if std::env::var("QORE_LIVE_TEST").as_deref() != Ok("1") {
        eprintln!("skipped: set QORE_LIVE_TEST=1 to run the live checks");
        return None;
    }
    Some(std::env::var("QORE_REST").unwrap_or_else(|_| DEFAULT_TESTNET_REST.to_string()))
}

fn get_json(rest: &str, path: &str) -> Value {
    let tls = native_tls::TlsConnector::new().expect("system TLS");
    let agent = ureq::AgentBuilder::new()
        .tls_connector(std::sync::Arc::new(tls))
        .build();
    let url = format!("{}{}", rest.trim_end_matches('/'), path);
    let text = agent
        .get(&url)
        .set("User-Agent", "qorechain-custody-kit")
        .call()
        .unwrap_or_else(|e| panic!("GET {url}: {e}"))
        .into_string()
        .expect("body");
    serde_json::from_str(&text).expect("JSON")
}

#[test]
fn staking_and_staking_tier_parameters() {
    let Some(rest) = rest() else { return };
    let staking = get_json(&rest, "/cosmos/staking/v1beta1/params");
    assert_eq!(staking["params"]["bond_denom"], "uqor");
    assert_eq!(staking["params"]["unbonding_time"], "1814400s"); // 21 days
    let tier = get_json(&rest, "/qorechain/stakingtier/v1/params");
    assert_eq!(tier["enabled"], true);
    let months: Vec<u64> = tier["lock_tiers"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["months"].as_u64().unwrap())
        .collect();
    assert_eq!(months, vec![3, 6, 12]);
}

#[test]
fn deposit_query_finds_a_recent_transfer() {
    let Some(rest) = rest() else { return };
    let recent = get_json(
        &rest,
        &format!(
            "/cosmos/tx/v1beta1/txs?query={}&order_by=ORDER_BY_DESC&limit=20",
            percent_encode("message.action='/cosmos.bank.v1beta1.MsgSend'")
        ),
    );
    let mut target: Option<(String, u64, String, u128)> = None;
    for resp in recent["tx_responses"]
        .as_array()
        .cloned()
        .unwrap_or_default()
    {
        let msgs = resp["tx"]["body"]["messages"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if resp["code"].as_u64() != Some(0) || msgs.len() != 1 {
            continue;
        }
        let msg = &msgs[0];
        let uqor: u128 = msg["amount"]
            .as_array()
            .cloned()
            .unwrap_or_default()
            .iter()
            .filter(|c| c["denom"] == "uqor")
            .map(|c| c["amount"].as_str().unwrap().parse::<u128>().unwrap())
            .sum();
        if uqor > 0 && msg["from_address"] != msg["to_address"] {
            target = Some((
                resp["txhash"].as_str().unwrap().to_string(),
                resp["height"].as_str().unwrap().parse().unwrap(),
                msg["to_address"].as_str().unwrap().to_string(),
                uqor,
            ));
            break;
        }
    }
    let (txhash, height, to, amount) = target.expect("no recent MsgSend of uqor on the testnet");
    let path = build_deposit_query(&DepositQueryOptions {
        address: to.clone(),
        min_height: Some(height),
        max_height: Some(height),
        ..Default::default()
    })
    .unwrap();
    let body = get_json(&rest, &path);
    let mut entries = Vec::new();
    for r in body["tx_responses"].as_array().cloned().unwrap_or_default() {
        entries.extend(extract_deposits(&r, &to, "uqor").unwrap());
    }
    let hit = entries
        .iter()
        .find(|e| e.txhash == txhash)
        .expect("the transfer is found by the deposit query");
    assert!(hit.creditable);
    assert_eq!(hit.message_type, MSG_SEND);
    assert_eq!(hit.amount, amount.to_string());
}
