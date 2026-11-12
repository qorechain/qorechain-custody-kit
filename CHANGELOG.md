<!-- SPDX-License-Identifier: Apache-2.0 -->
# Changelog

All notable changes are listed here.

## [0.1.1] - 2026-11-12

### Changed

- `decodeTx` in every language reads `MsgOpenEVMWindow` fields 5 to 9
  (`native_only`, `allowed_targets`, and from chain v3.2.8 `validators`,
  `staking_validators`, `ibc_receivers`) instead of refusing them as unknown.
  Any other unknown field is still refused.
- The guide covers the chain v3.2.8 window rules: standard precompile methods
  need a list that admits them (`staking_validators` for delegate and
  redelegate, `ibc_receivers` for ICS-20), and rotating, migrating or
  re-registering the PQC key closes the window and EIP-7702 consent.
- Test vectors add a window message with fields 5 to 9 and a malformed one with
  an unknown field.

## [0.1.0] - 2026-10-27

### Added

- Integration guide: signing per lane, addresses and derivation, deposit detection, withdrawals and gas rules, staking and staking tiers, errors, key management, test environment, checklist, FAQ.
- Reference code in TypeScript, Python, Go, Rust and Java: `validateAddress`, `decodeTx`, `verifyTx` (over QoreSign; in Python it requires `qorechain-qoresign` 0.1.1), `buildDepositQuery` and `extractDeposits`, and a command-line example per language.
- Test vectors `vectors/custody-v1.json` (addresses, a hybrid-signed delegation, a hybrid-signed EVM window opening, staking and window messages, malformed transactions, deposit queries and deposit extraction), and the QoreSign v0.1.0 vectors by reference.
- Read-only live checks against the testnet (`QORE_LIVE_TEST=1`).
