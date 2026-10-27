// SPDX-License-Identifier: Apache-2.0
//
// Decode a signed native-lane transaction (`TxRaw`) into what a custody
// operator reviews before broadcasting: the messages and their fields, the
// fee, the signer, and whether the ML-DSA-87 layer is present.

use serde::Serialize;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::errors::{Error, Result};
use crate::proto::{as_bytes, as_string, as_uint, expect_wire, read_fields, Field, WIRE_LEN};

pub const PQC_HYBRID_TYPE_URL: &str = "/qorechain.pqc.v1.PQCHybridSignature";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Coin {
    pub denom: String,
    pub amount: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedMessage {
    pub type_url: String,
    /// Decoded fields (proto field names) for the message types the kit knows.
    pub fields: Option<Map<String, Value>>,
    /// Hex of the message bytes, only for message types the kit does not know.
    pub value: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PqcLayerSummary {
    pub algorithm_id: u64,
    pub signature_length: usize,
    /// 0 when the public key is not embedded.
    pub public_key_length: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedSigner {
    pub public_key_type: Option<String>,
    /// Hex of the compressed secp256k1 key, for single-key accounts.
    pub public_key: Option<String>,
    pub sequence: String,
    /// 1 = SIGN_MODE_DIRECT. `None` for a multisig mode.
    pub sign_mode: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fee {
    pub amount: Vec<Coin>,
    pub gas_limit: String,
    pub payer: String,
    pub granter: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedTx {
    /// Uppercase hex SHA-256 of the transaction bytes.
    pub tx_hash: String,
    pub messages: Vec<DecodedMessage>,
    pub memo: String,
    pub timeout_height: String,
    pub unordered: bool,
    pub timeout_timestamp_seconds: String,
    pub extension_options: Vec<String>,
    pub non_critical_extension_options: Vec<String>,
    pub pqc_layers: Vec<PqcLayerSummary>,
    pub signers: Vec<DecodedSigner>,
    pub fee: Fee,
    pub signature_count: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Kind {
    Str,
    Uint,
    Bool,
    Bytes,
    Coin,
    Coins,
    Strings,
    Io,
}

type Layout = &'static [(u64, &'static str, Kind)];

const DELEGATION: Layout = &[
    (1, "delegator_address", Kind::Str),
    (2, "validator_address", Kind::Str),
    (3, "amount", Kind::Coin),
];

/// Field layouts of the message types a custodian handles.
const KNOWN_MESSAGES: &[(&str, Layout)] = &[
    (
        "/cosmos.bank.v1beta1.MsgSend",
        &[
            (1, "from_address", Kind::Str),
            (2, "to_address", Kind::Str),
            (3, "amount", Kind::Coins),
        ],
    ),
    (
        "/cosmos.bank.v1beta1.MsgMultiSend",
        &[(1, "inputs", Kind::Io), (2, "outputs", Kind::Io)],
    ),
    ("/cosmos.staking.v1beta1.MsgDelegate", DELEGATION),
    ("/cosmos.staking.v1beta1.MsgUndelegate", DELEGATION),
    (
        "/cosmos.staking.v1beta1.MsgBeginRedelegate",
        &[
            (1, "delegator_address", Kind::Str),
            (2, "validator_src_address", Kind::Str),
            (3, "validator_dst_address", Kind::Str),
            (4, "amount", Kind::Coin),
        ],
    ),
    (
        "/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation",
        &[
            (1, "delegator_address", Kind::Str),
            (2, "validator_address", Kind::Str),
            (3, "amount", Kind::Coin),
            (4, "creation_height", Kind::Uint),
        ],
    ),
    (
        "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
        &[
            (1, "delegator_address", Kind::Str),
            (2, "validator_address", Kind::Str),
        ],
    ),
    (
        "/cosmos.distribution.v1beta1.MsgSetWithdrawAddress",
        &[
            (1, "delegator_address", Kind::Str),
            (2, "withdraw_address", Kind::Str),
        ],
    ),
    (
        "/qorechain.stakingtier.v1.MsgLockDelegation",
        &[
            (1, "delegator", Kind::Str),
            (2, "validator", Kind::Str),
            (3, "amount", Kind::Str),
            (4, "months", Kind::Uint),
        ],
    ),
    (
        "/qorechain.stakingtier.v1.MsgUnlockEarly",
        &[(1, "delegator", Kind::Str), (2, "lock_id", Kind::Uint)],
    ),
    (
        "/qorechain.stakingtier.v1.MsgClaimBonus",
        &[(1, "holder", Kind::Str)],
    ),
    (
        "/qorechain.pqc.v1.MsgRegisterPQCKeyV2",
        &[
            (1, "sender", Kind::Str),
            (2, "public_key", Kind::Bytes),
            (3, "algorithm_id", Kind::Uint),
            (4, "ecdsa_pubkey", Kind::Bytes),
            (5, "key_type", Kind::Str),
            (6, "proof_of_possession", Kind::Bytes),
        ],
    ),
    (
        "/qorechain.pqc.v1.MsgRotatePQCKey",
        &[
            (1, "sender", Kind::Str),
            (2, "old_public_key", Kind::Bytes),
            (3, "new_public_key", Kind::Bytes),
            (4, "old_signature", Kind::Bytes),
            (5, "new_signature", Kind::Bytes),
        ],
    ),
    (
        "/qorechain.pqc.v1.MsgOpenEVMWindow",
        &[
            (1, "sender", Kind::Str),
            (2, "blocks", Kind::Uint),
            (3, "max_txs", Kind::Uint),
            (4, "max_value", Kind::Str),
            (5, "native_only", Kind::Bool),
            (6, "allowed_targets", Kind::Strings),
        ],
    ),
    (
        "/qorechain.pqc.v1.MsgCloseEVMWindow",
        &[(1, "sender", Kind::Str)],
    ),
];

/// The message type URLs [`decode_message`] decodes field by field.
pub fn known_message_types() -> impl Iterator<Item = &'static str> {
    KNOWN_MESSAGES.iter().map(|(t, _)| *t)
}

fn unknown_field<T>(what: &str, f: &Field<'_>) -> Result<T> {
    Err(Error::UnknownField(format!(
        "{what}: unknown field {}",
        f.num
    )))
}

fn decode_coin(bytes: &[u8]) -> Result<Coin> {
    let mut coin = Coin {
        denom: String::new(),
        amount: String::new(),
    };
    for f in read_fields(bytes)? {
        match f.num {
            1 => coin.denom = as_string(&f, "Coin")?,
            2 => coin.amount = as_string(&f, "Coin")?,
            _ => return unknown_field("Coin", &f),
        }
    }
    Ok(coin)
}

fn coin_value(c: Coin) -> Value {
    serde_json::to_value(c).expect("coin serializes")
}

fn decode_io(bytes: &[u8]) -> Result<Value> {
    let mut address = String::new();
    let mut coins = Vec::new();
    for f in read_fields(bytes)? {
        match f.num {
            1 => address = as_string(&f, "Input/Output")?,
            2 => coins.push(coin_value(decode_coin(as_bytes(&f, "Input/Output")?)?)),
            _ => return unknown_field("Input/Output", &f),
        }
    }
    Ok(serde_json::json!({ "address": address, "coins": coins }))
}

fn default_for(kind: Kind) -> Value {
    match kind {
        Kind::Str | Kind::Bytes => Value::String(String::new()),
        Kind::Uint => Value::String("0".into()),
        Kind::Bool => Value::Bool(false),
        Kind::Coin => Value::Null,
        Kind::Coins | Kind::Strings | Kind::Io => Value::Array(Vec::new()),
    }
}

fn push(fields: &mut Map<String, Value>, name: &str, v: Value) {
    if let Some(Value::Array(a)) = fields.get_mut(name) {
        a.push(v);
    }
}

/// Decode one message. Unknown types come back with their bytes in hex.
pub fn decode_message(type_url: &str, value: &[u8]) -> Result<DecodedMessage> {
    let Some((_, layout)) = KNOWN_MESSAGES.iter().find(|(t, _)| *t == type_url) else {
        return Ok(DecodedMessage {
            type_url: type_url.to_string(),
            fields: None,
            value: Some(hex::encode(value)),
        });
    };
    let mut fields = Map::new();
    for (_, name, kind) in layout.iter() {
        fields.insert((*name).to_string(), default_for(*kind));
    }
    for f in read_fields(value)? {
        let Some((_, name, kind)) = layout.iter().find(|(n, _, _)| *n == f.num) else {
            return unknown_field(type_url, &f);
        };
        let name = *name;
        match kind {
            Kind::Str => {
                fields.insert(name.into(), Value::String(as_string(&f, type_url)?));
            }
            Kind::Bytes => {
                fields.insert(
                    name.into(),
                    Value::String(hex::encode(as_bytes(&f, type_url)?)),
                );
            }
            Kind::Uint => {
                fields.insert(
                    name.into(),
                    Value::String(as_uint(&f, type_url)?.to_string()),
                );
            }
            Kind::Bool => {
                fields.insert(name.into(), Value::Bool(as_uint(&f, type_url)? != 0));
            }
            Kind::Coin => {
                fields.insert(
                    name.into(),
                    coin_value(decode_coin(as_bytes(&f, type_url)?)?),
                );
            }
            Kind::Coins => push(
                &mut fields,
                name,
                coin_value(decode_coin(as_bytes(&f, type_url)?)?),
            ),
            Kind::Strings => push(&mut fields, name, Value::String(as_string(&f, type_url)?)),
            Kind::Io => push(&mut fields, name, decode_io(as_bytes(&f, type_url)?)?),
        }
    }
    Ok(DecodedMessage {
        type_url: type_url.to_string(),
        fields: Some(fields),
        value: None,
    })
}

fn decode_any<'a>(bytes: &'a [u8], what: &str) -> Result<(String, &'a [u8])> {
    let mut type_url = String::new();
    let mut value: &[u8] = &[];
    for f in read_fields(bytes)? {
        match f.num {
            1 => type_url = as_string(&f, what)?,
            2 => value = as_bytes(&f, what)?,
            _ => return unknown_field(what, &f),
        }
    }
    Ok((type_url, value))
}

fn decode_pqc_layer(bytes: &[u8]) -> Result<PqcLayerSummary> {
    let mut out = PqcLayerSummary {
        algorithm_id: 0,
        signature_length: 0,
        public_key_length: 0,
    };
    for f in read_fields(bytes)? {
        match f.num {
            1 => out.algorithm_id = as_uint(&f, "PQCHybridSignature")?,
            2 => out.signature_length = as_bytes(&f, "PQCHybridSignature")?.len(),
            3 => out.public_key_length = as_bytes(&f, "PQCHybridSignature")?.len(),
            _ => return unknown_field("PQCHybridSignature", &f),
        }
    }
    Ok(out)
}

const SINGLE_KEY_TYPES: [&str; 2] = [
    "/cosmos.crypto.secp256k1.PubKey",
    "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey",
];

fn decode_signer(bytes: &[u8]) -> Result<DecodedSigner> {
    let mut s = DecodedSigner {
        public_key_type: None,
        public_key: None,
        sequence: "0".into(),
        sign_mode: None,
    };
    for f in read_fields(bytes)? {
        match f.num {
            1 => {
                let (type_url, value) =
                    decode_any(as_bytes(&f, "SignerInfo")?, "SignerInfo.public_key")?;
                if SINGLE_KEY_TYPES.contains(&type_url.as_str()) {
                    for k in read_fields(value)? {
                        match k.num {
                            1 => s.public_key = Some(hex::encode(as_bytes(&k, "PubKey")?)),
                            _ => return unknown_field("PubKey", &k),
                        }
                    }
                }
                s.public_key_type = Some(type_url);
            }
            2 => {
                for m in read_fields(as_bytes(&f, "ModeInfo")?)? {
                    match m.num {
                        1 => {
                            s.sign_mode = Some(0);
                            for single in read_fields(as_bytes(&m, "ModeInfo.Single")?)? {
                                match single.num {
                                    1 => s.sign_mode = Some(as_uint(&single, "ModeInfo.Single")?),
                                    _ => return unknown_field("ModeInfo.Single", &single),
                                }
                            }
                        }
                        2 => {
                            expect_wire(&m, WIRE_LEN, "ModeInfo.Multi")?;
                            s.sign_mode = None;
                        }
                        _ => return unknown_field("ModeInfo", &m),
                    }
                }
            }
            3 => s.sequence = as_uint(&f, "SignerInfo")?.to_string(),
            _ => return unknown_field("SignerInfo", &f),
        }
    }
    Ok(s)
}

/// Decode a signed `TxRaw`. Errors are `MalformedTx` or `UnknownField`.
pub fn decode_tx(tx_bytes: &[u8]) -> Result<DecodedTx> {
    let mut body_bytes: Option<&[u8]> = None;
    let mut auth_info_bytes: Option<&[u8]> = None;
    let mut signature_count = 0;
    for f in read_fields(tx_bytes)? {
        match f.num {
            1 => body_bytes = Some(as_bytes(&f, "TxRaw")?),
            2 => auth_info_bytes = Some(as_bytes(&f, "TxRaw")?),
            3 => {
                as_bytes(&f, "TxRaw")?;
                signature_count += 1;
            }
            _ => return unknown_field("TxRaw", &f),
        }
    }
    let (Some(body_bytes), Some(auth_info_bytes)) = (body_bytes, auth_info_bytes) else {
        return Err(Error::MalformedTx(
            "TxRaw needs body_bytes and auth_info_bytes".into(),
        ));
    };

    let mut tx = DecodedTx {
        tx_hash: hex::encode_upper(Sha256::digest(tx_bytes)),
        messages: Vec::new(),
        memo: String::new(),
        timeout_height: "0".into(),
        unordered: false,
        timeout_timestamp_seconds: "0".into(),
        extension_options: Vec::new(),
        non_critical_extension_options: Vec::new(),
        pqc_layers: Vec::new(),
        signers: Vec::new(),
        fee: Fee {
            amount: Vec::new(),
            gas_limit: "0".into(),
            payer: String::new(),
            granter: String::new(),
        },
        signature_count,
    };

    for f in read_fields(body_bytes)? {
        match f.num {
            1 => {
                let (type_url, value) = decode_any(as_bytes(&f, "TxBody")?, "TxBody.messages")?;
                tx.messages.push(decode_message(&type_url, value)?);
            }
            2 => tx.memo = as_string(&f, "TxBody")?,
            3 => tx.timeout_height = as_uint(&f, "TxBody")?.to_string(),
            4 => tx.unordered = as_uint(&f, "TxBody")? != 0,
            5 => {
                for t in read_fields(as_bytes(&f, "TxBody")?)? {
                    match t.num {
                        1 => tx.timeout_timestamp_seconds = as_uint(&t, "Timestamp")?.to_string(),
                        2 => {
                            as_uint(&t, "Timestamp")?;
                        }
                        _ => return unknown_field("Timestamp", &t),
                    }
                }
            }
            1023 => {
                let (type_url, value) =
                    decode_any(as_bytes(&f, "TxBody")?, "TxBody.extension_options")?;
                if type_url == PQC_HYBRID_TYPE_URL {
                    tx.pqc_layers.push(decode_pqc_layer(value)?);
                }
                tx.extension_options.push(type_url);
            }
            2047 => {
                let (type_url, _) = decode_any(
                    as_bytes(&f, "TxBody")?,
                    "TxBody.non_critical_extension_options",
                )?;
                tx.non_critical_extension_options.push(type_url);
            }
            _ => return unknown_field("TxBody", &f),
        }
    }

    for f in read_fields(auth_info_bytes)? {
        match f.num {
            1 => tx.signers.push(decode_signer(as_bytes(&f, "AuthInfo")?)?),
            2 => {
                for g in read_fields(as_bytes(&f, "AuthInfo")?)? {
                    match g.num {
                        1 => tx.fee.amount.push(decode_coin(as_bytes(&g, "Fee")?)?),
                        2 => tx.fee.gas_limit = as_uint(&g, "Fee")?.to_string(),
                        3 => tx.fee.payer = as_string(&g, "Fee")?,
                        4 => tx.fee.granter = as_string(&g, "Fee")?,
                        _ => return unknown_field("Fee", &g),
                    }
                }
            }
            _ => return unknown_field("AuthInfo", &f),
        }
    }
    Ok(tx)
}
