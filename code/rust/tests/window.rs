// SPDX-License-Identifier: Apache-2.0
//
// MsgOpenEVMWindow with every optional field (5 to 9) set, encoded field by
// field here rather than read from the vectors file.

use custody_kit::*;
use serde_json::json;

const TYPE: &str = "/qorechain.pqc.v1.MsgOpenEVMWindow";
const SENDER: &str = "qor1npvwllfr9dqr8erajqqr6s0vxnk2ak55am9g2c";
const TARGET: &str = "0x000000000000000000000000000000000000dEaD";
const VALIDATOR: &str = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
const VALOPER1: &str = "qorvaloper19rl4cm2hmr8afy4kldpxz3fka4jguq0a5ws5he";
const VALOPER2: &str = "qorvaloper1npvwllfr9dqr8erajqqr6s0vxnk2ak55p70zhk";
const RECEIVER: &str = "channel-0/cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4";

fn varint(mut v: u64) -> Vec<u8> {
    let mut out = Vec::new();
    loop {
        let b = (v & 0x7f) as u8;
        v >>= 7;
        if v == 0 {
            out.push(b);
            return out;
        }
        out.push(b | 0x80);
    }
}

fn pb_str(num: u64, s: &str) -> Vec<u8> {
    let mut out = varint(num << 3 | 2);
    out.extend(varint(s.len() as u64));
    out.extend(s.as_bytes());
    out
}

fn pb_uint(num: u64, v: u64) -> Vec<u8> {
    let mut out = varint(num << 3);
    out.extend(varint(v));
    out
}

fn full() -> Vec<u8> {
    [
        pb_str(1, SENDER),
        pb_uint(2, 600),
        pb_uint(3, 10),
        pb_str(4, "25000000"),
        pb_uint(5, 1),
        pb_str(6, TARGET),
        pb_str(7, VALIDATOR),
        pb_str(8, VALOPER1),
        pb_str(8, VALOPER2),
        pb_str(9, RECEIVER),
    ]
    .concat()
}

#[test]
fn decodes_every_field() {
    let d = decode_message(TYPE, &full()).unwrap();
    assert_eq!(
        serde_json::to_value(&d).unwrap(),
        json!({
            "typeUrl": TYPE,
            "fields": {
                "sender": SENDER,
                "blocks": "600",
                "max_txs": "10",
                "max_value": "25000000",
                "native_only": true,
                "allowed_targets": [TARGET],
                "validators": [VALIDATOR],
                "staking_validators": [VALOPER1, VALOPER2],
                "ibc_receivers": [RECEIVER],
            },
            "value": null,
        })
    );
}

#[test]
fn still_refuses_unknown_field_10() {
    for extra in [pb_str(10, "x"), pb_uint(10, 1)] {
        let err = decode_message(TYPE, &[full(), extra].concat()).expect_err("field 10");
        assert_eq!(err.code(), "UNKNOWN_FIELD");
    }
}

#[test]
fn refuses_list_field_with_wrong_wire_type() {
    let err = decode_message(TYPE, &[full(), pb_uint(9, 1)].concat()).expect_err("field 9 varint");
    assert_eq!(err.code(), "MALFORMED_TX");
}
