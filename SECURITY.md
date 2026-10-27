# Security Policy

The custody kit documents how funds move on QoreChain and ships code that checks signed transactions, so we treat security reports for it with priority. That includes documentation errors that could lead an integrator to credit a deposit wrongly or to sign something they did not intend.

## Reporting a vulnerability

Please **do not** report vulnerabilities through public issues, discussions or pull requests. Email:

**security@qore.network**

Include, as far as you can: a description and the impact, steps to reproduce or a proof of concept, the affected page or language (TypeScript, Python, Go, Rust, Java), and a suggested fix.

Qualifying reports are eligible for the QoreChain bug bounty; scope and rules are published at <https://www.qorechain.io/security>.

## What to expect

- We acknowledge your report and keep you informed while we investigate.
- We coordinate disclosure with you once a fix is released.

## Supported versions

Fixes go into the `main` branch.

## Cryptography

The kit implements no signature scheme. ML-DSA-87 and secp256k1 verification come from [QoreSign](https://github.com/qorechain/qoresign) and the libraries it builds on. The Python code contains a small Keccak-256 used only for the EIP-55 address checksum. Issues in QoreSign or its libraries should also be reported there.
