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

// MsgOpenEVMWindow with every optional field (5 to 9) set, encoded field by
// field here rather than read from the vectors file.
describe("MsgOpenEVMWindow fields 5 to 9", () => {
  const TYPE = "/qorechain.pqc.v1.MsgOpenEVMWindow";
  const varint = (v: number): number[] => {
    const out: number[] = [];
    do {
      let b = v & 0x7f;
      v = Math.floor(v / 128);
      if (v) b |= 0x80;
      out.push(b);
    } while (v);
    return out;
  };
  const str = (num: number, s: string): number[] => {
    const b = [...new TextEncoder().encode(s)];
    return [...varint((num << 3) | 2), ...varint(b.length), ...b];
  };
  const uint = (num: number, v: number): number[] => [...varint(num << 3), ...varint(v)];
  const W = {
    sender: "qor1npvwllfr9dqr8erajqqr6s0vxnk2ak55am9g2c",
    target: "0x000000000000000000000000000000000000dEaD",
    validator: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
    valoper1: "qorvaloper19rl4cm2hmr8afy4kldpxz3fka4jguq0a5ws5he",
    valoper2: "qorvaloper1npvwllfr9dqr8erajqqr6s0vxnk2ak55p70zhk",
    receiver: "channel-0/cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4",
  };
  const full = [
    ...str(1, W.sender),
    ...uint(2, 600),
    ...uint(3, 10),
    ...str(4, "25000000"),
    ...uint(5, 1),
    ...str(6, W.target),
    ...str(7, W.validator),
    ...str(8, W.valoper1),
    ...str(8, W.valoper2),
    ...str(9, W.receiver),
  ];

  it("decodes every field", () => {
    expect(decodeMessage(TYPE, Uint8Array.from(full))).toEqual({
      typeUrl: TYPE,
      fields: {
        sender: W.sender,
        blocks: "600",
        max_txs: "10",
        max_value: "25000000",
        native_only: true,
        allowed_targets: [W.target],
        validators: [W.validator],
        staking_validators: [W.valoper1, W.valoper2],
        ibc_receivers: [W.receiver],
      },
      value: null,
    });
  });
  it("still refuses an unknown field 10", () => {
    expect(codeOf(() => decodeMessage(TYPE, Uint8Array.from([...full, ...str(10, "x")])))).toBe("UNKNOWN_FIELD");
    expect(codeOf(() => decodeMessage(TYPE, Uint8Array.from([...full, ...uint(10, 1)])))).toBe("UNKNOWN_FIELD");
  });
  it("refuses a list field with the wrong wire type", () => {
    expect(codeOf(() => decodeMessage(TYPE, Uint8Array.from([...full, ...uint(9, 1)])))).toBe("MALFORMED_TX");
  });
});
