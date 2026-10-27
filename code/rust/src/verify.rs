// SPDX-License-Identifier: Apache-2.0
//
// Verify a signed native-lane transaction before it is broadcast: the
// secp256k1 signature, the ML-DSA-87 layer against the account's registered
// key, and that the signer recorded in the transaction is the expected key.

use serde::Serialize;

use qoresign::{verify_hybrid_tx, ClassicalKeyType, VerifyHybridTxArgs, VerifyVersion};

use crate::decode::decode_tx;
use crate::errors::{Error, Result};

/// Input of [`verify_tx`].
#[derive(Clone, Copy, Debug)]
pub struct VerifyTxArgs<'a> {
    /// Encoded `TxRaw`.
    pub tx_bytes: &'a [u8],
    pub chain_id: &'a str,
    /// From `/cosmos/auth/v1beta1/account_info/{address}`.
    pub account_number: u64,
    /// The signer's 33-byte compressed secp256k1 public key.
    pub classical_public_key: &'a [u8],
    /// `Secp256k1` (coin type 118 accounts) or `EthSecp256k1` (eth-native accounts).
    pub classical_key_type: ClassicalKeyType,
    /// The ML-DSA-87 key registered for the account; `None` checks the classical signature only.
    pub pq_public_key: Option<&'a [u8]>,
    /// Sign-bytes version of the ML-DSA-87 layer. `V2` is what both public networks verify.
    pub version: VerifyVersion,
}

impl<'a> VerifyTxArgs<'a> {
    /// Defaults: `Secp256k1`, v2 sign-bytes.
    pub fn new(
        tx_bytes: &'a [u8],
        chain_id: &'a str,
        account_number: u64,
        classical_public_key: &'a [u8],
        pq_public_key: Option<&'a [u8]>,
    ) -> Self {
        Self {
            tx_bytes,
            chain_id,
            account_number,
            classical_public_key,
            classical_key_type: ClassicalKeyType::Secp256k1,
            pq_public_key,
            version: VerifyVersion::V2,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PqOutcome {
    pub valid: bool,
    pub sign_bytes_version: Option<String>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyTxResult {
    /// True when every check that was asked for passed.
    pub valid: bool,
    pub classical: bool,
    /// `match`, `absent` (no public key in the transaction) or `mismatch`.
    pub signer_key: &'static str,
    /// `None` when no ML-DSA-87 key was given.
    pub pq: Option<PqOutcome>,
}

/// Verify a single-signer transaction. Errors on malformed input, never on a bad signature.
pub fn verify_tx(args: &VerifyTxArgs<'_>) -> Result<VerifyTxResult> {
    let decoded = decode_tx(args.tx_bytes)?;
    let signer_key = if decoded.signers.len() != 1 {
        "mismatch"
    } else {
        match &decoded.signers[0].public_key {
            Some(k) if *k == hex::encode(args.classical_public_key) => "match",
            Some(_) => "mismatch",
            None => "absent",
        }
    };
    let r = verify_hybrid_tx(&VerifyHybridTxArgs {
        tx_bytes: args.tx_bytes,
        chain_id: args.chain_id,
        account_number: args.account_number,
        classical_public_key: args.classical_public_key,
        classical_key_type: args.classical_key_type,
        pq_public_key: args.pq_public_key,
        version: args.version,
    })
    .map_err(|e| Error::InvalidArgument(e.to_string()))?;
    let pq = r.pq.map(|p| PqOutcome {
        valid: p.valid,
        sign_bytes_version: p.sign_bytes_version.map(|v| v.as_str().to_string()),
        reason: p.reason.map(|x| x.as_str().to_string()),
    });
    Ok(VerifyTxResult {
        valid: r.valid && signer_key != "mismatch",
        classical: r.classical,
        signer_key,
        pq,
    })
}
