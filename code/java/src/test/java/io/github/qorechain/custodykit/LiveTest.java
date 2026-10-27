// SPDX-License-Identifier: Apache-2.0
package io.github.qorechain.custodykit;

import static org.testng.Assert.assertEquals;
import static org.testng.Assert.assertNotNull;
import static org.testng.Assert.assertTrue;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.List;
import org.testng.SkipException;
import org.testng.annotations.BeforeMethod;
import org.testng.annotations.Test;

/**
 * Read-only checks against the testnet. Run with QORE_LIVE_TEST=1; QORE_REST overrides the
 * endpoint (default https://api-testnet.qore.host).
 */
public class LiveTest {
    private static final String REST =
            System.getenv("QORE_REST") != null ? System.getenv("QORE_REST") : Rest.DEFAULT_TESTNET_REST;

    @BeforeMethod
    public void onlyWhenLive() {
        if (!"1".equals(System.getenv("QORE_LIVE_TEST"))) throw new SkipException("set QORE_LIVE_TEST=1");
    }

    @Test
    public void readsStakingParameters() throws Exception {
        JsonObject staking = Rest.getJson(REST, "/cosmos/staking/v1beta1/params").getAsJsonObject("params");
        assertEquals(staking.get("bond_denom").getAsString(), "uqor");
        assertEquals(staking.get("unbonding_time").getAsString(), "1814400s"); // 21 days
        JsonObject tier = Rest.getJson(REST, "/qorechain/stakingtier/v1/params");
        assertTrue(tier.get("enabled").getAsBoolean());
        List<Integer> months = new ArrayList<>();
        for (JsonElement t : tier.getAsJsonArray("lock_tiers")) months.add(t.getAsJsonObject().get("months").getAsInt());
        assertEquals(months, List.of(3, 6, 12));
    }

    @Test
    public void findsRecentTransferThroughDepositQuery() throws Exception {
        JsonObject recent = Rest.getJson(REST, "/cosmos/tx/v1beta1/txs?query="
                + Deposits.percentEncode("message.action='/cosmos.bank.v1beta1.MsgSend'")
                + "&order_by=ORDER_BY_DESC&limit=20");
        JsonObject target = null;
        String to = null;
        BigInteger amount = BigInteger.ZERO;
        for (JsonElement e : recent.getAsJsonArray("tx_responses")) {
            JsonObject resp = e.getAsJsonObject();
            JsonArray msgs = resp.getAsJsonObject("tx").getAsJsonObject("body").getAsJsonArray("messages");
            JsonObject msg = msgs.get(0).getAsJsonObject();
            BigInteger uqor = BigInteger.ZERO;
            for (JsonElement c : msg.getAsJsonArray("amount")) {
                if (c.getAsJsonObject().get("denom").getAsString().equals("uqor")) {
                    uqor = uqor.add(new BigInteger(c.getAsJsonObject().get("amount").getAsString()));
                }
            }
            boolean selfSend = msg.get("from_address").getAsString().equals(msg.get("to_address").getAsString());
            if (resp.get("code").getAsInt() == 0 && msgs.size() == 1 && uqor.signum() > 0 && !selfSend) {
                target = resp;
                to = msg.get("to_address").getAsString();
                amount = uqor;
                break;
            }
        }
        assertNotNull(target, "no recent MsgSend of uqor on the testnet");
        long height = Long.parseLong(target.get("height").getAsString());
        String path = Deposits.buildDepositQuery(
                new Deposits.DepositQueryOptions(to, height, height, null, null, null, null));
        JsonObject body = Rest.getJson(REST, path);
        Deposits.DepositEntry hit = null;
        for (JsonElement r : body.getAsJsonArray("tx_responses")) {
            for (Deposits.DepositEntry d : Deposits.extractDeposits(r.getAsJsonObject(), to)) {
                if (d.txhash().equals(target.get("txhash").getAsString())) hit = d;
            }
        }
        assertNotNull(hit);
        assertTrue(hit.creditable());
        assertEquals(hit.messageType(), Deposits.MSG_SEND);
        assertEquals(hit.amount(), amount.toString());
    }
}
