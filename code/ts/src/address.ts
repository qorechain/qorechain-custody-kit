// SPDX-License-Identifier: Apache-2.0
//
// Address validation for deposit and withdrawal forms.
//
// A QoreChain account has one 20-byte address with two spellings: bech32
// `qor1...` and hex `0x...` (EIP-55 checksummed). Validator operator
// addresses use the `qorvaloper1...` prefix over the same kind of 20 bytes.

import { addressFromBytes } from "@qorechain/qoresign";

import { Bech32DecodeError, bech32Decode, bech32Encode } from "./bech32.js";

export const ACCOUNT_PREFIX = "qor";
export const VALIDATOR_PREFIX = "qorvaloper";

export type AddressKind = "account" | "validator";

export type AddressErrorCode =
  | "EMPTY"
  | "WHITESPACE"
  | "BAD_HEX"
  | "BAD_EIP55"
  | "NO_CHECKSUM"
  | "MIXED_CASE"
  | "BAD_BECH32"
  | "BAD_CHECKSUM"
  | "WRONG_PREFIX"
  | "BAD_LENGTH"
  | "KIND_NOT_ALLOWED";

export interface ValidAddress {
  valid: true;
  kind: AddressKind;
  /** How the input was written. */
  format: "bech32" | "hex";
  /** `bech32` for a bech32 input, `eip55` for a checksummed hex input, `none` for an all-lowercase or all-uppercase hex input. */
  checksum: "bech32" | "eip55" | "none";
  /** Canonical lowercase bech32 (`qor1...` or `qorvaloper1...`). */
  bech32: string;
  /** EIP-55 hex form of the same 20 bytes. */
  hex: string;
}

export interface InvalidAddress {
  valid: false;
  error: AddressErrorCode;
  detail: string;
}

export type AddressCheck = ValidAddress | InvalidAddress;

export interface ValidateAddressOptions {
  /** Kinds to accept. Default: accounts only. */
  allow?: readonly AddressKind[];
  /** Refuse a hex address that carries no EIP-55 checksum (all lowercase or all uppercase). Default false. */
  requireEip55?: boolean;
}

function fail(error: AddressErrorCode, detail: string): InvalidAddress {
  return { valid: false, error, detail };
}

/**
 * Validate a `qor1...`, `qorvaloper1...` or `0x...` address.
 *
 * Never throws: an invalid input gives `{ valid: false, error }` with a
 * stable error code. Accounts only, unless `allow` says otherwise.
 */
export function validateAddress(input: string, opts: ValidateAddressOptions = {}): AddressCheck {
  const allow = opts.allow ?? ["account"];
  if (typeof input !== "string" || input.length === 0) return fail("EMPTY", "the address is empty");
  if (input.trim() !== input) return fail("WHITESPACE", "the address has leading or trailing whitespace");

  if (input.startsWith("0x")) {
    const body = input.slice(2);
    if (!/^[0-9a-fA-F]{40}$/.test(body)) return fail("BAD_HEX", "a hex address is 0x followed by 40 hex digits");
    const bytes = Uint8Array.from(body.match(/../g)!.map((b) => parseInt(b, 16)));
    const canonical = addressFromBytes(bytes);
    const mixed = /[a-f]/.test(body) && /[A-F]/.test(body);
    let checksum: "eip55" | "none";
    if (input === canonical.hex) checksum = "eip55";
    else if (mixed) return fail("BAD_EIP55", "the EIP-55 checksum (letter case) does not match");
    else checksum = "none";
    if (checksum === "none" && opts.requireEip55) {
      return fail("NO_CHECKSUM", "the hex address carries no EIP-55 checksum");
    }
    if (!allow.includes("account")) return fail("KIND_NOT_ALLOWED", "a hex address is an account address");
    return { valid: true, kind: "account", format: "hex", checksum, bech32: canonical.bech32, hex: canonical.hex };
  }

  let decoded;
  try {
    decoded = bech32Decode(input);
  } catch (e) {
    if (e instanceof Bech32DecodeError) return fail(e.code, e.message);
    throw e;
  }
  let kind: AddressKind;
  if (decoded.hrp === ACCOUNT_PREFIX) kind = "account";
  else if (decoded.hrp === VALIDATOR_PREFIX) kind = "validator";
  else return fail("WRONG_PREFIX", `expected the "${ACCOUNT_PREFIX}" or "${VALIDATOR_PREFIX}" prefix, got "${decoded.hrp}"`);
  if (decoded.bytes.length !== 20) {
    return fail("BAD_LENGTH", `addresses are 20 bytes, this one has ${decoded.bytes.length}`);
  }
  if (!allow.includes(kind)) return fail("KIND_NOT_ALLOWED", `a ${kind} address is not accepted here`);
  const canonical = addressFromBytes(decoded.bytes);
  return {
    valid: true,
    kind,
    format: "bech32",
    checksum: "bech32",
    bech32: kind === "account" ? canonical.bech32 : bech32Encode(VALIDATOR_PREFIX, decoded.bytes),
    hex: canonical.hex,
  };
}
