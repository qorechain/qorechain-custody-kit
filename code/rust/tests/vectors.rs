// SPDX-License-Identifier: Apache-2.0
//
// Checks the Rust port against vectors/custody-v1.json and, when it has been
// fetched (scripts/fetch-qoresign-vectors.sh), against the hybrid
// transactions of vectors/qoresign-v1.json.

use std::path::PathBuf;

use custody_kit::*;
use qoresign::{ClassicalKeyType, VerifyVersion};
use serde_json::{json, Value};

fn vectors_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../vectors")
}

fn load(name: &str) -> Option<Value> {
    let text = std::fs::read_to_string(vectors_dir().join(name)).ok()?;
    Some(serde_json::from_str(&text).expect("valid JSON"))
}

fn custody() -> Value {
    load("custody-v1.json").expect("vectors/custody-v1.json")
}

fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key]
        .as_str()
        .unwrap_or_else(|| panic!("{key} is not a string"))
}

fn h(x: &str) -> Vec<u8> {
    hex::decode(x).expect("hex")
}

fn key_type(name: &str) -> ClassicalKeyType {
    match name {
        "eth_secp256k1" => ClassicalKeyType::EthSecp256k1,
        _ => ClassicalKeyType::Secp256k1,
    }
}

fn address_options(c: &Value) -> ValidateAddressOptions {
    let mut opts = ValidateAddressOptions::default();
    if let Some(allow) = c["allow"].as_array() {
        opts.allow = allow
            .iter()
            .map(|k| match k.as_str() {
                Some("validator") => AddressKind::Validator,
                _ => AddressKind::Account,
            })
            .collect();
    }
    opts.require_eip55 = c["requireEip55"].as_bool().unwrap_or(false);
    opts
}

#[test]
fn addresses() {
    let v = custody();
    let mut n = 0;
    for c in v["addresses"]["valid"].as_array().unwrap() {
        let r = validate_address(s(c, "input"), &address_options(c));
        let mut want = c["expected"].clone();
        want["valid"] = json!(true);
        assert_eq!(serde_json::to_value(&r).unwrap(), want, "{}", c["input"]);
        n += 1;
    }
    for c in v["addresses"]["invalid"].as_array().unwrap() {
        let r = validate_address(s(c, "input"), &address_options(c));
        assert!(!r.is_valid(), "{}", c["input"]);
        assert_eq!(r.error(), Some(s(c, "error")), "{}", c["input"]);
        assert_eq!(serde_json::to_value(&r).unwrap()["valid"], json!(false));
        n += 1;
    }
    assert!(n > 20);
}

#[test]
fn transactions_decode_and_verify() {
    let v = custody();
    for t in v["transactions"].as_array().unwrap() {
        let tx = h(s(t, "txBytes"));
        let decoded = decode_tx(&tx).unwrap();
        assert_eq!(
            serde_json::to_value(&decoded).unwrap(),
            t["decoded"],
            "{}",
            t["name"]
        );
        for c in t["verifyCases"].as_array().unwrap() {
            let chain_id = c["chainId"].as_str().unwrap_or(s(t, "chainId"));
            let account_number = c["accountNumber"]
                .as_u64()
                .unwrap_or_else(|| t["accountNumber"].as_u64().unwrap());
            let classical = h(c["classicalPublicKey"]
                .as_str()
                .unwrap_or(s(t, "classicalPublicKey")));
            let kt = key_type(
                c["classicalKeyType"]
                    .as_str()
                    .unwrap_or(s(t, "classicalKeyType")),
            );
            let pq = h(c["pqPublicKey"].as_str().unwrap_or(s(t, "pqPublicKey")));
            let omit = c["omitPqPublicKey"].as_bool().unwrap_or(false);
            let mut args = VerifyTxArgs::new(
                &tx,
                chain_id,
                account_number,
                &classical,
                (!omit).then_some(&pq[..]),
            );
            args.classical_key_type = kt;
            let r = verify_tx(&args).unwrap();
            assert_eq!(
                serde_json::to_value(&r).unwrap(),
                c["expected"],
                "{}: {}",
                t["name"],
                c["description"]
            );
        }
    }
}

#[test]
fn messages() {
    let v = custody();
    for m in v["messages"].as_array().unwrap() {
        let d = decode_message(s(m, "typeUrl"), &h(s(m, "value"))).unwrap();
        assert_eq!(
            serde_json::to_value(&d).unwrap(),
            m["decoded"],
            "{}",
            m["typeUrl"]
        );
    }
}

#[test]
fn malformed() {
    let v = custody();
    for m in v["malformed"].as_array().unwrap() {
        let err = decode_tx(&h(s(m, "txBytes"))).expect_err(s(m, "name"));
        assert_eq!(err.code(), s(m, "error"), "{}", m["name"]);
    }
}

fn query_options(o: &Value) -> DepositQueryOptions {
    DepositQueryOptions {
        address: s(o, "address").to_string(),
        min_height: o["minHeight"].as_u64(),
        max_height: o["maxHeight"].as_u64(),
        event: match o["event"].as_str() {
            Some("coin_received") => DepositEvent::CoinReceived,
            _ => DepositEvent::Transfer,
        },
        page: o["page"].as_u64(),
        limit: o["limit"].as_u64(),
        order_by: match o["orderBy"].as_str() {
            Some("desc") => OrderBy::Desc,
            _ => OrderBy::Asc,
        },
    }
}

#[test]
fn deposit_queries() {
    let v = custody();
    for q in v["depositQueries"].as_array().unwrap() {
        let got = build_deposit_query(&query_options(&q["options"])).unwrap();
        assert_eq!(got, s(q, "expected"));
    }
    for q in v["depositQueryErrors"].as_array().unwrap() {
        let err = build_deposit_query(&query_options(&q["options"])).unwrap_err();
        assert_eq!(err.code(), s(q, "error"), "{}", q["options"]);
    }
}

#[test]
fn deposits() {
    let v = custody();
    for d in v["deposits"].as_array().unwrap() {
        let denom = d["denom"].as_str().unwrap_or("uqor");
        let got = extract_deposits(&d["txResponse"], s(d, "address"), denom).unwrap();
        assert_eq!(
            serde_json::to_value(&got).unwrap(),
            d["expected"],
            "{}",
            d["name"]
        );
    }
}

#[test]
fn qoresign_vectors_by_reference() {
    let Some(q) = load("qoresign-v1.json") else {
        eprintln!(
            "skipped: vectors/qoresign-v1.json not present (run scripts/fetch-qoresign-vectors.sh)"
        );
        return;
    };
    let classical = h(s(&q["accounts"]["secp256k1"], "publicKey"));
    let pq = h(s(&q["canonical"][0], "publicKey"));
    for c in q["hybridTx"]["cases"].as_array().unwrap() {
        let tx = h(s(c, "txBytes"));
        let mut args = VerifyTxArgs::new(
            &tx,
            s(&q, "chainId"),
            q["hybridTx"]["accountNumber"].as_u64().unwrap(),
            &classical,
            Some(&pq),
        );
        args.version = VerifyVersion::Either;
        let r = verify_tx(&args).unwrap();
        assert_eq!(
            serde_json::to_value(&r).unwrap(),
            json!({ "valid": true, "classical": true, "signerKey": "match",
                    "pq": { "valid": true, "signBytesVersion": c["signBytesVersion"], "reason": null } })
        );
    }
}
