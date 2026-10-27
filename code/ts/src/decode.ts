// SPDX-License-Identifier: Apache-2.0
//
// Decode a signed native-lane transaction (`TxRaw`) into what a custody
// operator reviews before broadcasting: the messages and their fields, the
// fee, the signer, and whether the ML-DSA-87 layer is present.

import { sha256 } from "@noble/hashes/sha2.js";

import { CustodyKitError } from "./errors.js";
import {
  WIRE_LEN,
  asBytes,
  asString,
  asUint,
  expectWire,
  readFields,
  toHex,
  type Field,
} from "./proto.js";

export const PQC_HYBRID_TYPE_URL = "/qorechain.pqc.v1.PQCHybridSignature";

export interface Coin {
  denom: string;
  amount: string;
}

export interface DecodedMessage {
  typeUrl: string;
  /** Decoded fields (proto field names) for the message types the kit knows; `null` otherwise. */
  fields: Record<string, unknown> | null;
  /** Hex of the message bytes, only for message types the kit does not know. */
  value: string | null;
}

export interface PqcLayerSummary {
  algorithmId: number;
  signatureLength: number;
  /** 0 when the public key is not embedded. */
  publicKeyLength: number;
}

export interface DecodedSigner {
  publicKeyType: string | null;
  /** Hex of the compressed secp256k1 key, for single-key accounts. */
  publicKey: string | null;
  sequence: string;
  /** 1 = SIGN_MODE_DIRECT. `null` for a multisig mode. */
  signMode: number | null;
}

export interface DecodedTx {
  /** Uppercase hex SHA-256 of the transaction bytes: the hash explorers and the REST API use. */
  txHash: string;
  messages: DecodedMessage[];
  memo: string;
  timeoutHeight: string;
  unordered: boolean;
  timeoutTimestampSeconds: string;
  extensionOptions: string[];
  nonCriticalExtensionOptions: string[];
  pqcLayers: PqcLayerSummary[];
  signers: DecodedSigner[];
  fee: { amount: Coin[]; gasLimit: string; payer: string; granter: string };
  signatureCount: number;
}

type Kind = "string" | "uint" | "bool" | "bytes" | "coin" | "coins" | "strings" | "io";

const DELEGATION: [number, string, Kind][] = [
  [1, "delegator_address", "string"],
  [2, "validator_address", "string"],
  [3, "amount", "coin"],
];

/** Field layouts of the message types a custodian handles. */
export const KNOWN_MESSAGES: Readonly<Record<string, [number, string, Kind][]>> = {
  "/cosmos.bank.v1beta1.MsgSend": [
    [1, "from_address", "string"],
    [2, "to_address", "string"],
    [3, "amount", "coins"],
  ],
  "/cosmos.bank.v1beta1.MsgMultiSend": [
    [1, "inputs", "io"],
    [2, "outputs", "io"],
  ],
  "/cosmos.staking.v1beta1.MsgDelegate": DELEGATION,
  "/cosmos.staking.v1beta1.MsgUndelegate": DELEGATION,
  "/cosmos.staking.v1beta1.MsgBeginRedelegate": [
    [1, "delegator_address", "string"],
    [2, "validator_src_address", "string"],
    [3, "validator_dst_address", "string"],
    [4, "amount", "coin"],
  ],
  "/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation": [
    [1, "delegator_address", "string"],
    [2, "validator_address", "string"],
    [3, "amount", "coin"],
    [4, "creation_height", "uint"],
  ],
  "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward": [
    [1, "delegator_address", "string"],
    [2, "validator_address", "string"],
  ],
  "/cosmos.distribution.v1beta1.MsgSetWithdrawAddress": [
    [1, "delegator_address", "string"],
    [2, "withdraw_address", "string"],
  ],
  "/qorechain.stakingtier.v1.MsgLockDelegation": [
    [1, "delegator", "string"],
    [2, "validator", "string"],
    [3, "amount", "string"],
    [4, "months", "uint"],
  ],
  "/qorechain.stakingtier.v1.MsgUnlockEarly": [
    [1, "delegator", "string"],
    [2, "lock_id", "uint"],
  ],
  "/qorechain.stakingtier.v1.MsgClaimBonus": [[1, "holder", "string"]],
  "/qorechain.pqc.v1.MsgRegisterPQCKeyV2": [
    [1, "sender", "string"],
    [2, "public_key", "bytes"],
    [3, "algorithm_id", "uint"],
    [4, "ecdsa_pubkey", "bytes"],
    [5, "key_type", "string"],
    [6, "proof_of_possession", "bytes"],
  ],
  "/qorechain.pqc.v1.MsgRotatePQCKey": [
    [1, "sender", "string"],
    [2, "old_public_key", "bytes"],
    [3, "new_public_key", "bytes"],
    [4, "old_signature", "bytes"],
    [5, "new_signature", "bytes"],
  ],
  "/qorechain.pqc.v1.MsgOpenEVMWindow": [
    [1, "sender", "string"],
    [2, "blocks", "uint"],
    [3, "max_txs", "uint"],
    [4, "max_value", "string"],
    [5, "native_only", "bool"],
    [6, "allowed_targets", "strings"],
  ],
  "/qorechain.pqc.v1.MsgCloseEVMWindow": [[1, "sender", "string"]],
};

function unknownField(what: string, f: Field): never {
  throw new CustodyKitError("UNKNOWN_FIELD", `${what}: unknown field ${f.num}`);
}

function decodeCoin(bytes: Uint8Array): Coin {
  const coin: Coin = { denom: "", amount: "" };
  for (const f of readFields(bytes)) {
    if (f.num === 1) coin.denom = asString(f, "Coin");
    else if (f.num === 2) coin.amount = asString(f, "Coin");
    else unknownField("Coin", f);
  }
  return coin;
}

function decodeIo(bytes: Uint8Array): { address: string; coins: Coin[] } {
  const io = { address: "", coins: [] as Coin[] };
  for (const f of readFields(bytes)) {
    if (f.num === 1) io.address = asString(f, "Input/Output");
    else if (f.num === 2) io.coins.push(decodeCoin(asBytes(f, "Input/Output")));
    else unknownField("Input/Output", f);
  }
  return io;
}

function defaultFor(kind: Kind): unknown {
  switch (kind) {
    case "string":
    case "bytes":
      return "";
    case "uint":
      return "0";
    case "bool":
      return false;
    case "coin":
      return null;
    default:
      return [];
  }
}

/** Decode one message. Unknown types come back with their bytes in hex. */
export function decodeMessage(typeUrl: string, value: Uint8Array): DecodedMessage {
  const layout = KNOWN_MESSAGES[typeUrl];
  if (!layout) return { typeUrl, fields: null, value: toHex(value) };
  const fields: Record<string, unknown> = {};
  for (const [, name, kind] of layout) fields[name] = defaultFor(kind);
  for (const f of readFields(value)) {
    const spec = layout.find(([n]) => n === f.num);
    if (!spec) unknownField(typeUrl, f);
    const [, name, kind] = spec;
    switch (kind) {
      case "string":
        fields[name] = asString(f, typeUrl);
        break;
      case "bytes":
        fields[name] = toHex(asBytes(f, typeUrl));
        break;
      case "uint":
        fields[name] = asUint(f, typeUrl).toString();
        break;
      case "bool":
        fields[name] = asUint(f, typeUrl) !== 0n;
        break;
      case "coin":
        fields[name] = decodeCoin(asBytes(f, typeUrl));
        break;
      case "coins":
        (fields[name] as Coin[]).push(decodeCoin(asBytes(f, typeUrl)));
        break;
      case "strings":
        (fields[name] as string[]).push(asString(f, typeUrl));
        break;
      case "io":
        (fields[name] as unknown[]).push(decodeIo(asBytes(f, typeUrl)));
        break;
    }
  }
  return { typeUrl, fields, value: null };
}

function decodeAny(bytes: Uint8Array, what: string): { typeUrl: string; value: Uint8Array } {
  let typeUrl = "";
  let value: Uint8Array = new Uint8Array();
  for (const f of readFields(bytes)) {
    if (f.num === 1) typeUrl = asString(f, what);
    else if (f.num === 2) value = asBytes(f, what);
    else unknownField(what, f);
  }
  return { typeUrl, value };
}

function decodePqcLayer(bytes: Uint8Array): PqcLayerSummary {
  const out: PqcLayerSummary = { algorithmId: 0, signatureLength: 0, publicKeyLength: 0 };
  for (const f of readFields(bytes)) {
    if (f.num === 1) out.algorithmId = Number(asUint(f, "PQCHybridSignature"));
    else if (f.num === 2) out.signatureLength = asBytes(f, "PQCHybridSignature").length;
    else if (f.num === 3) out.publicKeyLength = asBytes(f, "PQCHybridSignature").length;
    else unknownField("PQCHybridSignature", f);
  }
  return out;
}

const SINGLE_KEY_TYPES = new Set([
  "/cosmos.crypto.secp256k1.PubKey",
  "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey",
]);

function decodeSigner(bytes: Uint8Array): DecodedSigner {
  const s: DecodedSigner = { publicKeyType: null, publicKey: null, sequence: "0", signMode: null };
  for (const f of readFields(bytes)) {
    if (f.num === 1) {
      const any = decodeAny(asBytes(f, "SignerInfo"), "SignerInfo.public_key");
      s.publicKeyType = any.typeUrl;
      if (SINGLE_KEY_TYPES.has(any.typeUrl)) {
        for (const k of readFields(any.value)) {
          if (k.num === 1) s.publicKey = toHex(asBytes(k, "PubKey"));
          else unknownField("PubKey", k);
        }
      }
    } else if (f.num === 2) {
      for (const m of readFields(asBytes(f, "ModeInfo"))) {
        if (m.num === 1) {
          s.signMode = 0;
          for (const single of readFields(asBytes(m, "ModeInfo.Single"))) {
            if (single.num === 1) s.signMode = Number(asUint(single, "ModeInfo.Single"));
            else unknownField("ModeInfo.Single", single);
          }
        } else if (m.num === 2) {
          expectWire(m, WIRE_LEN, "ModeInfo.Multi");
          s.signMode = null;
        } else unknownField("ModeInfo", m);
      }
    } else if (f.num === 3) s.sequence = asUint(f, "SignerInfo").toString();
    else unknownField("SignerInfo", f);
  }
  return s;
}

/** Decode a signed `TxRaw`. Throws `CustodyKitError` (`MALFORMED_TX` or `UNKNOWN_FIELD`). */
export function decodeTx(txBytes: Uint8Array): DecodedTx {
  let bodyBytes: Uint8Array | undefined;
  let authInfoBytes: Uint8Array | undefined;
  let signatureCount = 0;
  for (const f of readFields(txBytes)) {
    if (f.num === 1) bodyBytes = asBytes(f, "TxRaw");
    else if (f.num === 2) authInfoBytes = asBytes(f, "TxRaw");
    else if (f.num === 3) {
      asBytes(f, "TxRaw");
      signatureCount++;
    } else unknownField("TxRaw", f);
  }
  if (!bodyBytes || !authInfoBytes) {
    throw new CustodyKitError("MALFORMED_TX", "TxRaw needs body_bytes and auth_info_bytes");
  }

  const tx: DecodedTx = {
    txHash: toHex(sha256(txBytes)).toUpperCase(),
    messages: [],
    memo: "",
    timeoutHeight: "0",
    unordered: false,
    timeoutTimestampSeconds: "0",
    extensionOptions: [],
    nonCriticalExtensionOptions: [],
    pqcLayers: [],
    signers: [],
    fee: { amount: [], gasLimit: "0", payer: "", granter: "" },
    signatureCount,
  };

  for (const f of readFields(bodyBytes)) {
    switch (f.num) {
      case 1: {
        const any = decodeAny(asBytes(f, "TxBody"), "TxBody.messages");
        tx.messages.push(decodeMessage(any.typeUrl, any.value));
        break;
      }
      case 2:
        tx.memo = asString(f, "TxBody");
        break;
      case 3:
        tx.timeoutHeight = asUint(f, "TxBody").toString();
        break;
      case 4:
        tx.unordered = asUint(f, "TxBody") !== 0n;
        break;
      case 5:
        for (const t of readFields(asBytes(f, "TxBody"))) {
          if (t.num === 1) tx.timeoutTimestampSeconds = asUint(t, "Timestamp").toString();
          else if (t.num === 2) asUint(t, "Timestamp");
          else unknownField("Timestamp", t);
        }
        break;
      case 1023: {
        const any = decodeAny(asBytes(f, "TxBody"), "TxBody.extension_options");
        tx.extensionOptions.push(any.typeUrl);
        if (any.typeUrl === PQC_HYBRID_TYPE_URL) tx.pqcLayers.push(decodePqcLayer(any.value));
        break;
      }
      case 2047:
        tx.nonCriticalExtensionOptions.push(
          decodeAny(asBytes(f, "TxBody"), "TxBody.non_critical_extension_options").typeUrl,
        );
        break;
      default:
        unknownField("TxBody", f);
    }
  }

  for (const f of readFields(authInfoBytes)) {
    if (f.num === 1) tx.signers.push(decodeSigner(asBytes(f, "AuthInfo")));
    else if (f.num === 2) {
      for (const g of readFields(asBytes(f, "AuthInfo"))) {
        if (g.num === 1) tx.fee.amount.push(decodeCoin(asBytes(g, "Fee")));
        else if (g.num === 2) tx.fee.gasLimit = asUint(g, "Fee").toString();
        else if (g.num === 3) tx.fee.payer = asString(g, "Fee");
        else if (g.num === 4) tx.fee.granter = asString(g, "Fee");
        else unknownField("Fee", g);
      }
    } else unknownField("AuthInfo", f);
  }
  return tx;
}
