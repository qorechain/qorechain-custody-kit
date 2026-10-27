// SPDX-License-Identifier: Apache-2.0
//
// Bech32 (BIP-173) with error classification. QoreChain addresses use the
// original bech32 checksum, not bech32m. Kept separate from QoreSign so that
// every language of the kit reports the same error code for the same input.

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

export type Bech32Error = "MIXED_CASE" | "BAD_BECH32" | "BAD_CHECKSUM";

export class Bech32DecodeError extends Error {
  constructor(readonly code: Bech32Error, message: string) {
    super(message);
  }
}

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= GENERATOR[i]!;
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function convertBits(data: number[], from: number, to: number, pad: boolean): number[] {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
    acc &= (1 << bits) - 1;
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) {
    throw new Bech32DecodeError("BAD_BECH32", "invalid padding in the data part");
  }
  return out;
}

/** Decode a bech32 string into its human-readable part and data bytes. */
export function bech32Decode(input: string): { hrp: string; bytes: Uint8Array } {
  const lower = input.toLowerCase();
  const upper = input.toUpperCase();
  if (input !== lower && input !== upper) {
    throw new Bech32DecodeError("MIXED_CASE", "bech32 strings must be all lowercase or all uppercase");
  }
  const pos = lower.lastIndexOf("1");
  if (pos < 1 || pos + 7 > lower.length) {
    throw new Bech32DecodeError("BAD_BECH32", "missing separator, prefix or checksum");
  }
  const hrp = lower.slice(0, pos);
  for (let i = 0; i < hrp.length; i++) {
    const c = hrp.charCodeAt(i);
    if (c < 33 || c > 126) throw new Bech32DecodeError("BAD_BECH32", "invalid character in the prefix");
  }
  const data: number[] = [];
  for (const ch of lower.slice(pos + 1)) {
    const v = CHARSET.indexOf(ch);
    if (v === -1) throw new Bech32DecodeError("BAD_BECH32", `invalid character ${JSON.stringify(ch)}`);
    data.push(v);
  }
  if (polymod([...hrpExpand(hrp), ...data]) !== 1) {
    throw new Bech32DecodeError("BAD_CHECKSUM", "bech32 checksum does not match");
  }
  const bytes = convertBits(data.slice(0, -6), 5, 8, false);
  return { hrp, bytes: Uint8Array.from(bytes) };
}

/** Encode bytes as bech32 (lowercase). */
export function bech32Encode(hrp: string, bytes: Uint8Array): string {
  const words = convertBits([...bytes], 8, 5, true);
  const values = [...hrpExpand(hrp), ...words, 0, 0, 0, 0, 0, 0];
  const mod = polymod(values) ^ 1;
  let out = `${hrp}1`;
  for (const w of words) out += CHARSET[w];
  for (let i = 0; i < 6; i++) out += CHARSET[(mod >>> (5 * (5 - i))) & 31];
  return out;
}
