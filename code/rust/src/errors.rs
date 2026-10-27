// SPDX-License-Identifier: Apache-2.0

use std::fmt;

/// Errors with the stable codes shared by every language of the kit.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Error {
    /// The bytes are not a well-formed transaction.
    MalformedTx(String),
    /// A field the decoder does not know, in a structure it decodes strictly.
    UnknownField(String),
    /// A caller error (bad option, bad address for a query, bad key).
    InvalidArgument(String),
}

impl Error {
    /// `MALFORMED_TX`, `UNKNOWN_FIELD` or `INVALID_ARGUMENT`.
    pub fn code(&self) -> &'static str {
        match self {
            Error::MalformedTx(_) => "MALFORMED_TX",
            Error::UnknownField(_) => "UNKNOWN_FIELD",
            Error::InvalidArgument(_) => "INVALID_ARGUMENT",
        }
    }

    fn detail(&self) -> &str {
        match self {
            Error::MalformedTx(s) | Error::UnknownField(s) | Error::InvalidArgument(s) => s,
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code(), self.detail())
    }
}

impl std::error::Error for Error {}

pub type Result<T> = std::result::Result<T, Error>;
