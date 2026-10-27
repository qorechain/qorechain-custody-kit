#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// Example command line over the kit:
//
//   custody-kit validate <address> [--allow-validator] [--require-eip55]
//   custody-kit decode <tx hex or base64>
//   custody-kit verify <tx hex or base64> --chain-id ID --account-number N
//                      --pubkey HEX [--eth] [--pq-pubkey HEX]
//   custody-kit deposits <address> [--from-height H] [--to-height H] [--rest URL]

import { validateAddress } from "./address.js";
import { decodeTx } from "./decode.js";
import { buildDepositQuery, extractDeposits } from "./deposits.js";
import { fromHex } from "./proto.js";
import { DEFAULT_TESTNET_REST, getJson } from "./rest.js";
import { verifyTx } from "./verify.js";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function txBytesFrom(s: string): Uint8Array {
  return /^(0x)?[0-9a-fA-F]+$/.test(s) ? fromHex(s) : Uint8Array.from(Buffer.from(s, "base64"));
}

const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));

async function main(argv: string[]): Promise<number> {
  const [cmd, arg, ...rest] = argv;
  if (!cmd || !arg) {
    console.error("usage: custody-kit validate|decode|verify|deposits <arg> [options]");
    return 2;
  }
  switch (cmd) {
    case "validate": {
      const r = validateAddress(arg, {
        allow: rest.includes("--allow-validator") ? ["account", "validator"] : ["account"],
        requireEip55: rest.includes("--require-eip55"),
      });
      print(r);
      return r.valid ? 0 : 1;
    }
    case "decode":
      print(decodeTx(txBytesFrom(arg)));
      return 0;
    case "verify": {
      const r = verifyTx({
        txBytes: txBytesFrom(arg),
        chainId: flag(rest, "--chain-id") ?? "",
        accountNumber: BigInt(flag(rest, "--account-number") ?? "0"),
        classicalPublicKey: fromHex(flag(rest, "--pubkey") ?? ""),
        classicalKeyType: rest.includes("--eth") ? "eth_secp256k1" : "secp256k1",
        pqPublicKey: flag(rest, "--pq-pubkey") ? fromHex(flag(rest, "--pq-pubkey")!) : undefined,
      });
      print(r);
      return r.valid ? 0 : 1;
    }
    case "deposits": {
      const restUrl = flag(rest, "--rest") ?? process.env.QORE_REST ?? DEFAULT_TESTNET_REST;
      const from = flag(rest, "--from-height");
      const to = flag(rest, "--to-height");
      const path = buildDepositQuery({
        address: arg,
        minHeight: from ? BigInt(from) : undefined,
        maxHeight: to ? BigInt(to) : undefined,
      });
      const body = await getJson(restUrl, path);
      const responses = (body.tx_responses ?? []) as Record<string, unknown>[];
      print(responses.flatMap((r) => extractDeposits(r, arg)));
      return 0;
    }
    default:
      console.error(`unknown command ${cmd}`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
