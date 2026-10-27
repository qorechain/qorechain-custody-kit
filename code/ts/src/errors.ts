// SPDX-License-Identifier: Apache-2.0

/**
 * Stable error codes, identical in every language of the kit.
 *
 * - `MALFORMED_TX`: the bytes are not a well-formed transaction.
 * - `UNKNOWN_FIELD`: a field the decoder does not know, in a structure it decodes
 *   strictly. The network refuses such transactions too.
 * - `INVALID_ARGUMENT`: a caller error (bad option, bad address for a query).
 */
export type CustodyKitErrorCode = "MALFORMED_TX" | "UNKNOWN_FIELD" | "INVALID_ARGUMENT";

export class CustodyKitError extends Error {
  readonly code: CustodyKitErrorCode;

  constructor(code: CustodyKitErrorCode, message: string) {
    super(`${code}: ${message}`);
    this.name = "CustodyKitError";
    this.code = code;
  }
}
