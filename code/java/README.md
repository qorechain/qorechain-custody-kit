# Custody kit: Java

Java 17 examples of the kit's helpers, built on QoreSign for the JVM
(`io.github.qorechain:qoresign:0.1.0`) and Gson. Not published: copy what you need.

| Class | What it does |
|---|---|
| `Addresses.validateAddress` | `qor1...`, `qorvaloper1...` and `0x...` addresses, bech32 and EIP-55 checksums, stable error codes |
| `TxDecoder.decodeTx`, `decodeMessage` | decode a signed `TxRaw`: messages, fee, signer, ML-DSA-87 layer, transaction hash |
| `TxVerifier.verifyTx` | secp256k1 signature, ML-DSA-87 layer against the registered key, signer key check |
| `Deposits.buildDepositQuery`, `extractDeposits` | REST query for incoming transfers, and a credit decision per transfer |
| `CustodyKit` | one entry point over the above |
| `Cli` | example command line |

Results convert to JSON (`toJson()`, or Gson objects for the decoder) with the same shape as the
other languages of the kit.

## Build and test

```bash
mvn test                                  # vectors/custody-v1.json
../../scripts/fetch-qoresign-vectors.sh   # optional: also check vectors/qoresign-v1.json
QORE_LIVE_TEST=1 mvn test                 # read-only checks against the testnet
```

`QORE_REST` points the live checks and the CLI at another REST endpoint, for example your own
node. Tests use TestNG.

## Command line

```bash
mvn -q compile exec:java -Dexec.args="validate 0x9858EfFD232B4033E47d90003D41EC34EcaEda94"
mvn -q exec:java -Dexec.args="decode <tx hex or base64>"
mvn -q exec:java -Dexec.args="verify <tx> --chain-id qorechain-diana --account-number 7 --pubkey <hex> --pq-pubkey <hex>"
mvn -q exec:java -Dexec.args="deposits qor1... --from-height 100 --to-height 200"
```

## Notes

- QoreSign's Kotlin `verifyHybridTx` takes the account number as an unsigned `ULong`, so the
  JVM method has a compiler-generated name. `TxVerifier` finds it once by name prefix and
  parameter types; the account number is passed as a `long` holding the unsigned value.
- QoreSign loads a native library through JNA. On JDK 22 and later the JVM prints a warning
  about native access; add `--enable-native-access=ALL-UNNAMED` to silence it.

## Dependencies

| Artifact | Version | Licence |
|---|---|---|
| `io.github.qorechain:qoresign` | 0.1.0 | Apache-2.0 |
| `net.java.dev.jna:jna` (via qoresign) | 5.19.1 | Apache-2.0 (dual-licensed with LGPL-2.1, used under Apache-2.0) |
| `org.jetbrains.kotlin:kotlin-stdlib` (via qoresign) | 2.4.21 | Apache-2.0 |
| `org.jetbrains:annotations` (via kotlin-stdlib) | 13.0 | Apache-2.0 |
| `com.google.code.gson:gson` | 2.14.0 | Apache-2.0 |
| `com.google.errorprone:error_prone_annotations` (via gson) | 2.48.0 | Apache-2.0 |
| `org.testng:testng` (tests) | 7.12.0 | Apache-2.0 |
| `org.jcommander:jcommander` (tests) | 1.83 | Apache-2.0 |
| `org.slf4j:slf4j-api` (tests) | 2.0.16 | MIT |
| `org.webjars:jquery` (tests, TestNG reports) | 3.7.1 | MIT |
