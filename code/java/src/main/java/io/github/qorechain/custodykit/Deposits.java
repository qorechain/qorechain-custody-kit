// SPDX-License-Identifier: Apache-2.0
package io.github.qorechain.custodykit;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Deposit detection over the REST API: a query builder for incoming transfers to an address, and
 * a parser that turns one {@code tx_response} into candidate deposits with a credit decision.
 */
public final class Deposits {
    /** Fee collector module account (same address on both networks). Fees and EVM gas refunds move through it. */
    public static final String FEE_COLLECTOR = "qor17xpfvakm2amg962yls6f84z3kell8c5lyj5r7l";

    public static final String MSG_SEND = "/cosmos.bank.v1beta1.MsgSend";
    public static final String MSG_MULTI_SEND = "/cosmos.bank.v1beta1.MsgMultiSend";
    public static final String MSG_ETHEREUM_TX = "/cosmos.evm.vm.v1.MsgEthereumTx";

    /**
     * Options of {@link #buildDepositQuery}. Null fields take their defaults.
     *
     * @param address {@code qor1...} or {@code 0x...} account address
     * @param minHeight inclusive lower bound on the block height
     * @param maxHeight inclusive upper bound on the block height
     * @param event {@code transfer} (default, matches {@code transfer.recipient}) or {@code
     *     coin_received} (matches {@code coin_received.receiver})
     * @param page 1-based page, default 1
     * @param limit 1 to 100, default 50
     * @param orderBy {@code asc} (default, oldest first) or {@code desc}
     */
    public record DepositQueryOptions(
            String address, Long minHeight, Long maxHeight, String event, Integer page, Integer limit, String orderBy) {

        public static DepositQueryOptions of(String address) {
            return new DepositQueryOptions(address, null, null, null, null, null, null);
        }
    }

    /**
     * One incoming transfer.
     *
     * @param amount integer amount in the base denom
     * @param creditable true when the kit's rules consider this a deposit to credit
     * @param reason {@code evm_failed}, {@code fee_refund} or {@code unsupported_message}; null
     *     when creditable
     */
    public record DepositEntry(
            String txhash,
            String height,
            int msgIndex,
            String messageType,
            String sender,
            String amount,
            String denom,
            String memo,
            boolean creditable,
            String reason) {

        /** The same JSON shape as the other languages of the kit. */
        public JsonObject toJson() {
            JsonObject o = new JsonObject();
            o.addProperty("txhash", txhash);
            o.addProperty("height", height);
            o.addProperty("msgIndex", msgIndex);
            o.addProperty("messageType", messageType);
            o.addProperty("sender", sender);
            o.addProperty("amount", amount);
            o.addProperty("denom", denom);
            o.addProperty("memo", memo);
            o.addProperty("creditable", creditable);
            o.addProperty("reason", reason);
            return o;
        }
    }

    private Deposits() {}

    /** RFC 3986 percent-encoding: everything except unreserved characters. */
    public static String percentEncode(String s) {
        StringBuilder out = new StringBuilder();
        for (byte b : s.getBytes(StandardCharsets.UTF_8)) {
            int c = b & 0xff;
            if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')
                    || c == '-' || c == '.' || c == '_' || c == '~') {
                out.append((char) c);
            } else {
                out.append('%').append(String.format("%02X", c));
            }
        }
        return out.toString();
    }

    private static String accountBech32(String address) {
        Addresses.AddressCheck check = Addresses.validateAddress(address);
        if (!check.valid()) {
            throw new CustodyKitException("INVALID_ARGUMENT", "deposit address: " + check.error());
        }
        return check.bech32();
    }

    private static long nonNegative(String name, long v) {
        if (v < 0) throw new CustodyKitException("INVALID_ARGUMENT", name + " must not be negative");
        return v;
    }

    /**
     * The events query, for example {@code transfer.recipient='qor1...' AND tx.height>=100 AND
     * tx.height<=200}.
     */
    public static String depositEventQuery(DepositQueryOptions opts) {
        String bech32 = accountBech32(opts.address());
        String event = opts.event() == null ? "transfer" : opts.event();
        String key = event.equals("transfer") ? "transfer.recipient" : "coin_received.receiver";
        List<String> parts = new ArrayList<>();
        parts.add(key + "='" + bech32 + "'");
        if (opts.minHeight() != null) parts.add("tx.height>=" + nonNegative("minHeight", opts.minHeight()));
        if (opts.maxHeight() != null) parts.add("tx.height<=" + nonNegative("maxHeight", opts.maxHeight()));
        return String.join(" AND ", parts);
    }

    /** Path and query string for {@code GET /cosmos/tx/v1beta1/txs}. Append it to a REST base URL. */
    public static String buildDepositQuery(DepositQueryOptions opts) {
        int page = opts.page() == null ? 1 : opts.page();
        int limit = opts.limit() == null ? 50 : opts.limit();
        if (page < 1) throw new CustodyKitException("INVALID_ARGUMENT", "page must be 1 or more");
        if (limit < 1 || limit > 100) {
            throw new CustodyKitException("INVALID_ARGUMENT", "limit must be between 1 and 100");
        }
        String order = (opts.orderBy() == null || opts.orderBy().equals("asc")) ? "ORDER_BY_ASC" : "ORDER_BY_DESC";
        return "/cosmos/tx/v1beta1/txs?query=" + percentEncode(depositEventQuery(opts))
                + "&order_by=" + order + "&page=" + page + "&limit=" + limit;
    }

    private static String attr(JsonObject ev, String key) {
        JsonElement attrs = ev.get("attributes");
        if (attrs == null || !attrs.isJsonArray()) return null;
        for (JsonElement a : attrs.getAsJsonArray()) {
            JsonObject o = a.getAsJsonObject();
            if (o.has("key") && o.get("key").getAsString().equals(key)) {
                JsonElement v = o.get("value");
                return v == null || v.isJsonNull() ? null : v.getAsString();
            }
        }
        return null;
    }

    private static final Pattern COIN = Pattern.compile("^(\\d+)(.+)$");

    private static BigInteger sumDenom(String amounts, String denom) {
        BigInteger total = null;
        for (String part : amounts.split(",", -1)) {
            Matcher m = COIN.matcher(part.strip());
            if (m.matches() && m.group(2).equals(denom)) {
                total = (total == null ? BigInteger.ZERO : total).add(new BigInteger(m.group(1)));
            }
        }
        return total;
    }

    private static String str(JsonObject o, String key, String fallback) {
        JsonElement e = o.get(key);
        return e == null || e.isJsonNull() ? fallback : e.getAsString();
    }

    /**
     * Incoming transfers of {@code denom} to {@code address} in one {@code tx_response} (as
     * returned by {@code GET /cosmos/tx/v1beta1/txs} or {@code /txs/{hash}}), with a credit
     * decision for each.
     *
     * <ul>
     *   <li>A failed transaction ({@code code != 0}) gives nothing.</li>
     *   <li>Transfers without a {@code msg_index} (fee payment) are ignored.</li>
     *   <li>{@code MsgSend} and {@code MsgMultiSend} outputs are creditable.</li>
     *   <li>{@code MsgEthereumTx} is creditable unless the EVM execution failed ({@code
     *       ethereumTxFailed}) or the transfer is a gas refund from the fee collector.</li>
     *   <li>Any other message (rewards, contract calls, IBC) is returned with {@code creditable =
     *       false}, {@code reason = "unsupported_message"}, for review.</li>
     * </ul>
     */
    public static List<DepositEntry> extractDeposits(JsonObject txResponse, String address, String denom) {
        String bech32 = accountBech32(address);
        String d = denom == null ? "uqor" : denom;
        List<DepositEntry> out = new ArrayList<>();
        JsonElement code = txResponse.get("code");
        if (code != null && !code.isJsonNull() && code.getAsLong() != 0) return out;

        JsonArray messages = new JsonArray();
        String memo = "";
        JsonElement tx = txResponse.get("tx");
        if (tx != null && tx.isJsonObject()) {
            JsonElement body = tx.getAsJsonObject().get("body");
            if (body != null && body.isJsonObject()) {
                JsonObject b = body.getAsJsonObject();
                if (b.has("messages") && b.get("messages").isJsonArray()) messages = b.getAsJsonArray("messages");
                memo = str(b, "memo", "");
            }
        }
        JsonArray events = txResponse.has("events") && txResponse.get("events").isJsonArray()
                ? txResponse.getAsJsonArray("events")
                : new JsonArray();

        Set<String> failedEvm = new HashSet<>();
        for (JsonElement e : events) {
            JsonObject ev = e.getAsJsonObject();
            if (str(ev, "type", "").equals("ethereum_tx") && attr(ev, "ethereumTxFailed") != null) {
                String idx = attr(ev, "msg_index");
                failedEvm.add(idx == null ? "" : idx);
            }
        }

        for (JsonElement e : events) {
            JsonObject ev = e.getAsJsonObject();
            if (!str(ev, "type", "").equals("transfer")) continue;
            if (!bech32.equals(attr(ev, "recipient"))) continue;
            String idx = attr(ev, "msg_index");
            if (idx == null || !idx.matches("\\d+")) continue;
            String amounts = attr(ev, "amount");
            BigInteger amount = sumDenom(amounts == null ? "" : amounts, d);
            if (amount == null) continue;
            int msgIndex = Integer.parseInt(idx);
            String messageType = "";
            if (msgIndex < messages.size() && messages.get(msgIndex).isJsonObject()) {
                messageType = str(messages.get(msgIndex).getAsJsonObject(), "@type", "");
            }
            String sender = attr(ev, "sender");
            if (sender == null) sender = "";
            String reason = null;
            if (messageType.equals(MSG_ETHEREUM_TX) && failedEvm.contains(idx)) reason = "evm_failed";
            else if (sender.equals(FEE_COLLECTOR)) reason = "fee_refund";
            else if (!messageType.equals(MSG_SEND) && !messageType.equals(MSG_MULTI_SEND)
                    && !messageType.equals(MSG_ETHEREUM_TX)) reason = "unsupported_message";
            out.add(new DepositEntry(
                    str(txResponse, "txhash", ""),
                    str(txResponse, "height", ""),
                    msgIndex,
                    messageType,
                    sender,
                    amount.toString(),
                    d,
                    memo,
                    reason == null,
                    reason));
        }
        return out;
    }

    /** {@link #extractDeposits(JsonObject, String, String)} for {@code uqor}. */
    public static List<DepositEntry> extractDeposits(JsonObject txResponse, String address) {
        return extractDeposits(txResponse, address, "uqor");
    }

    /** The entries as a JSON array. */
    public static JsonArray toJson(List<DepositEntry> entries) {
        JsonArray a = new JsonArray();
        for (DepositEntry e : entries) a.add(e.toJson());
        return a;
    }
}
