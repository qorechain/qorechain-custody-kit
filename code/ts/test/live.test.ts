// SPDX-License-Identifier: Apache-2.0
//
// Read-only checks against the testnet. Run with QORE_LIVE_TEST=1; QORE_REST
// overrides the endpoint (default https://api-testnet.qore.host).

import { describe, expect, it } from "vitest";

import {
  DEFAULT_TESTNET_REST,
  buildDepositQuery,
  decodeTx,
  extractDeposits,
  getJson,
  percentEncode,
  verifyTx,
} from "../src/index.js";

// Derived from the public BIP-39 test mnemonic (vectors/custody-v1.json); its
// ML-DSA-87 key is registered on the testnet and anyone may use it there.
const PUBLIC_TEST_ACCOUNT = "qor19rl4cm2hmr8afy4kldpxz3fka4jguq0agt672h";

const live = process.env.QORE_LIVE_TEST === "1";
const REST = process.env.QORE_REST ?? DEFAULT_TESTNET_REST;

describe.skipIf(!live)("testnet (live)", () => {
  it("reads the staking and staking tier parameters", async () => {
    const staking = (await getJson(REST, "/cosmos/staking/v1beta1/params")).params as Record<string, unknown>;
    expect(staking.bond_denom).toBe("uqor");
    expect(staking.unbonding_time).toBe("1814400s"); // 21 days
    const tier = await getJson(REST, "/qorechain/stakingtier/v1/params");
    expect(tier.enabled).toBe(true);
    expect((tier.lock_tiers as { months: number }[]).map((t) => t.months)).toEqual([3, 6, 12]);
  });

  it("finds a recent uqor transfer through the deposit query", async () => {
    const recent = await getJson(
      REST,
      `/cosmos/tx/v1beta1/txs?query=${percentEncode("message.action='/cosmos.bank.v1beta1.MsgSend'")}&order_by=ORDER_BY_DESC&limit=20`,
    );
    type Resp = { txhash: string; height: string; code: number; tx: { body: { messages: Record<string, unknown>[] } } };
    let target: { resp: Resp; to: string; amount: bigint } | undefined;
    for (const resp of (recent.tx_responses ?? []) as Resp[]) {
      const msg = resp.tx.body.messages[0]!;
      const coins = (msg.amount ?? []) as { denom: string; amount: string }[];
      const uqor = coins.filter((c) => c.denom === "uqor").reduce((s, c) => s + BigInt(c.amount), 0n);
      if (resp.code === 0 && resp.tx.body.messages.length === 1 && uqor > 0n && msg.from_address !== msg.to_address) {
        target = { resp, to: String(msg.to_address), amount: uqor };
        break;
      }
    }
    expect(target, "no recent MsgSend of uqor on the testnet").toBeDefined();
    const path = buildDepositQuery({ address: target!.to, minHeight: BigInt(target!.resp.height), maxHeight: BigInt(target!.resp.height) });
    const body = await getJson(REST, path);
    const entries = ((body.tx_responses ?? []) as Record<string, unknown>[]).flatMap((r) => extractDeposits(r, target!.to));
    const hit = entries.find((e) => e.txhash === target!.resp.txhash);
    expect(hit).toMatchObject({ creditable: true, messageType: "/cosmos.bank.v1beta1.MsgSend", amount: target!.amount.toString() });
  });

  it("verifies a committed hybrid transaction of the public test account", async () => {
    const found = await getJson(
      REST,
      `/cosmos/tx/v1beta1/txs?query=${percentEncode(`message.sender='${PUBLIC_TEST_ACCOUNT}'`)}&order_by=ORDER_BY_DESC&limit=1`,
    );
    const resp = ((found.tx_responses ?? []) as { txhash: string; height: string }[])[0];
    if (!resp) return; // the account has not transacted on this network
    const block = await getJson(REST, `/cosmos/base/tendermint/v1beta1/blocks/${resp.height}`);
    const txs = ((block.block as { data: { txs: string[] } }).data.txs ?? []).map((b) => Uint8Array.from(Buffer.from(b, "base64")));
    const txBytes = txs.find((b) => {
      try {
        return decodeTx(b).txHash === resp.txhash;
      } catch {
        return false; // another transaction in the block that the kit does not decode
      }
    });
    expect(txBytes).toBeDefined();
    const info = (await getJson(REST, `/cosmos/auth/v1beta1/account_info/${PUBLIC_TEST_ACCOUNT}`)).info as {
      account_number: string;
      pub_key: { key: string };
    };
    const pqc = (await getJson(REST, `/qorechain/pqc/v1/account/${PUBLIC_TEST_ACCOUNT}`)).account as { public_key: string };
    const chainId = ((await getJson(REST, "/cosmos/base/tendermint/v1beta1/node_info")).default_node_info as { network: string }).network;
    const r = verifyTx({
      txBytes: txBytes!,
      chainId,
      accountNumber: BigInt(info.account_number),
      classicalPublicKey: Uint8Array.from(Buffer.from(info.pub_key.key, "base64")),
      pqPublicKey: Uint8Array.from(Buffer.from(pqc.public_key, "base64")),
    });
    expect(r).toEqual({ valid: true, classical: true, signerKey: "match", pq: { valid: true, signBytesVersion: "v2", reason: null } });
  });
});
