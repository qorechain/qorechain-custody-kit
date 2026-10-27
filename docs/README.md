<!-- SPDX-License-Identifier: Apache-2.0 -->
# Documentation

| Page | Contents |
|---|---|
| [Signing, per lane](signing.md) | native lane: `SignDoc` DIRECT plus the ML-DSA-87 layer, sign-bytes v1/v2, sizes, registration; EVM lane: EIP-155/1559 inside authorization windows; SVM: not open |
| [Addresses and derivation](addresses.md) | `qor1`, `0x`, `qorvaloper`; coin types 118 and 60; canonical and HD ML-DSA-87 derivation; checksums |
| [Deposit detection](deposits.md) | events and queries, finality, the credit rules, EVM traps |
| [Withdrawals](withdrawals.md) | build, simulate, sign, verify, broadcast; the gas rules before and after v3.2.5; fees |
| [Staking](staking.md) | delegate, undelegate, redelegate, rewards; staking tier lock, unlock, bonus |
| [Errors](errors.md) | refusal codes by module, and where the SDK decodes them |
| [Key management](key-management.md) | HSM, software and threshold setups for ML-DSA-87; rotation; backups |
| [Test environment](testnet.md) | endpoints, differences from mainnet, a rehearsal |
| [Integration checklist](checklist.md) | what an integration needs before mainnet |
| [FAQ](faq.md) | short answers |

Values on these pages were read from both public networks on 27 October 2026. Parameters can change by governance: read them from the chain in production.
