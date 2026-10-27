<!-- SPDX-License-Identifier: Apache-2.0 -->
# Changelog

All notable changes are listed here.

## [0.1.0] - Unreleased

### Added

- Integration guide: signing per lane, addresses and derivation, deposit detection, withdrawals and gas rules, staking and staking tiers, errors, key management, test environment, checklist, FAQ.
- Reference code in TypeScript, Python, Go, Rust and Java: `validateAddress`, `decodeTx`, `verifyTx` (over QoreSign; in Python it requires `qorechain-qoresign` 0.1.1), `buildDepositQuery` and `extractDeposits`, and a command-line example per language.
- Test vectors `vectors/custody-v1.json` (addresses, a hybrid-signed delegation, a hybrid-signed EVM window opening, staking and window messages, malformed transactions, deposit queries and deposit extraction), and the QoreSign v0.1.0 vectors by reference.
- Read-only live checks against the testnet (`QORE_LIVE_TEST=1`).
