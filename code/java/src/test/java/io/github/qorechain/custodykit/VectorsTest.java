// SPDX-License-Identifier: Apache-2.0
package io.github.qorechain.custodykit;

import static org.testng.Assert.assertEquals;
import static org.testng.Assert.assertFalse;
import static org.testng.Assert.fail;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import org.testng.SkipException;
import org.testng.annotations.DataProvider;
import org.testng.annotations.Test;

/**
 * Checks the Java port against vectors/custody-v1.json and, when it has been fetched
 * (scripts/fetch-qoresign-vectors.sh), against the hybrid transactions of
 * vectors/qoresign-v1.json.
 */
public class VectorsTest {
    static final Path VECTORS = Path.of(System.getProperty("custodykit.vectors", "../../vectors"));
    static final JsonObject V = load("custody-v1.json");

    static JsonObject load(String name) {
        try {
            return JsonParser.parseString(Files.readString(VECTORS.resolve(name))).getAsJsonObject();
        } catch (IOException e) {
            throw new IllegalStateException(e);
        }
    }

    private static Object[][] rows(JsonArray a) {
        Object[][] out = new Object[a.size()][];
        for (int i = 0; i < a.size(); i++) out[i] = new Object[] {a.get(i).getAsJsonObject()};
        return out;
    }

    private static String strOr(JsonObject o, String key, String fallback) {
        return o.has(key) && !o.get(key).isJsonNull() ? o.get(key).getAsString() : fallback;
    }

    private static Addresses.ValidateOptions options(JsonObject c) {
        Set<Addresses.AddressKind> allow = EnumSet.of(Addresses.AddressKind.ACCOUNT);
        if (c.has("allow")) {
            allow = EnumSet.noneOf(Addresses.AddressKind.class);
            for (JsonElement k : c.getAsJsonArray("allow")) {
                allow.add(k.getAsString().equals("account")
                        ? Addresses.AddressKind.ACCOUNT
                        : Addresses.AddressKind.VALIDATOR);
            }
        }
        boolean requireEip55 = c.has("requireEip55") && c.get("requireEip55").getAsBoolean();
        return new Addresses.ValidateOptions(allow, requireEip55);
    }

    private static String codeOf(Runnable r) {
        try {
            r.run();
        } catch (CustodyKitException e) {
            return e.getCode();
        }
        return "NO_ERROR";
    }

    @DataProvider
    public Object[][] validAddresses() {
        return rows(V.getAsJsonObject("addresses").getAsJsonArray("valid"));
    }

    @Test(dataProvider = "validAddresses")
    public void acceptsAddress(JsonObject c) {
        JsonObject expected = c.getAsJsonObject("expected").deepCopy();
        expected.addProperty("valid", true);
        assertEquals(Addresses.validateAddress(c.get("input").getAsString(), options(c)).toJson(), expected);
    }

    @DataProvider
    public Object[][] invalidAddresses() {
        return rows(V.getAsJsonObject("addresses").getAsJsonArray("invalid"));
    }

    @Test(dataProvider = "invalidAddresses")
    public void refusesAddress(JsonObject c) {
        Addresses.AddressCheck r = Addresses.validateAddress(c.get("input").getAsString(), options(c));
        assertFalse(r.valid());
        assertEquals(r.error(), c.get("error").getAsString());
    }

    @DataProvider
    public Object[][] transactions() {
        return rows(V.getAsJsonArray("transactions"));
    }

    @Test(dataProvider = "transactions")
    public void decodesTransaction(JsonObject t) {
        assertEquals(TxDecoder.decodeTx(Proto.fromHex(t.get("txBytes").getAsString())), t.get("decoded"));
    }

    @DataProvider
    public Object[][] verifyCases() {
        List<Object[]> out = new ArrayList<>();
        for (JsonElement t : V.getAsJsonArray("transactions")) {
            for (JsonElement c : t.getAsJsonObject().getAsJsonArray("verifyCases")) {
                out.add(new Object[] {t.getAsJsonObject(), c.getAsJsonObject()});
            }
        }
        return out.toArray(new Object[0][]);
    }

    @Test(dataProvider = "verifyCases")
    public void verifiesTransaction(JsonObject t, JsonObject c) {
        boolean omitPq = c.has("omitPqPublicKey") && c.get("omitPqPublicKey").getAsBoolean();
        long accountNumber = c.has("accountNumber") ? c.get("accountNumber").getAsLong() : t.get("accountNumber").getAsLong();
        TxVerifier.VerifyTxResult r = TxVerifier.verifyTx(new TxVerifier.VerifyTxArgs(
                Proto.fromHex(t.get("txBytes").getAsString()),
                strOr(c, "chainId", t.get("chainId").getAsString()),
                accountNumber,
                Proto.fromHex(strOr(c, "classicalPublicKey", t.get("classicalPublicKey").getAsString())),
                strOr(c, "classicalKeyType", t.get("classicalKeyType").getAsString()).equals("eth_secp256k1"),
                omitPq ? null : Proto.fromHex(strOr(c, "pqPublicKey", t.get("pqPublicKey").getAsString())),
                null));
        assertEquals(r.toJson(), c.get("expected"), c.get("description").getAsString());
    }

    @DataProvider
    public Object[][] messages() {
        return rows(V.getAsJsonArray("messages"));
    }

    @Test(dataProvider = "messages")
    public void decodesMessage(JsonObject m) {
        assertEquals(
                TxDecoder.decodeMessage(m.get("typeUrl").getAsString(), Proto.fromHex(m.get("value").getAsString())),
                m.get("decoded"));
    }

    @DataProvider
    public Object[][] malformed() {
        return rows(V.getAsJsonArray("malformed"));
    }

    @Test(dataProvider = "malformed")
    public void refusesMalformed(JsonObject m) {
        byte[] tx = Proto.fromHex(m.get("txBytes").getAsString());
        assertEquals(codeOf(() -> TxDecoder.decodeTx(tx)), m.get("error").getAsString(), m.get("name").getAsString());
    }

    private static Deposits.DepositQueryOptions queryOptions(JsonObject o) {
        return new Deposits.DepositQueryOptions(
                o.get("address").getAsString(),
                o.has("minHeight") ? o.get("minHeight").getAsLong() : null,
                o.has("maxHeight") ? o.get("maxHeight").getAsLong() : null,
                strOr(o, "event", null),
                o.has("page") ? o.get("page").getAsInt() : null,
                o.has("limit") ? o.get("limit").getAsInt() : null,
                strOr(o, "orderBy", null));
    }

    @DataProvider
    public Object[][] depositQueries() {
        return rows(V.getAsJsonArray("depositQueries"));
    }

    @Test(dataProvider = "depositQueries")
    public void buildsDepositQuery(JsonObject q) {
        assertEquals(Deposits.buildDepositQuery(queryOptions(q.getAsJsonObject("options"))), q.get("expected").getAsString());
    }

    @DataProvider
    public Object[][] depositQueryErrors() {
        return rows(V.getAsJsonArray("depositQueryErrors"));
    }

    @Test(dataProvider = "depositQueryErrors")
    public void refusesDepositQuery(JsonObject q) {
        Deposits.DepositQueryOptions opts = queryOptions(q.getAsJsonObject("options"));
        assertEquals(codeOf(() -> Deposits.buildDepositQuery(opts)), q.get("error").getAsString());
    }

    @DataProvider
    public Object[][] deposits() {
        return rows(V.getAsJsonArray("deposits"));
    }

    @Test(dataProvider = "deposits")
    public void extractsDeposits(JsonObject d) {
        List<Deposits.DepositEntry> entries = Deposits.extractDeposits(
                d.getAsJsonObject("txResponse"), d.get("address").getAsString(), strOr(d, "denom", "uqor"));
        assertEquals(Deposits.toJson(entries), d.get("expected"), d.get("name").getAsString());
    }

    @Test
    public void verifiesQoreSignHybridVectors() {
        if (!Files.exists(VECTORS.resolve("qoresign-v1.json"))) {
            throw new SkipException("vectors/qoresign-v1.json not fetched (scripts/fetch-qoresign-vectors.sh)");
        }
        JsonObject q = load("qoresign-v1.json");
        JsonObject hybrid = q.getAsJsonObject("hybridTx");
        for (JsonElement e : hybrid.getAsJsonArray("cases")) {
            JsonObject c = e.getAsJsonObject();
            TxVerifier.VerifyTxResult r = TxVerifier.verifyTx(new TxVerifier.VerifyTxArgs(
                    Proto.fromHex(c.get("txBytes").getAsString()),
                    q.get("chainId").getAsString(),
                    hybrid.get("accountNumber").getAsLong(),
                    Proto.fromHex(q.getAsJsonObject("accounts").getAsJsonObject("secp256k1").get("publicKey").getAsString()),
                    false,
                    Proto.fromHex(q.getAsJsonArray("canonical").get(0).getAsJsonObject().get("publicKey").getAsString()),
                    "either"));
            JsonObject expected = JsonParser.parseString(
                    "{\"valid\":true,\"classical\":true,\"signerKey\":\"match\",\"pq\":{\"valid\":true,\"signBytesVersion\":\""
                            + c.get("signBytesVersion").getAsString() + "\",\"reason\":null}}").getAsJsonObject();
            assertEquals(r.toJson(), expected);
        }
    }

    @Test
    public void invalidHexArgument() {
        if (!codeOf(() -> Proto.fromHex("zz")).equals("INVALID_ARGUMENT")) fail("fromHex should refuse non-hex");
    }
}
