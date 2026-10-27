// SPDX-License-Identifier: Apache-2.0
package io.github.qorechain.custodykit;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.util.Arrays;
import java.util.Base64;
import java.util.EnumSet;
import java.util.List;

/**
 * Example command line over the kit.
 *
 * <pre>
 *   validate &lt;address&gt; [--allow-validator] [--require-eip55]
 *   decode &lt;tx hex or base64&gt;
 *   verify &lt;tx hex or base64&gt; --chain-id ID --account-number N --pubkey HEX [--eth] [--pq-pubkey HEX]
 *   deposits &lt;address&gt; [--from-height H] [--to-height H] [--rest URL]
 * </pre>
 */
public final class Cli {
    private static final Gson GSON = new GsonBuilder().setPrettyPrinting().serializeNulls().create();

    private Cli() {}

    private static String flag(List<String> args, String name) {
        int i = args.indexOf(name);
        return i >= 0 && i + 1 < args.size() ? args.get(i + 1) : null;
    }

    private static byte[] txBytes(String s) {
        return s.matches("(0x)?[0-9a-fA-F]+") ? Proto.fromHex(s) : Base64.getDecoder().decode(s);
    }

    private static void print(JsonElement e) {
        System.out.println(GSON.toJson(e));
    }

    static int run(String[] argv) throws Exception {
        if (argv.length < 2) {
            System.err.println("usage: validate|decode|verify|deposits <arg> [options]");
            return 2;
        }
        String cmd = argv[0];
        String arg = argv[1];
        List<String> rest = Arrays.asList(argv).subList(2, argv.length);
        switch (cmd) {
            case "validate" -> {
                Addresses.AddressCheck r = Addresses.validateAddress(arg, new Addresses.ValidateOptions(
                        rest.contains("--allow-validator")
                                ? EnumSet.of(Addresses.AddressKind.ACCOUNT, Addresses.AddressKind.VALIDATOR)
                                : EnumSet.of(Addresses.AddressKind.ACCOUNT),
                        rest.contains("--require-eip55")));
                print(r.toJson());
                return r.valid() ? 0 : 1;
            }
            case "decode" -> {
                print(TxDecoder.decodeTx(txBytes(arg)));
                return 0;
            }
            case "verify" -> {
                String pq = flag(rest, "--pq-pubkey");
                String chainId = flag(rest, "--chain-id");
                String accountNumber = flag(rest, "--account-number");
                String pubkey = flag(rest, "--pubkey");
                TxVerifier.VerifyTxResult r = TxVerifier.verifyTx(new TxVerifier.VerifyTxArgs(
                        txBytes(arg),
                        chainId == null ? "" : chainId,
                        Long.parseUnsignedLong(accountNumber == null ? "0" : accountNumber),
                        Proto.fromHex(pubkey == null ? "" : pubkey),
                        rest.contains("--eth"),
                        pq == null ? null : Proto.fromHex(pq),
                        "v2"));
                print(r.toJson());
                return r.valid() ? 0 : 1;
            }
            case "deposits" -> {
                String restUrl = flag(rest, "--rest");
                if (restUrl == null) restUrl = System.getenv("QORE_REST");
                if (restUrl == null) restUrl = Rest.DEFAULT_TESTNET_REST;
                String from = flag(rest, "--from-height");
                String to = flag(rest, "--to-height");
                String path = Deposits.buildDepositQuery(new Deposits.DepositQueryOptions(
                        arg,
                        from == null ? null : Long.parseLong(from),
                        to == null ? null : Long.parseLong(to),
                        null, null, null, null));
                JsonObject body = Rest.getJson(restUrl, path);
                JsonArray out = new JsonArray();
                if (body.has("tx_responses") && body.get("tx_responses").isJsonArray()) {
                    for (JsonElement r : body.getAsJsonArray("tx_responses")) {
                        out.addAll(Deposits.toJson(Deposits.extractDeposits(r.getAsJsonObject(), arg)));
                    }
                }
                print(out);
                return 0;
            }
            default -> {
                System.err.println("unknown command " + cmd);
                return 2;
            }
        }
    }

    public static void main(String[] argv) {
        int code;
        try {
            code = run(argv);
        } catch (Exception e) {
            System.err.println(e.getMessage());
            code = 1;
        }
        System.exit(code);
    }
}
