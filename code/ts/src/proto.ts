// SPDX-License-Identifier: Apache-2.0
//
// A strict protobuf reader, enough to decode transactions. It refuses
// truncated input, overlong varints and the deprecated group wire types.

import { CustodyKitError } from "./errors.js";

export const WIRE_VARINT = 0;
export const WIRE_FIXED64 = 1;
export const WIRE_LEN = 2;
export const WIRE_FIXED32 = 5;

export interface Field {
  num: number;
  wire: number;
  /** Set for varint fields. */
  int?: bigint;
  /** Set for length-delimited and fixed fields. */
  bytes?: Uint8Array;
}

function malformed(message: string): never {
  throw new CustodyKitError("MALFORMED_TX", message);
}

function readVarint(buf: Uint8Array, pos: number): [bigint, number] {
  let result = 0n;
  let shift = 0n;
  for (let i = 0; i < 10; i++) {
    if (pos >= buf.length) malformed("truncated varint");
    const b = buf[pos++]!;
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      if (result >= 1n << 64n) malformed("varint overflows 64 bits");
      return [result, pos];
    }
    shift += 7n;
  }
  return malformed("varint longer than 10 bytes");
}

/** Read every field of a message, in order. */
export function readFields(buf: Uint8Array): Field[] {
  const out: Field[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const [key, next] = readVarint(buf, pos);
    pos = next;
    const num = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (num === 0) malformed("field number 0");
    switch (wire) {
      case WIRE_VARINT: {
        const [v, p] = readVarint(buf, pos);
        pos = p;
        out.push({ num, wire, int: v });
        break;
      }
      case WIRE_FIXED64:
      case WIRE_FIXED32: {
        const n = wire === WIRE_FIXED64 ? 8 : 4;
        if (pos + n > buf.length) malformed("truncated fixed field");
        out.push({ num, wire, bytes: buf.subarray(pos, pos + n) });
        pos += n;
        break;
      }
      case WIRE_LEN: {
        const [len, p] = readVarint(buf, pos);
        pos = p;
        if (len > BigInt(buf.length - pos)) malformed("length-delimited field runs past the end");
        const n = Number(len);
        out.push({ num, wire, bytes: buf.subarray(pos, pos + n) });
        pos += n;
        break;
      }
      default:
        malformed(`unsupported wire type ${wire}`);
    }
  }
  return out;
}

export function expectWire(f: Field, wire: number, what: string): void {
  if (f.wire !== wire) malformed(`${what}: field ${f.num} has wire type ${f.wire}, expected ${wire}`);
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

export function asString(f: Field, what: string): string {
  expectWire(f, WIRE_LEN, what);
  try {
    return utf8.decode(f.bytes!);
  } catch {
    return malformed(`${what}: field ${f.num} is not valid UTF-8`);
  }
}

export function asBytes(f: Field, what: string): Uint8Array {
  expectWire(f, WIRE_LEN, what);
  return f.bytes!;
}

export function asUint(f: Field, what: string): bigint {
  expectWire(f, WIRE_VARINT, what);
  return f.int!;
}

export function toHex(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

export function fromHex(s: string): Uint8Array {
  const clean = s.startsWith("0x") ? s.slice(2) : s;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) {
    throw new CustodyKitError("INVALID_ARGUMENT", "not a hex string");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(2 * i, 2 * i + 2), 16);
  return out;
}
