// SPDX-License-Identifier: Apache-2.0
//
// Regenerates vectors/custody-v1.json. Transactions are hand-encoded here and
// signed with @qorechain/qoresign; the expected decodings are written from the
// inputs, not from the decoder under test. Every language checks this file.
//
// Run from code/ts after `pnpm build`: node scripts/gen-vectors.mjs

import { writeFileSync } from "node:fs";
import { sha256 } from "@noble/hashes/sha2.js";
import * as qs from "@qorechain/qoresign";

import { bech32Encode } from "../dist/src/bech32.js";

const MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const CHAIN_ID = "qorechain-diana";
const QORESIGN_VECTORS = {
  url: "https://raw.githubusercontent.com/qorechain/qoresign/v0.1.0/vectors/qoresign-v1.json",
  sha256: "bf920288d234204bb77c51b59aec0b3a6c9ce5735cef247a18629b4912186f7c",
};
const hex = qs.toHex;
const enc = (s) => new TextEncoder().encode(s);
const cat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));

// ---- protobuf encoding -------------------------------------------------
function varint(v) {
  let n = BigInt(v);
  const out = [];
  do {
    let b = Number(n & 0x7fn);
    n >>= 7n;
    if (n) b |= 0x80;
    out.push(b);
  } while (n);
  return Uint8Array.from(out);
}
const tag = (num, wire) => varint((BigInt(num) << 3n) | BigInt(wire));
const lenField = (num, payload) => cat(tag(num, 2), varint(payload.length), payload);
const str = (num, s) => (s === "" ? new Uint8Array() : lenField(num, enc(s)));
const uint = (num, v) => (BigInt(v) === 0n ? new Uint8Array() : cat(tag(num, 0), varint(v)));
const bool = (num, v) => (v ? cat(tag(num, 0), varint(1)) : new Uint8Array());
const coin = (denom, amount) => cat(str(1, denom), str(2, amount));
const any = (typeUrl, value) => cat(str(1, typeUrl), lenField(2, value));

function txBody(messages, memo) {
  return cat(...messages.map((m) => lenField(1, any(m.typeUrl, m.value))), str(2, memo));
}
function authInfo({ pubkeyType, pubkey, sequence, feeAmount, gasLimit }) {
  const pkAny = any(pubkeyType, lenField(1, pubkey));
  const modeInfo = lenField(1, uint(1, 1)); // single { mode: SIGN_MODE_DIRECT }
  const signerInfo = cat(lenField(1, pkAny), lenField(2, modeInfo), uint(3, sequence));
  const fee = cat(lenField(1, coin("uqor", feeAmount)), uint(2, gasLimit));
  return cat(lenField(1, signerInfo), lenField(2, fee));
}

// ---- keys ----------------------------------------------------------------
const classical = qs.deriveClassicalKey({ mnemonic: MNEMONIC });
const eth = qs.deriveClassicalKey({ mnemonic: MNEMONIC, type: "eth_secp256k1" });
const addr = qs.addressFromPublicKey(classical.publicKey, "secp256k1");
const ethAddr = qs.addressFromPublicKey(eth.publicKey, "eth_secp256k1");
const pq = qs.deriveCanonicalPqKey({ mnemonic: MNEMONIC, address: addr.bech32 });
const ethPq = qs.deriveCanonicalPqKey({ mnemonic: MNEMONIC, address: ethAddr.bech32 });
const valoper = bech32Encode("qorvaloper", addr.bytes);
const valoper2 = bech32Encode("qorvaloper", ethAddr.bytes);
const moduleAddress = (name) => bech32Encode("qor", sha256(enc(name)).subarray(0, 20));
const FEE_COLLECTOR = moduleAddress("fee_collector");
const EVM_MODULE = moduleAddress("evm");
const DISTRIBUTION = moduleAddress("distribution");

// ---- addresses -----------------------------------------------------------
const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(values) {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i];
  }
  return chk >>> 0;
}
/** Bech32 string from raw 5-bit words, with the bech32 (1) or bech32m (0x2bc830a3) constant. */
function fromWords(hrp, words, constant = 1) {
  const exp = [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];
  const mod = polymod([...exp, ...words, 0, 0, 0, 0, 0, 0]) ^ constant;
  const check = [0, 1, 2, 3, 4, 5].map((i) => (mod >>> (5 * (5 - i))) & 31);
  return `${hrp}1${[...words, ...check].map((w) => CHARSET[w]).join("")}`;
}
function toWords(bytes) {
  const words = [];
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >> bits) & 31);
    }
    acc &= (1 << bits) - 1;
  }
  if (bits) words.push((acc << (5 - bits)) & 31);
  return words;
}

const hexLower = ethAddr.hex.toLowerCase();
function flipLastLetterCase(s) {
  for (let i = s.length - 1; i >= 2; i--) {
    const c = s[i];
    if (/[a-fA-F]/.test(c)) return s.slice(0, i) + (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()) + s.slice(i + 1);
  }
  throw new Error("no letter to flip");
}
const addresses = {
  valid: [
    { input: addr.bech32, expected: { kind: "account", format: "bech32", checksum: "bech32", bech32: addr.bech32, hex: addr.hex } },
    { input: addr.hex, expected: { kind: "account", format: "hex", checksum: "eip55", bech32: addr.bech32, hex: addr.hex } },
    { input: ethAddr.bech32, expected: { kind: "account", format: "bech32", checksum: "bech32", bech32: ethAddr.bech32, hex: ethAddr.hex } },
    { input: ethAddr.hex, expected: { kind: "account", format: "hex", checksum: "eip55", bech32: ethAddr.bech32, hex: ethAddr.hex } },
    { input: hexLower, expected: { kind: "account", format: "hex", checksum: "none", bech32: ethAddr.bech32, hex: ethAddr.hex } },
    {
      input: "0x" + hexLower.slice(2).toUpperCase(),
      expected: { kind: "account", format: "hex", checksum: "none", bech32: ethAddr.bech32, hex: ethAddr.hex },
    },
    {
      input: addr.bech32.toUpperCase(),
      expected: { kind: "account", format: "bech32", checksum: "bech32", bech32: addr.bech32, hex: addr.hex },
    },
    {
      input: "0x1111111111111111111111111111111111111111",
      expected: {
        kind: "account",
        format: "hex",
        checksum: "eip55",
        bech32: qs.addressFromBytes(new Uint8Array(20).fill(0x11)).bech32,
        hex: "0x1111111111111111111111111111111111111111",
      },
    },
    {
      input: valoper,
      allow: ["account", "validator"],
      expected: { kind: "validator", format: "bech32", checksum: "bech32", bech32: valoper, hex: addr.hex },
    },
    {
      input: FEE_COLLECTOR,
      expected: {
        kind: "account",
        format: "bech32",
        checksum: "bech32",
        bech32: FEE_COLLECTOR,
        hex: qs.parseAddress(FEE_COLLECTOR).hex,
      },
    },
  ],
  invalid: [
    { input: "", error: "EMPTY" },
    { input: ` ${addr.bech32}`, error: "WHITESPACE" },
    { input: `${addr.bech32}\n`, error: "WHITESPACE" },
    { input: flipLastLetterCase(ethAddr.hex), error: "BAD_EIP55" },
    { input: hexLower.slice(0, -1), error: "BAD_HEX" },
    { input: "0x" + "zz".repeat(20), error: "BAD_HEX" },
    { input: hexLower, requireEip55: true, error: "NO_CHECKSUM" },
    { input: addr.bech32.slice(0, 6) + addr.bech32.slice(6, 10).toUpperCase() + addr.bech32.slice(10), error: "MIXED_CASE" },
    { input: addr.bech32.slice(0, -1) + (addr.bech32.endsWith("j") ? "k" : "j"), error: "BAD_CHECKSUM" },
    { input: fromWords("qor", toWords(addr.bytes), 0x2bc830a3), error: "BAD_CHECKSUM" },
    { input: addr.bech32.slice(0, 8) + "b" + addr.bech32.slice(9), error: "BAD_BECH32" },
    { input: "qor1qqqq", error: "BAD_BECH32" },
    { input: `${addr.bech32}qq`, error: "BAD_CHECKSUM" },
    { input: fromWords("qor", [...toWords(addr.bytes), 0]), error: "BAD_BECH32" },
    { input: bech32Encode("cosmos", addr.bytes), error: "WRONG_PREFIX" },
    { input: bech32Encode("qor", new Uint8Array(32).fill(7)), error: "BAD_LENGTH" },
    { input: valoper, error: "KIND_NOT_ALLOWED" },
    { input: addr.hex, allow: ["validator"], error: "KIND_NOT_ALLOWED" },
    { input: hexLower + "00", error: "BAD_HEX" },
  ],
};

// ---- transactions ----------------------------------------------------------
const msgDelegate = (delegator, validator, amount) =>
  cat(str(1, delegator), str(2, validator), lenField(3, coin("uqor", amount)));
const msgOpenWindow = (w) =>
  cat(
    str(1, w.sender),
    uint(2, w.blocks),
    uint(3, w.max_txs),
    str(4, w.max_value),
    bool(5, w.native_only),
    ...w.allowed_targets.map((t) => str(6, t)),
  );

function signedTx({ name, key, keyType, pubkeyType, pqKey, accountNumber, sequence, message, memo, fields, fee, gas }) {
  const bodyBytes = txBody([message], memo);
  const authInfoBytes = authInfo({ pubkeyType, pubkey: key.publicKey, sequence, feeAmount: fee, gasLimit: gas });
  const signed = qs.signHybrid({
    chainId: CHAIN_ID,
    accountNumber,
    bodyBytes,
    authInfoBytes,
    classicalKey: key,
    pqKey,
    signBytesVersion: "v2",
  });
  const ok = { valid: true, classical: true, signerKey: "match", pq: { valid: true, signBytesVersion: "v2", reason: null } };
  return {
    name,
    chainId: CHAIN_ID,
    accountNumber,
    classicalKeyType: keyType,
    classicalPublicKey: hex(key.publicKey),
    pqPublicKey: hex(pqKey.publicKey),
    txBytes: hex(signed.txBytes),
    decoded: {
      txHash: hex(sha256(signed.txBytes)).toUpperCase(),
      messages: [{ typeUrl: message.typeUrl, fields, value: null }],
      memo,
      timeoutHeight: "0",
      unordered: false,
      timeoutTimestampSeconds: "0",
      extensionOptions: ["/qorechain.pqc.v1.PQCHybridSignature"],
      nonCriticalExtensionOptions: [],
      pqcLayers: [{ algorithmId: 1, signatureLength: 4627, publicKeyLength: 0 }],
      signers: [{ publicKeyType: pubkeyType, publicKey: hex(key.publicKey), sequence: String(sequence), signMode: 1 }],
      fee: { amount: [{ denom: "uqor", amount: fee }], gasLimit: String(gas), payer: "", granter: "" },
      signatureCount: 1,
    },
    verifyCases: [
      { description: "registered key, v2", expected: ok },
      { description: "classical signature only", omitPqPublicKey: true, expected: { valid: true, classical: true, signerKey: "match", pq: null } },
      {
        description: "another account's ML-DSA-87 key",
        pqPublicKey: hex((pqKey === pq ? ethPq : pq).publicKey),
        expected: { ...ok, valid: false, pq: { valid: false, signBytesVersion: null, reason: "invalid_signature" } },
      },
      {
        description: "wrong account number",
        accountNumber: accountNumber + 1,
        expected: { ...ok, valid: false, classical: false },
      },
      {
        description: "wrong chain id",
        chainId: "qorechain-vladi",
        expected: { valid: false, classical: false, signerKey: "match", pq: { valid: false, signBytesVersion: null, reason: "invalid_signature" } },
      },
      {
        description: "a different classical key",
        classicalPublicKey: hex((key === classical ? eth : classical).publicKey),
        classicalKeyType: key === classical ? "eth_secp256k1" : "secp256k1",
        expected: { ...ok, valid: false, classical: false, signerKey: "mismatch" },
      },
    ],
  };
}

const delegateFields = {
  delegator_address: addr.bech32,
  validator_address: valoper,
  amount: { denom: "uqor", amount: "1000000" },
};
const windowFields = {
  sender: ethAddr.bech32,
  blocks: "600",
  max_txs: "5",
  max_value: "5000000",
  native_only: true,
  allowed_targets: [],
};
const transactions = [
  signedTx({
    name: "delegate",
    key: classical,
    keyType: "secp256k1",
    pubkeyType: "/cosmos.crypto.secp256k1.PubKey",
    pqKey: pq,
    accountNumber: 7,
    sequence: 5,
    message: {
      typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
      value: msgDelegate(addr.bech32, valoper, "1000000"),
    },
    memo: "custody-kit vector: delegate",
    fields: delegateFields,
    fee: "40000",
    gas: 400000,
  }),
  signedTx({
    name: "evm-window-open",
    key: eth,
    keyType: "eth_secp256k1",
    pubkeyType: "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey",
    pqKey: ethPq,
    accountNumber: 8,
    sequence: 0,
    message: { typeUrl: "/qorechain.pqc.v1.MsgOpenEVMWindow", value: msgOpenWindow(windowFields) },
    memo: "",
    fields: windowFields,
    fee: "40000",
    gas: 400000,
  }),
];

// ---- single messages ---------------------------------------------------------
const io = (address, coins) => cat(str(1, address), ...coins.map(([d, a]) => lenField(2, coin(d, a))));
const targetWindow = {
  sender: ethAddr.bech32,
  blocks: "17280",
  max_txs: "1000",
  max_value: "1",
  native_only: false,
  allowed_targets: ["0x000000000000000000000000000000000000dEaD", ethAddr.hex],
};
const messages = [
  { typeUrl: "/qorechain.pqc.v1.MsgOpenEVMWindow", bytes: msgOpenWindow(targetWindow), fields: targetWindow },
  { typeUrl: "/qorechain.pqc.v1.MsgCloseEVMWindow", bytes: str(1, ethAddr.bech32), fields: { sender: ethAddr.bech32 } },
  {
    typeUrl: "/cosmos.staking.v1beta1.MsgUndelegate",
    bytes: msgDelegate(addr.bech32, valoper, "250000"),
    fields: { delegator_address: addr.bech32, validator_address: valoper, amount: { denom: "uqor", amount: "250000" } },
  },
  {
    typeUrl: "/cosmos.staking.v1beta1.MsgBeginRedelegate",
    bytes: cat(str(1, addr.bech32), str(2, valoper), str(3, valoper2), lenField(4, coin("uqor", "500000"))),
    fields: {
      delegator_address: addr.bech32,
      validator_src_address: valoper,
      validator_dst_address: valoper2,
      amount: { denom: "uqor", amount: "500000" },
    },
  },
  {
    typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
    bytes: cat(str(1, addr.bech32), str(2, valoper)),
    fields: { delegator_address: addr.bech32, validator_address: valoper },
  },
  {
    typeUrl: "/cosmos.distribution.v1beta1.MsgSetWithdrawAddress",
    bytes: cat(str(1, addr.bech32), str(2, ethAddr.bech32)),
    fields: { delegator_address: addr.bech32, withdraw_address: ethAddr.bech32 },
  },
  {
    typeUrl: "/qorechain.stakingtier.v1.MsgLockDelegation",
    bytes: cat(str(1, addr.bech32), str(2, valoper), str(3, "10000000"), uint(4, 6)),
    fields: { delegator: addr.bech32, validator: valoper, amount: "10000000", months: "6" },
  },
  {
    typeUrl: "/qorechain.stakingtier.v1.MsgUnlockEarly",
    bytes: cat(str(1, addr.bech32), uint(2, 3)),
    fields: { delegator: addr.bech32, lock_id: "3" },
  },
  {
    typeUrl: "/qorechain.stakingtier.v1.MsgClaimBonus",
    bytes: str(1, addr.bech32),
    fields: { holder: addr.bech32 },
  },
  {
    typeUrl: "/cosmos.bank.v1beta1.MsgMultiSend",
    bytes: cat(
      lenField(1, io(addr.bech32, [["uqor", "3"]])),
      lenField(2, io(ethAddr.bech32, [["uqor", "1"]])),
      lenField(2, io(FEE_COLLECTOR, [["uqor", "2"]])),
    ),
    fields: {
      inputs: [{ address: addr.bech32, coins: [{ denom: "uqor", amount: "3" }] }],
      outputs: [
        { address: ethAddr.bech32, coins: [{ denom: "uqor", amount: "1" }] },
        { address: FEE_COLLECTOR, coins: [{ denom: "uqor", amount: "2" }] },
      ],
    },
  },
  {
    typeUrl: "/cosmos.bank.v1beta1.MsgSend",
    bytes: cat(str(1, addr.bech32), str(2, ethAddr.bech32)),
    fields: { from_address: addr.bech32, to_address: ethAddr.bech32, amount: [] },
  },
  { typeUrl: "/cosmos.gov.v1.MsgVote", bytes: cat(uint(1, 4), str(2, addr.bech32), uint(3, 1)), fields: null },
].map((m) => ({ typeUrl: m.typeUrl, value: hex(m.bytes), decoded: { typeUrl: m.typeUrl, fields: m.fields, value: m.fields ? null : hex(m.bytes) } }));

// ---- malformed transactions ----------------------------------------------------
const goodTx = qs.fromHex(transactions[0].txBytes);
const smallAuth = authInfo({ pubkeyType: "/cosmos.crypto.secp256k1.PubKey", pubkey: classical.publicKey, sequence: 1, feeAmount: "1", gasLimit: 1 });
const rawTx = (body, auth, sigs = [new Uint8Array(64)]) => cat(lenField(1, body), auth ? lenField(2, auth) : new Uint8Array(), ...sigs.map((s) => lenField(3, s)));
const sendBody = (extra) =>
  txBody([{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: cat(str(1, addr.bech32), str(2, ethAddr.bech32), extra) }], "");
const malformed = [
  { name: "truncated", txBytes: hex(goodTx.subarray(0, goodTx.length - 1)), error: "MALFORMED_TX" },
  { name: "no auth info", txBytes: hex(rawTx(sendBody(new Uint8Array()), null)), error: "MALFORMED_TX" },
  { name: "unknown TxRaw field", txBytes: hex(cat(rawTx(sendBody(new Uint8Array()), smallAuth), uint(4, 1))), error: "UNKNOWN_FIELD" },
  { name: "unknown MsgSend field", txBytes: hex(rawTx(sendBody(str(9, "x")), smallAuth)), error: "UNKNOWN_FIELD" },
  { name: "wrong wire type", txBytes: hex(rawTx(txBody([{ typeUrl: "/cosmos.bank.v1beta1.MsgSend", value: uint(1, 5) }], ""), smallAuth)), error: "MALFORMED_TX" },
  { name: "overlong varint", txBytes: hex(cat(lenField(1, sendBody(new Uint8Array())), lenField(2, smallAuth), tag(4, 0), Uint8Array.from(Array(10).fill(0xff)), Uint8Array.from([0x01]))), error: "MALFORMED_TX" },
  { name: "invalid UTF-8 memo", txBytes: hex(rawTx(cat(sendBody(new Uint8Array()), lenField(2, Uint8Array.from([0xc3, 0x28]))), smallAuth)), error: "MALFORMED_TX" },
];

// ---- deposit queries -----------------------------------------------------------------
const depositQueries = [
  {
    options: { address: ethAddr.bech32, minHeight: 100, maxHeight: 200 },
    expected:
      "/cosmos/tx/v1beta1/txs?query=transfer.recipient%3D%27" + ethAddr.bech32 +
      "%27%20AND%20tx.height%3E%3D100%20AND%20tx.height%3C%3D200&order_by=ORDER_BY_ASC&page=1&limit=50",
  },
  {
    options: { address: ethAddr.hex, event: "coin_received", orderBy: "desc", page: 2, limit: 100 },
    expected: "/cosmos/tx/v1beta1/txs?query=coin_received.receiver%3D%27" + ethAddr.bech32 + "%27&order_by=ORDER_BY_DESC&page=2&limit=100",
  },
];
const depositQueryErrors = [
  { options: { address: valoper }, error: "INVALID_ARGUMENT" },
  { options: { address: addr.bech32, limit: 101 }, error: "INVALID_ARGUMENT" },
  { options: { address: addr.bech32, page: 0 }, error: "INVALID_ARGUMENT" },
];

// ---- deposit extraction ------------------------------------------------------------------
const A = ethAddr.bech32;
const S = addr.bech32;
const ev = (type, attrs) => ({ type, attributes: Object.entries(attrs).map(([key, value]) => ({ key, value, index: true })) });
const feeEvents = (payer, amount) => [
  ev("coin_spent", { spender: payer, amount }),
  ev("coin_received", { receiver: FEE_COLLECTOR, amount }),
  ev("transfer", { recipient: FEE_COLLECTOR, sender: payer, amount }),
  ev("message", { sender: payer }),
  ev("tx", { fee: amount, fee_payer: payer }),
];
const send = (from, to, amount) => ({ "@type": "/cosmos.bank.v1beta1.MsgSend", from_address: from, to_address: to, amount });
const ERC20 = "erc20:0x02292293c13880a26242690eb70a0e42B8E91c28";
const txr = (txhash, height, code, messagesList, memo, events) => ({
  height: String(height),
  txhash,
  codespace: code ? "sdk" : "",
  code,
  tx: { "@type": "/cosmos.tx.v1beta1.Tx", body: { messages: messagesList, memo } },
  events,
});
const entry = (t, msgIndex, messageType, sender, amount, memo, reason) => ({
  txhash: t.txhash,
  height: t.height,
  msgIndex,
  messageType,
  sender,
  amount,
  denom: "uqor",
  memo,
  creditable: reason === null,
  reason,
});
const bankSend = txr("A1".repeat(32), 1000, 0, [send(S, A, [{ denom: "uqor", amount: "1500000" }, { denom: ERC20, amount: "5" }])], "user-1234", [
  ...feeEvents(S, "40000uqor"),
  ev("message", { action: "/cosmos.bank.v1beta1.MsgSend", sender: S, module: "bank", msg_index: "0" }),
  ev("coin_spent", { spender: S, amount: `1500000uqor,5${ERC20}`, msg_index: "0" }),
  ev("coin_received", { receiver: A, amount: `1500000uqor,5${ERC20}`, msg_index: "0" }),
  ev("transfer", { recipient: A, sender: S, amount: `1500000uqor,5${ERC20}`, msg_index: "0" }),
  ev("message", { sender: S, msg_index: "0" }),
]);
const failedSend = { ...bankSend, txhash: "B2".repeat(32), code: 5, codespace: "sdk" };
const evmTx = { "@type": "/cosmos.evm.vm.v1.MsgEthereumTx", from: ethAddr.hex };
const evmDeposit = txr("C3".repeat(32), 1001, 0, [evmTx], "", [
  ...feeEvents(S, "2520uqor"),
  ev("ethereum_tx", { ethereumTxHash: "0x" + "c3".repeat(32), txIndex: "0" }),
  ev("transfer", { recipient: EVM_MODULE, sender: S, amount: "2000000uqor", msg_index: "0" }),
  ev("transfer", { recipient: A, sender: EVM_MODULE, amount: "2000000uqor", msg_index: "0" }),
  ev("ethereum_tx", { amount: "2000000000000000000", ethereumTxHash: "0x" + "c3".repeat(32), txIndex: "0", txGasUsed: "21000", recipient: ethAddr.hex, msg_index: "0" }),
]);
const evmFailed = txr("D4".repeat(32), 1002, 0, [evmTx], "", [
  ...feeEvents(A, "5000uqor"),
  ev("ethereum_tx", { ethereumTxHash: "0x" + "d4".repeat(32), txIndex: "0" }),
  ev("transfer", { recipient: A, sender: FEE_COLLECTOR, amount: "1000uqor", msg_index: "0" }),
  ev("ethereum_tx", { amount: "0", ethereumTxHash: "0x" + "d4".repeat(32), txIndex: "0", txGasUsed: "40000", recipient: addr.hex, ethereumTxFailed: "out of gas", msg_index: "0" }),
]);
const evmRefund = txr("E5".repeat(32), 1003, 0, [evmTx], "", [
  ...feeEvents(A, "30000uqor"),
  ev("ethereum_tx", { ethereumTxHash: "0x" + "e5".repeat(32), txIndex: "0" }),
  ev("transfer", { recipient: A, sender: FEE_COLLECTOR, amount: "15000uqor", msg_index: "0" }),
  ev("ethereum_tx", { amount: "0", ethereumTxHash: "0x" + "e5".repeat(32), txIndex: "0", txGasUsed: "150000", recipient: addr.hex, msg_index: "0" }),
]);
const mixed = txr(
  "F6".repeat(32),
  1004,
  0,
  [
    { "@type": "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward", delegator_address: A, validator_address: valoper },
    send(S, A, [{ denom: "uqor", amount: "7" }]),
  ],
  "",
  [
    ...feeEvents(A, "50000uqor"),
    ev("transfer", { recipient: A, sender: DISTRIBUTION, amount: "123uqor", msg_index: "0" }),
    ev("transfer", { recipient: A, sender: S, amount: "7uqor", msg_index: "1" }),
    ev("transfer", { recipient: S, sender: A, amount: "9uqor", msg_index: "1" }),
  ],
);
const deposits = [
  { name: "bank send with a second denom", address: A, txResponse: bankSend, expected: [entry(bankSend, 0, "/cosmos.bank.v1beta1.MsgSend", S, "1500000", "user-1234", null)] },
  { name: "same send, hex address", address: ethAddr.hex, txResponse: bankSend, expected: [entry(bankSend, 0, "/cosmos.bank.v1beta1.MsgSend", S, "1500000", "user-1234", null)] },
  { name: "other denom only", address: A, denom: ERC20, txResponse: bankSend, expected: [{ ...entry(bankSend, 0, "/cosmos.bank.v1beta1.MsgSend", S, "5", "user-1234", null), denom: ERC20 }] },
  { name: "failed transaction", address: A, txResponse: failedSend, expected: [] },
  { name: "EVM native transfer", address: A, txResponse: evmDeposit, expected: [entry(evmDeposit, 0, "/cosmos.evm.vm.v1.MsgEthereumTx", EVM_MODULE, "2000000", "", null)] },
  { name: "failed EVM transaction", address: A, txResponse: evmFailed, expected: [entry(evmFailed, 0, "/cosmos.evm.vm.v1.MsgEthereumTx", FEE_COLLECTOR, "1000", "", "evm_failed")] },
  { name: "EVM gas refund", address: A, txResponse: evmRefund, expected: [entry(evmRefund, 0, "/cosmos.evm.vm.v1.MsgEthereumTx", FEE_COLLECTOR, "15000", "", "fee_refund")] },
  {
    name: "reward withdrawal and a send",
    address: A,
    txResponse: mixed,
    expected: [
      entry(mixed, 0, "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward", DISTRIBUTION, "123", "", "unsupported_message"),
      entry(mixed, 1, "/cosmos.bank.v1beta1.MsgSend", S, "7", "", null),
    ],
  },
  { name: "not the recipient", address: FEE_COLLECTOR, txResponse: bankSend, expected: [] },
];

const vectors = {
  format: "custody-kit-vectors-v1",
  description:
    "Test vectors for the QoreChain custody kit. Keys come from the public BIP-39 test mnemonic and must never hold funds; the signed transactions use account numbers that do not exist for these keys on any network. ML-DSA-87 signatures are deterministic (FIPS 204, rnd = 32 zero bytes).",
  mnemonic: MNEMONIC,
  chainId: CHAIN_ID,
  qoresignVectors: QORESIGN_VECTORS,
  moduleAccounts: { fee_collector: FEE_COLLECTOR, evm: EVM_MODULE, distribution: DISTRIBUTION },
  addresses,
  transactions,
  messages,
  malformed,
  depositQueries,
  depositQueryErrors,
  deposits,
};

writeFileSync(new URL("../../../vectors/custody-v1.json", import.meta.url), JSON.stringify(vectors, null, 2) + "\n");
console.log("wrote vectors/custody-v1.json");
