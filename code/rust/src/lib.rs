// SPDX-License-Identifier: Apache-2.0
//
// QoreChain custody kit, Rust port of the TypeScript reference. Built on the
// `qorechain-qoresign` crate. Every function here is checked against
// `vectors/custody-v1.json`, the same file the other languages use.

pub mod address;
pub mod bech32;
pub mod decode;
pub mod deposits;
pub mod errors;
pub mod proto;
pub mod verify;

pub use address::{
    validate_address, AddressCheck, AddressKind, ValidateAddressOptions, ACCOUNT_PREFIX,
    VALIDATOR_PREFIX,
};
pub use decode::{
    decode_message, decode_tx, Coin, DecodedMessage, DecodedSigner, DecodedTx, Fee,
    PqcLayerSummary, PQC_HYBRID_TYPE_URL,
};
pub use deposits::{
    build_deposit_query, deposit_event_query, extract_deposits, percent_encode, DepositEntry,
    DepositEvent, DepositQueryOptions, OrderBy, FEE_COLLECTOR, MSG_ETHEREUM_TX, MSG_MULTI_SEND,
    MSG_SEND,
};
pub use errors::{Error, Result};
pub use verify::{verify_tx, PqOutcome, VerifyTxArgs, VerifyTxResult};

/// Default REST endpoint for the examples and the live checks (the testnet).
pub const DEFAULT_TESTNET_REST: &str = "https://api-testnet.qore.host";
