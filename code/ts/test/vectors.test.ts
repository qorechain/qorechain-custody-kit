// SPDX-License-Identifier: Apache-2.0
//
// Checks the TypeScript reference against vectors/custody-v1.json and, when
// it has been fetched (scripts/fetch-qoresign-vectors.sh), against the
// hybrid transactions of vectors/qoresign-v1.json.

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  CustodyKitError,
  buildDepositQuery,
  decodeMessage,
  decodeTx,
  extractDeposits,
  fromHex,
  validateAddress,
  verifyTx,
  type AddressKind,
  type DepositQueryOptions,
} from "../src/index.js";

const vectorsDir = new URL("../../../vectors/", import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const V: any = JSON.parse(readFileSync(new URL("custody-v1.json", vectorsDir), "utf8"));

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof CustodyKitError) return e.code;
    throw e;
  }
  return "NO_ERROR";
}

describe("validateAddress", () => {
  for (const c of V.addresses.valid) {
    it(`accepts ${JSON.stringify(c.input)}`, () => {
      const r = validateAddress(c.input, { allow: c.allow as AddressKind[] | undefined, requireEip55: c.requireEip55 });
      expect(r).toEqual({ valid: true, ...c.expected });
    });
  }
  for (const c of V.addresses.invalid) {
    it(`refuses ${JSON.stringify(c.input)} with ${c.error}`, () => {
      const r = validateAddress(c.input, { allow: c.allow as AddressKind[] | undefined, requireEip55: c.requireEip55 });
      expect(r.valid).toBe(false);
      if (!r.valid) expect(r.error).toBe(c.error);
    });
  }
});

describe("decodeTx and verifyTx", () => {
  for (const t of V.transactions) {
    it(`decodes ${t.name}`, () => {
      expect(decodeTx(fromHex(t.txBytes))).toEqual(t.decoded);
    });
    for (const c of t.verifyCases) {
      it(`verifies ${t.name}: ${c.description}`, () => {
        const r = verifyTx({
          txBytes: fromHex(t.txBytes),
          chainId: c.chainId ?? t.chainId,
          accountNumber: c.accountNumber ?? t.accountNumber,
          classicalPublicKey: fromHex(c.classicalPublicKey ?? t.classicalPublicKey),
          classicalKeyType: c.classicalKeyType ?? t.classicalKeyType,
          pqPublicKey: c.omitPqPublicKey ? undefined : fromHex(c.pqPublicKey ?? t.pqPublicKey),
        });
        expect(r).toEqual(c.expected);
      });
    }
  }
  for (const m of V.messages) {
    it(`decodes message ${m.typeUrl}`, () => {
      expect(decodeMessage(m.typeUrl, fromHex(m.value))).toEqual(m.decoded);
    });
  }
  for (const m of V.malformed) {
    it(`refuses malformed: ${m.name}`, () => {
      expect(codeOf(() => decodeTx(fromHex(m.txBytes)))).toBe(m.error);
    });
  }
});

describe("deposit filter", () => {
  for (const q of V.depositQueries) {
    it(`builds ${q.expected.slice(0, 60)}...`, () => {
      expect(buildDepositQuery(q.options as DepositQueryOptions)).toBe(q.expected);
    });
  }
  for (const q of V.depositQueryErrors) {
    it(`refuses query options ${JSON.stringify(q.options)}`, () => {
      expect(codeOf(() => buildDepositQuery(q.options as DepositQueryOptions))).toBe(q.error);
    });
  }
  for (const d of V.deposits) {
    it(`extracts: ${d.name}`, () => {
      expect(extractDeposits(d.txResponse, d.address, d.denom ? { denom: d.denom } : {})).toEqual(d.expected);
    });
  }
});

const qsPath = new URL("qoresign-v1.json", vectorsDir);
describe.skipIf(!existsSync(qsPath))("QoreSign vectors (by reference)", () => {
  it("verifies both sign-bytes cases of hybridTx", () => {
    const Q = JSON.parse(readFileSync(qsPath, "utf8"));
    for (const c of Q.hybridTx.cases) {
      const r = verifyTx({
        txBytes: fromHex(c.txBytes),
        chainId: Q.chainId,
        accountNumber: Q.hybridTx.accountNumber,
        classicalPublicKey: fromHex(Q.accounts.secp256k1.publicKey),
        pqPublicKey: fromHex(Q.canonical[0].publicKey),
        signBytesVersion: "either",
      });
      expect(r).toEqual({ valid: true, classical: true, signerKey: "match", pq: { valid: true, signBytesVersion: c.signBytesVersion, reason: null } });
    }
  });
});
