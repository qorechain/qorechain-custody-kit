// SPDX-License-Identifier: Apache-2.0
//
// QoreChain custody kit, TypeScript reference. Built on @qorechain/qoresign.

export { CustodyKitError, type CustodyKitErrorCode } from "./errors.js";
export {
  ACCOUNT_PREFIX,
  VALIDATOR_PREFIX,
  validateAddress,
  type AddressCheck,
  type AddressErrorCode,
  type AddressKind,
  type InvalidAddress,
  type ValidAddress,
  type ValidateAddressOptions,
} from "./address.js";
export {
  KNOWN_MESSAGES,
  PQC_HYBRID_TYPE_URL,
  decodeMessage,
  decodeTx,
  type Coin,
  type DecodedMessage,
  type DecodedSigner,
  type DecodedTx,
  type PqcLayerSummary,
} from "./decode.js";
export { verifyTx, type VerifyTxArgs, type VerifyTxResult } from "./verify.js";
export {
  FEE_COLLECTOR,
  MSG_ETHEREUM_TX,
  MSG_MULTI_SEND,
  MSG_SEND,
  buildDepositQuery,
  depositEventQuery,
  extractDeposits,
  percentEncode,
  type DepositEntry,
  type DepositQueryOptions,
} from "./deposits.js";
export { fromHex, toHex } from "./proto.js";
export { DEFAULT_TESTNET_REST, getJson } from "./rest.js";
