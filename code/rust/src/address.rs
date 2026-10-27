// SPDX-License-Identifier: Apache-2.0
//
// Address validation for deposit and withdrawal forms.
//
// A QoreChain account has one 20-byte address with two spellings: bech32
// `qor1...` and hex `0x...` (EIP-55 checksummed). Validator operator
// addresses use the `qorvaloper1...` prefix over the same kind of 20 bytes.

use serde::Serialize;

use crate::bech32::{bech32_decode, bech32_encode};

pub const ACCOUNT_PREFIX: &str = "qor";
pub const VALIDATOR_PREFIX: &str = "qorvaloper";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AddressKind {
    Account,
    Validator,
}

/// Options of [`validate_address`].
#[derive(Clone, Debug)]
pub struct ValidateAddressOptions {
    /// Kinds to accept. Default: accounts only.
    pub allow: Vec<AddressKind>,
    /// Refuse a hex address that carries no EIP-55 checksum. Default false.
    pub require_eip55: bool,
}

impl Default for ValidateAddressOptions {
    fn default() -> Self {
        Self {
            allow: vec![AddressKind::Account],
            require_eip55: false,
        }
    }
}

/// Result of [`validate_address`]. Serializes to the shared JSON shape.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum AddressCheck {
    Valid {
        valid: bool,
        kind: AddressKind,
        /// `bech32` or `hex`: how the input was written.
        format: &'static str,
        /// `bech32`, `eip55`, or `none` for an unchecksummed hex input.
        checksum: &'static str,
        /// Canonical lowercase bech32 (`qor1...` or `qorvaloper1...`).
        bech32: String,
        /// EIP-55 hex form of the same 20 bytes.
        hex: String,
    },
    Invalid {
        valid: bool,
        /// Stable error code, e.g. `BAD_CHECKSUM`.
        error: &'static str,
        detail: String,
    },
}

impl AddressCheck {
    pub fn is_valid(&self) -> bool {
        matches!(self, AddressCheck::Valid { .. })
    }

    /// The error code, for an invalid address.
    pub fn error(&self) -> Option<&'static str> {
        match self {
            AddressCheck::Invalid { error, .. } => Some(error),
            AddressCheck::Valid { .. } => None,
        }
    }

    /// The canonical bech32 form, for a valid address.
    pub fn bech32(&self) -> Option<&str> {
        match self {
            AddressCheck::Valid { bech32, .. } => Some(bech32),
            AddressCheck::Invalid { .. } => None,
        }
    }
}

fn fail(error: &'static str, detail: impl Into<String>) -> AddressCheck {
    AddressCheck::Invalid {
        valid: false,
        error,
        detail: detail.into(),
    }
}

fn eip55(bytes: &[u8]) -> qoresign::AccountAddress {
    qoresign::address_from_bytes(bytes).expect("20 bytes")
}

/// Validate a `qor1...`, `qorvaloper1...` or `0x...` address.
///
/// Never panics or errors: an invalid input gives `AddressCheck::Invalid`
/// with a stable error code. Accounts only, unless `opts.allow` says otherwise.
pub fn validate_address(input: &str, opts: &ValidateAddressOptions) -> AddressCheck {
    if input.is_empty() {
        return fail("EMPTY", "the address is empty");
    }
    if input.trim() != input {
        return fail(
            "WHITESPACE",
            "the address has leading or trailing whitespace",
        );
    }

    if let Some(body) = input.strip_prefix("0x") {
        if body.len() != 40 || !body.bytes().all(|c| c.is_ascii_hexdigit()) {
            return fail("BAD_HEX", "a hex address is 0x followed by 40 hex digits");
        }
        let bytes = hex::decode(body).expect("checked hex");
        let canonical = eip55(&bytes);
        let mixed = body.bytes().any(|c| (b'a'..=b'f').contains(&c))
            && body.bytes().any(|c| (b'A'..=b'F').contains(&c));
        let checksum = if input == canonical.hex {
            "eip55"
        } else if mixed {
            return fail(
                "BAD_EIP55",
                "the EIP-55 checksum (letter case) does not match",
            );
        } else {
            "none"
        };
        if checksum == "none" && opts.require_eip55 {
            return fail("NO_CHECKSUM", "the hex address carries no EIP-55 checksum");
        }
        if !opts.allow.contains(&AddressKind::Account) {
            return fail("KIND_NOT_ALLOWED", "a hex address is an account address");
        }
        return AddressCheck::Valid {
            valid: true,
            kind: AddressKind::Account,
            format: "hex",
            checksum,
            bech32: canonical.bech32,
            hex: canonical.hex,
        };
    }

    let (hrp, bytes) = match bech32_decode(input) {
        Ok(v) => v,
        Err(e) => return fail(e.code, e.message),
    };
    let kind = match hrp.as_str() {
        ACCOUNT_PREFIX => AddressKind::Account,
        VALIDATOR_PREFIX => AddressKind::Validator,
        other => {
            return fail(
                "WRONG_PREFIX",
                format!(
                    "expected the \"{ACCOUNT_PREFIX}\" or \"{VALIDATOR_PREFIX}\" prefix, got \"{other}\""
                ),
            )
        }
    };
    if bytes.len() != 20 {
        return fail(
            "BAD_LENGTH",
            format!("addresses are 20 bytes, this one has {}", bytes.len()),
        );
    }
    if !opts.allow.contains(&kind) {
        return fail(
            "KIND_NOT_ALLOWED",
            "this kind of address is not accepted here",
        );
    }
    let canonical = eip55(&bytes);
    AddressCheck::Valid {
        valid: true,
        kind,
        format: "bech32",
        checksum: "bech32",
        bech32: match kind {
            AddressKind::Account => canonical.bech32,
            AddressKind::Validator => bech32_encode(VALIDATOR_PREFIX, &bytes),
        },
        hex: canonical.hex,
    }
}
