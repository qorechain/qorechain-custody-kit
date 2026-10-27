// SPDX-License-Identifier: Apache-2.0
//
// Example command line over the kit:
//
//   cargo run --example custody-kit -- validate <address> [--allow-validator] [--require-eip55]
//   cargo run --example custody-kit -- decode <tx hex or base64>
//   cargo run --example custody-kit -- verify <tx hex> --chain-id ID --account-number N
//                                      --pubkey HEX [--eth] [--pq-pubkey HEX]
//   cargo run --example custody-kit -- deposits <address> [--from-height H] [--to-height H] [--rest URL]

use std::process::ExitCode;

use custody_kit::{
    build_deposit_query, decode_tx, extract_deposits, validate_address, verify_tx, AddressKind,
    DepositQueryOptions, ValidateAddressOptions, VerifyTxArgs, DEFAULT_TESTNET_REST,
};
use qoresign::ClassicalKeyType;
use serde::Serialize;
use serde_json::Value;

fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    let i = args.iter().position(|a| a == name)?;
    args.get(i + 1).map(String::as_str)
}

fn tx_bytes_from(s: &str) -> Result<Vec<u8>, String> {
    let clean = s.strip_prefix("0x").unwrap_or(s);
    if let Ok(b) = hex::decode(clean) {
        return Ok(b);
    }
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(s)
        .map_err(|e| e.to_string())
}

fn print<T: Serialize>(v: &T) {
    println!("{}", serde_json::to_string_pretty(v).expect("serializes"));
}

fn get_json(rest: &str, path: &str) -> Result<Value, String> {
    let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    let agent = ureq::AgentBuilder::new()
        .tls_connector(std::sync::Arc::new(tls))
        .build();
    let url = format!("{}{}", rest.trim_end_matches('/'), path);
    let text = agent
        .get(&url)
        .set("User-Agent", "qorechain-custody-kit")
        .call()
        .map_err(|e| format!("GET {url}: {e}"))?
        .into_string()
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

fn run(args: &[String]) -> Result<bool, String> {
    let (Some(cmd), Some(arg)) = (args.first(), args.get(1)) else {
        return Err("usage: custody-kit validate|decode|verify|deposits <arg> [options]".into());
    };
    let rest = &args[2..];
    match cmd.as_str() {
        "validate" => {
            let mut opts = ValidateAddressOptions::default();
            if rest.iter().any(|a| a == "--allow-validator") {
                opts.allow.push(AddressKind::Validator);
            }
            opts.require_eip55 = rest.iter().any(|a| a == "--require-eip55");
            let r = validate_address(arg, &opts);
            print(&r);
            Ok(r.is_valid())
        }
        "decode" => {
            let tx = decode_tx(&tx_bytes_from(arg)?).map_err(|e| e.to_string())?;
            print(&tx);
            Ok(true)
        }
        "verify" => {
            let tx = tx_bytes_from(arg)?;
            let pubkey =
                hex::decode(flag(rest, "--pubkey").unwrap_or("")).map_err(|e| e.to_string())?;
            let pq = match flag(rest, "--pq-pubkey") {
                Some(h) => Some(hex::decode(h).map_err(|e| e.to_string())?),
                None => None,
            };
            let account_number = flag(rest, "--account-number")
                .unwrap_or("0")
                .parse::<u64>()
                .map_err(|e| e.to_string())?;
            let mut a = VerifyTxArgs::new(
                &tx,
                flag(rest, "--chain-id").unwrap_or(""),
                account_number,
                &pubkey,
                pq.as_deref(),
            );
            if rest.iter().any(|x| x == "--eth") {
                a.classical_key_type = ClassicalKeyType::EthSecp256k1;
            }
            let r = verify_tx(&a).map_err(|e| e.to_string())?;
            print(&r);
            Ok(r.valid)
        }
        "deposits" => {
            let rest_url = flag(rest, "--rest")
                .map(String::from)
                .or_else(|| std::env::var("QORE_REST").ok())
                .unwrap_or_else(|| DEFAULT_TESTNET_REST.to_string());
            let height = |name| -> Result<Option<u64>, String> {
                flag(rest, name)
                    .map(|h| h.parse::<u64>().map_err(|e| e.to_string()))
                    .transpose()
            };
            let path = build_deposit_query(&DepositQueryOptions {
                address: arg.clone(),
                min_height: height("--from-height")?,
                max_height: height("--to-height")?,
                ..Default::default()
            })
            .map_err(|e| e.to_string())?;
            let body = get_json(&rest_url, &path)?;
            let mut out = Vec::new();
            for r in body["tx_responses"].as_array().cloned().unwrap_or_default() {
                out.extend(extract_deposits(&r, arg, "uqor").map_err(|e| e.to_string())?);
            }
            print(&out);
            Ok(true)
        }
        other => Err(format!("unknown command {other}")),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match run(&args) {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(1),
        Err(e) => {
            eprintln!("{e}");
            ExitCode::from(2)
        }
    }
}
