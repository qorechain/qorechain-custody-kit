<!-- SPDX-License-Identifier: Apache-2.0 -->
# Addresses and key derivation

## Formats

| Form | Example | Used for |
|---|---|---|
| bech32 `qor1…` | `qor19rl4cm2hmr8afy4kldpxz3fka4jguq0agt672h` | accounts on the native lane, REST queries, events |
| hex `0x…` (EIP-55) | `0x28Ff5c6d57D8cFD492B6FB42614536eD648E01Fd` | the same account on the EVM lane |
| bech32 `qorvaloper1…` | `qorvaloper19rl4cm2hmr8afy4kldpxz3fka4jguq0a5ws5he` | validator operators (staking only, never a payment address) |

The two examples above are the **same 20 bytes**: `qor1…` and `0x…` are two spellings of one account, and funds sent to either arrive in the same balance. Convert by decoding one form to its 20 bytes and encoding the other. The public test keys above come from the BIP-39 test mnemonic and must never hold funds.

Rules:

- Bech32 uses the original BIP-173 checksum (not bech32m). An address is all lowercase or all uppercase; mixed case is invalid. Events and REST responses always use lowercase, so normalise before comparing.
- Account and validator addresses are 20 bytes. Module and contract accounts can be longer; the kit's `validateAddress` refuses anything but 20 bytes, which is what a deposit or payout address should be.
- Hex addresses: a mixed-case address must match its EIP-55 checksum. All-lowercase or all-uppercase input carries no checksum; `validateAddress` reports `checksum: "none"` and refuses it with `requireEip55: true`. Ask users for checksummed input where you can.
- Never accept a `qorvaloper` address as a withdrawal destination: it is not an account form. `validateAddress` accepts validators only when `allow` includes them.

Error codes of `validateAddress` (identical in every language of the kit): `EMPTY`, `WHITESPACE`, `BAD_HEX`, `BAD_EIP55`, `NO_CHECKSUM`, `MIXED_CASE`, `BAD_BECH32`, `BAD_CHECKSUM`, `WRONG_PREFIX`, `BAD_LENGTH`, `KIND_NOT_ALLOWED`. The vectors list a good and a bad case for each.

## Two kinds of account

| | `secp256k1` accounts | eth-native (`eth_secp256k1`) accounts |
|---|---|---|
| HD path (BIP-44) | `m/44'/118'/0'/0/i` (coin type 118) | `m/44'/60'/0'/0/i` (coin type 60) |
| Address | RIPEMD-160(SHA-256(compressed public key)) | last 20 bytes of KECCAK-256(uncompressed public key) |
| `AuthInfo` public key type | `/cosmos.crypto.secp256k1.PubKey` | `/cosmos.evm.crypto.v1.ethsecp256k1.PubKey` |
| `SignDoc` hash | SHA-256 | KECCAK-256 |
| Same key controls the `0x` form on the EVM lane | no: the `0x` spelling of the address exists, but an Ethereum signature from this key recovers a different address | yes |

The same mnemonic gives two different accounts under the two paths. A custodian that wants one key to operate both the native lane and the EVM lane uses eth-native accounts. Pick one convention per wallet and record it with the key; QoreSign's `classicalKeyTypeFor(publicKey, address)` tells you which one a given key and address use.

Both networks use the bech32 prefix `qor`, and the native denomination `uqor` (1 QOR = 10^6 uqor; on the EVM lane 1 QOR = 10^18 wei, so 1 uqor = 10^12 wei).

## The ML-DSA-87 key

Each account that signs on the native lane (or opens EVM windows) needs one registered ML-DSA-87 key. Any valid key works; the network only checks the signature against the registered key. Three ways to obtain one, from the [QoreSign derivation spec](https://github.com/qorechain/qoresign/blob/v0.1.0/spec/hd-derivation-draft.md):

1. **Canonical derivation (stable).** What QoreChain wallets and the QoreChain SDK register:

   ```
   seed = SHAKE256( UTF-8( "qorechain:pqc:v1|" + qor1_address + "|" + mnemonic ), 32 bytes )
   (pk, sk) = ML-DSA-87.KeyGen_internal(seed)
   ```

   The mnemonic must be in canonical form (lowercase English words, single spaces); implementations refuse other spellings rather than normalise them. The key is bound to the address. Use it when the custody system holds BIP-39 mnemonics.

2. **Hierarchical derivation (draft).** SLIP-0010 style, hardened segments only, master key string `qorechain-mldsa87-seed`, default path `m/44'/118'/{account}'/0'/0'`. It may change before it is final.

3. **A random key** generated inside an HSM or a key manager (`KeyGen` from 32 random bytes). This is the natural choice for hardware: it does not depend on a mnemonic. Back it up the way your HSM backs up keys.

Whatever the origin, the key must be registered for the account (`MsgRegisterPQCKeyV2`) before the account can send. A key whose `t1` part is all zero is refused (code 230), as it offers no protection.

## Checksums at a glance

| Input | Check |
|---|---|
| `qor1…`, `qorvaloper1…` | bech32 (BIP-173) polymod, 6 characters |
| `0x…` mixed case | EIP-55 (KECCAK-256 of the lowercase hex) |
| `0x…` single case | none |
| transaction hash | uppercase hex SHA-256 of the `TxRaw` bytes (native lane); EVM transactions also have an Ethereum hash, reported in the `ethereum_tx` event |
