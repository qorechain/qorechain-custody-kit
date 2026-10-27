// SPDX-License-Identifier: Apache-2.0
package io.github.qorechain.custodykit;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.google.gson.JsonPrimitive;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * Decode a signed native-lane transaction ({@code TxRaw}) into what a custody operator reviews
 * before broadcasting: the messages and their fields, the fee, the signer, and whether the
 * ML-DSA-87 layer is present. Results are Gson objects with the same shape as the other
 * languages of the kit.
 */
public final class TxDecoder {
    public static final String PQC_HYBRID_TYPE_URL = "/qorechain.pqc.v1.PQCHybridSignature";

    private enum Kind { STRING, UINT, BOOL, BYTES, COIN, COINS, STRINGS, IO }

    private record Spec(int num, String name, Kind kind) {}

    private static final List<Spec> DELEGATION = List.of(
            new Spec(1, "delegator_address", Kind.STRING),
            new Spec(2, "validator_address", Kind.STRING),
            new Spec(3, "amount", Kind.COIN));

    /** Field layouts of the message types a custodian handles. */
    private static final Map<String, List<Spec>> KNOWN_MESSAGES = Map.ofEntries(
            Map.entry("/cosmos.bank.v1beta1.MsgSend", List.of(
                    new Spec(1, "from_address", Kind.STRING),
                    new Spec(2, "to_address", Kind.STRING),
                    new Spec(3, "amount", Kind.COINS))),
            Map.entry("/cosmos.bank.v1beta1.MsgMultiSend", List.of(
                    new Spec(1, "inputs", Kind.IO),
                    new Spec(2, "outputs", Kind.IO))),
            Map.entry("/cosmos.staking.v1beta1.MsgDelegate", DELEGATION),
            Map.entry("/cosmos.staking.v1beta1.MsgUndelegate", DELEGATION),
            Map.entry("/cosmos.staking.v1beta1.MsgBeginRedelegate", List.of(
                    new Spec(1, "delegator_address", Kind.STRING),
                    new Spec(2, "validator_src_address", Kind.STRING),
                    new Spec(3, "validator_dst_address", Kind.STRING),
                    new Spec(4, "amount", Kind.COIN))),
            Map.entry("/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation", List.of(
                    new Spec(1, "delegator_address", Kind.STRING),
                    new Spec(2, "validator_address", Kind.STRING),
                    new Spec(3, "amount", Kind.COIN),
                    new Spec(4, "creation_height", Kind.UINT))),
            Map.entry("/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward", List.of(
                    new Spec(1, "delegator_address", Kind.STRING),
                    new Spec(2, "validator_address", Kind.STRING))),
            Map.entry("/cosmos.distribution.v1beta1.MsgSetWithdrawAddress", List.of(
                    new Spec(1, "delegator_address", Kind.STRING),
                    new Spec(2, "withdraw_address", Kind.STRING))),
            Map.entry("/qorechain.stakingtier.v1.MsgLockDelegation", List.of(
                    new Spec(1, "delegator", Kind.STRING),
                    new Spec(2, "validator", Kind.STRING),
                    new Spec(3, "amount", Kind.STRING),
                    new Spec(4, "months", Kind.UINT))),
            Map.entry("/qorechain.stakingtier.v1.MsgUnlockEarly", List.of(
                    new Spec(1, "delegator", Kind.STRING),
                    new Spec(2, "lock_id", Kind.UINT))),
            Map.entry("/qorechain.stakingtier.v1.MsgClaimBonus", List.of(
                    new Spec(1, "holder", Kind.STRING))),
            Map.entry("/qorechain.pqc.v1.MsgRegisterPQCKeyV2", List.of(
                    new Spec(1, "sender", Kind.STRING),
                    new Spec(2, "public_key", Kind.BYTES),
                    new Spec(3, "algorithm_id", Kind.UINT),
                    new Spec(4, "ecdsa_pubkey", Kind.BYTES),
                    new Spec(5, "key_type", Kind.STRING),
                    new Spec(6, "proof_of_possession", Kind.BYTES))),
            Map.entry("/qorechain.pqc.v1.MsgRotatePQCKey", List.of(
                    new Spec(1, "sender", Kind.STRING),
                    new Spec(2, "old_public_key", Kind.BYTES),
                    new Spec(3, "new_public_key", Kind.BYTES),
                    new Spec(4, "old_signature", Kind.BYTES),
                    new Spec(5, "new_signature", Kind.BYTES))),
            Map.entry("/qorechain.pqc.v1.MsgOpenEVMWindow", List.of(
                    new Spec(1, "sender", Kind.STRING),
                    new Spec(2, "blocks", Kind.UINT),
                    new Spec(3, "max_txs", Kind.UINT),
                    new Spec(4, "max_value", Kind.STRING),
                    new Spec(5, "native_only", Kind.BOOL),
                    new Spec(6, "allowed_targets", Kind.STRINGS))),
            Map.entry("/qorechain.pqc.v1.MsgCloseEVMWindow", List.of(
                    new Spec(1, "sender", Kind.STRING))));

    private static final Set<String> SINGLE_KEY_TYPES = Set.of(
            "/cosmos.crypto.secp256k1.PubKey", "/cosmos.evm.crypto.v1.ethsecp256k1.PubKey");

    private TxDecoder() {}

    private static CustodyKitException unknownField(String what, Proto.Field f) {
        return new CustodyKitException("UNKNOWN_FIELD", what + ": unknown field " + f.num());
    }

    private static JsonObject decodeCoin(byte[] bytes) {
        String denom = "";
        String amount = "";
        for (Proto.Field f : Proto.readFields(bytes)) {
            if (f.num() == 1) denom = Proto.asString(f, "Coin");
            else if (f.num() == 2) amount = Proto.asString(f, "Coin");
            else throw unknownField("Coin", f);
        }
        JsonObject c = new JsonObject();
        c.addProperty("denom", denom);
        c.addProperty("amount", amount);
        return c;
    }

    private static JsonObject decodeIo(byte[] bytes) {
        String address = "";
        JsonArray coins = new JsonArray();
        for (Proto.Field f : Proto.readFields(bytes)) {
            if (f.num() == 1) address = Proto.asString(f, "Input/Output");
            else if (f.num() == 2) coins.add(decodeCoin(Proto.asBytes(f, "Input/Output")));
            else throw unknownField("Input/Output", f);
        }
        JsonObject io = new JsonObject();
        io.addProperty("address", address);
        io.add("coins", coins);
        return io;
    }

    private static JsonElement defaultFor(Kind kind) {
        return switch (kind) {
            case STRING, BYTES -> new JsonPrimitive("");
            case UINT -> new JsonPrimitive("0");
            case BOOL -> new JsonPrimitive(false);
            case COIN -> JsonNull.INSTANCE;
            default -> new JsonArray();
        };
    }

    /**
     * Decode one message: {@code {typeUrl, fields, value}}. Known types get their fields (proto
     * field names) and {@code value: null}; unknown types get {@code fields: null} and the bytes
     * in hex.
     */
    public static JsonObject decodeMessage(String typeUrl, byte[] value) {
        JsonObject out = new JsonObject();
        out.addProperty("typeUrl", typeUrl);
        List<Spec> layout = KNOWN_MESSAGES.get(typeUrl);
        if (layout == null) {
            out.add("fields", JsonNull.INSTANCE);
            out.addProperty("value", Proto.toHex(value));
            return out;
        }
        JsonObject fields = new JsonObject();
        for (Spec s : layout) fields.add(s.name(), defaultFor(s.kind()));
        for (Proto.Field f : Proto.readFields(value)) {
            Spec spec = null;
            for (Spec s : layout) {
                if (s.num() == f.num()) spec = s;
            }
            if (spec == null) throw unknownField(typeUrl, f);
            switch (spec.kind()) {
                case STRING -> fields.addProperty(spec.name(), Proto.asString(f, typeUrl));
                case BYTES -> fields.addProperty(spec.name(), Proto.toHex(Proto.asBytes(f, typeUrl)));
                case UINT -> fields.addProperty(spec.name(), Proto.asUint(f, typeUrl));
                case BOOL -> fields.addProperty(spec.name(), Proto.asUintRaw(f, typeUrl) != 0);
                case COIN -> fields.add(spec.name(), decodeCoin(Proto.asBytes(f, typeUrl)));
                case COINS -> fields.getAsJsonArray(spec.name()).add(decodeCoin(Proto.asBytes(f, typeUrl)));
                case STRINGS -> fields.getAsJsonArray(spec.name()).add(Proto.asString(f, typeUrl));
                case IO -> fields.getAsJsonArray(spec.name()).add(decodeIo(Proto.asBytes(f, typeUrl)));
                default -> throw new IllegalStateException();
            }
        }
        out.add("fields", fields);
        out.add("value", JsonNull.INSTANCE);
        return out;
    }

    private record AnyMsg(String typeUrl, byte[] value) {}

    private static AnyMsg decodeAny(byte[] bytes, String what) {
        String typeUrl = "";
        byte[] value = new byte[0];
        for (Proto.Field f : Proto.readFields(bytes)) {
            if (f.num() == 1) typeUrl = Proto.asString(f, what);
            else if (f.num() == 2) value = Proto.asBytes(f, what);
            else throw unknownField(what, f);
        }
        return new AnyMsg(typeUrl, value);
    }

    private static JsonObject decodePqcLayer(byte[] bytes) {
        long algorithmId = 0;
        int signatureLength = 0;
        int publicKeyLength = 0;
        for (Proto.Field f : Proto.readFields(bytes)) {
            if (f.num() == 1) algorithmId = Proto.asUintRaw(f, "PQCHybridSignature");
            else if (f.num() == 2) signatureLength = Proto.asBytes(f, "PQCHybridSignature").length;
            else if (f.num() == 3) publicKeyLength = Proto.asBytes(f, "PQCHybridSignature").length;
            else throw unknownField("PQCHybridSignature", f);
        }
        JsonObject o = new JsonObject();
        o.addProperty("algorithmId", algorithmId);
        o.addProperty("signatureLength", signatureLength);
        o.addProperty("publicKeyLength", publicKeyLength);
        return o;
    }

    private static JsonObject decodeSigner(byte[] bytes) {
        JsonElement publicKeyType = JsonNull.INSTANCE;
        JsonElement publicKey = JsonNull.INSTANCE;
        String sequence = "0";
        JsonElement signMode = JsonNull.INSTANCE;
        for (Proto.Field f : Proto.readFields(bytes)) {
            if (f.num() == 1) {
                AnyMsg any = decodeAny(Proto.asBytes(f, "SignerInfo"), "SignerInfo.public_key");
                publicKeyType = new JsonPrimitive(any.typeUrl());
                if (SINGLE_KEY_TYPES.contains(any.typeUrl())) {
                    for (Proto.Field k : Proto.readFields(any.value())) {
                        if (k.num() == 1) publicKey = new JsonPrimitive(Proto.toHex(Proto.asBytes(k, "PubKey")));
                        else throw unknownField("PubKey", k);
                    }
                }
            } else if (f.num() == 2) {
                for (Proto.Field m : Proto.readFields(Proto.asBytes(f, "ModeInfo"))) {
                    if (m.num() == 1) {
                        long mode = 0;
                        for (Proto.Field single : Proto.readFields(Proto.asBytes(m, "ModeInfo.Single"))) {
                            if (single.num() == 1) mode = Proto.asUintRaw(single, "ModeInfo.Single");
                            else throw unknownField("ModeInfo.Single", single);
                        }
                        signMode = new JsonPrimitive(mode);
                    } else if (m.num() == 2) {
                        Proto.expectWire(m, Proto.WIRE_LEN, "ModeInfo.Multi");
                        signMode = JsonNull.INSTANCE;
                    } else {
                        throw unknownField("ModeInfo", m);
                    }
                }
            } else if (f.num() == 3) {
                sequence = Proto.asUint(f, "SignerInfo");
            } else {
                throw unknownField("SignerInfo", f);
            }
        }
        JsonObject s = new JsonObject();
        s.add("publicKeyType", publicKeyType);
        s.add("publicKey", publicKey);
        s.addProperty("sequence", sequence);
        s.add("signMode", signMode);
        return s;
    }

    static String sha256Hex(byte[] data) {
        try {
            return Proto.toHex(MessageDigest.getInstance("SHA-256").digest(data)).toUpperCase(Locale.ROOT);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * Decode a signed {@code TxRaw}. Throws {@link CustodyKitException} ({@code MALFORMED_TX} or
     * {@code UNKNOWN_FIELD}).
     */
    public static JsonObject decodeTx(byte[] txBytes) {
        byte[] bodyBytes = null;
        byte[] authInfoBytes = null;
        int signatureCount = 0;
        for (Proto.Field f : Proto.readFields(txBytes)) {
            if (f.num() == 1) bodyBytes = Proto.asBytes(f, "TxRaw");
            else if (f.num() == 2) authInfoBytes = Proto.asBytes(f, "TxRaw");
            else if (f.num() == 3) {
                Proto.asBytes(f, "TxRaw");
                signatureCount++;
            } else {
                throw unknownField("TxRaw", f);
            }
        }
        if (bodyBytes == null || authInfoBytes == null) {
            throw new CustodyKitException("MALFORMED_TX", "TxRaw needs body_bytes and auth_info_bytes");
        }

        JsonArray messages = new JsonArray();
        String memo = "";
        String timeoutHeight = "0";
        boolean unordered = false;
        String timeoutTimestampSeconds = "0";
        JsonArray extensionOptions = new JsonArray();
        JsonArray nonCritical = new JsonArray();
        JsonArray pqcLayers = new JsonArray();

        for (Proto.Field f : Proto.readFields(bodyBytes)) {
            switch (f.num()) {
                case 1 -> {
                    AnyMsg any = decodeAny(Proto.asBytes(f, "TxBody"), "TxBody.messages");
                    messages.add(decodeMessage(any.typeUrl(), any.value()));
                }
                case 2 -> memo = Proto.asString(f, "TxBody");
                case 3 -> timeoutHeight = Proto.asUint(f, "TxBody");
                case 4 -> unordered = Proto.asUintRaw(f, "TxBody") != 0;
                case 5 -> {
                    for (Proto.Field t : Proto.readFields(Proto.asBytes(f, "TxBody"))) {
                        if (t.num() == 1) timeoutTimestampSeconds = Proto.asUint(t, "Timestamp");
                        else if (t.num() == 2) Proto.asUint(t, "Timestamp");
                        else throw unknownField("Timestamp", t);
                    }
                }
                case 1023 -> {
                    AnyMsg any = decodeAny(Proto.asBytes(f, "TxBody"), "TxBody.extension_options");
                    extensionOptions.add(any.typeUrl());
                    if (any.typeUrl().equals(PQC_HYBRID_TYPE_URL)) pqcLayers.add(decodePqcLayer(any.value()));
                }
                case 2047 -> nonCritical.add(
                        decodeAny(Proto.asBytes(f, "TxBody"), "TxBody.non_critical_extension_options").typeUrl());
                default -> throw unknownField("TxBody", f);
            }
        }

        JsonArray signers = new JsonArray();
        JsonArray feeAmount = new JsonArray();
        String gasLimit = "0";
        String payer = "";
        String granter = "";
        for (Proto.Field f : Proto.readFields(authInfoBytes)) {
            if (f.num() == 1) {
                signers.add(decodeSigner(Proto.asBytes(f, "AuthInfo")));
            } else if (f.num() == 2) {
                for (Proto.Field g : Proto.readFields(Proto.asBytes(f, "AuthInfo"))) {
                    if (g.num() == 1) feeAmount.add(decodeCoin(Proto.asBytes(g, "Fee")));
                    else if (g.num() == 2) gasLimit = Proto.asUint(g, "Fee");
                    else if (g.num() == 3) payer = Proto.asString(g, "Fee");
                    else if (g.num() == 4) granter = Proto.asString(g, "Fee");
                    else throw unknownField("Fee", g);
                }
            } else {
                throw unknownField("AuthInfo", f);
            }
        }

        JsonObject fee = new JsonObject();
        fee.add("amount", feeAmount);
        fee.addProperty("gasLimit", gasLimit);
        fee.addProperty("payer", payer);
        fee.addProperty("granter", granter);

        JsonObject tx = new JsonObject();
        tx.addProperty("txHash", sha256Hex(txBytes));
        tx.add("messages", messages);
        tx.addProperty("memo", memo);
        tx.addProperty("timeoutHeight", timeoutHeight);
        tx.addProperty("unordered", unordered);
        tx.addProperty("timeoutTimestampSeconds", timeoutTimestampSeconds);
        tx.add("extensionOptions", extensionOptions);
        tx.add("nonCriticalExtensionOptions", nonCritical);
        tx.add("pqcLayers", pqcLayers);
        tx.add("signers", signers);
        tx.add("fee", fee);
        tx.addProperty("signatureCount", signatureCount);
        return tx;
    }
}
