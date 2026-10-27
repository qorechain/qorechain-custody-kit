// SPDX-License-Identifier: Apache-2.0
//
// Verify a signed native-lane transaction before it is broadcast: the
// secp256k1 signature, the ML-DSA-87 layer against the account's registered
// key, and that the signer recorded in the transaction is the expected key.

import { verifyHybridTx, type ClassicalKeyType } from "@qorechain/qoresign";

import { decodeTx } from "./decode.js";
import { toHex } from "./proto.js";

export interface VerifyTxArgs {
  /** Encoded `TxRaw`. */
  txBytes: Uint8Array;
  chainId: string;
  /** From `/cosmos/auth/v1beta1/account_info/{address}`. */
  accountNumber: bigint | number;
  /** The signer's 33-byte compressed secp256k1 public key. */
  classicalPublicKey: Uint8Array;
  /** `secp256k1` (coin type 118 accounts, default) or `eth_secp256k1` (eth-native accounts). */
  classicalKeyType?: ClassicalKeyType;
  /** The ML-DSA-87 key registered for the account (`/qorechain/pqc/v1/account/{address}`). Omit to check the classical signature only. */
  pqPublicKey?: Uint8Array;
  /** Sign-bytes version of the ML-DSA-87 layer. Default `v2`, what both public networks verify. */
  signBytesVersion?: "v1" | "v2" | "either";
}

export interface VerifyTxResult {
  /** True when every check that was asked for passed. */
  valid: boolean;
  classical: boolean;
  /** `match`, `absent` (the transaction carries no public key; the account's stored key applies) or `mismatch`. */
  signerKey: "match" | "absent" | "mismatch";
  /** `null` when no ML-DSA-87 key was given. */
  pq: { valid: boolean; signBytesVersion: string | null; reason: string | null } | null;
}

/** Verify a single-signer transaction. Throws on malformed input, never on a bad signature. */
export function verifyTx(args: VerifyTxArgs): VerifyTxResult {
  const decoded = decodeTx(args.txBytes);
  const signer = decoded.signers[0];
  let signerKey: VerifyTxResult["signerKey"] = "absent";
  if (decoded.signers.length === 1 && signer?.publicKey) {
    signerKey = signer.publicKey === toHex(args.classicalPublicKey) ? "match" : "mismatch";
  } else if (decoded.signers.length !== 1) {
    signerKey = "mismatch";
  }
  const r = verifyHybridTx({
    txBytes: args.txBytes,
    chainId: args.chainId,
    accountNumber: args.accountNumber,
    classicalPublicKey: args.classicalPublicKey,
    classicalKeyType: args.classicalKeyType ?? "secp256k1",
    pqPublicKey: args.pqPublicKey,
    signBytesVersion: args.signBytesVersion ?? "v2",
  });
  const pq = r.pq
    ? { valid: r.pq.valid, signBytesVersion: r.pq.signBytesVersion ?? null, reason: r.pq.reason ?? null }
    : null;
  return { valid: r.valid && signerKey !== "mismatch", classical: r.classical, signerKey, pq };
}
