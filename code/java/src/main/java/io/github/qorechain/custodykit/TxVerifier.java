// SPDX-License-Identifier: Apache-2.0
package io.github.qorechain.custodykit;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import io.github.qorechain.qoresign.ClassicalKeyType;
import io.github.qorechain.qoresign.HybridTxResult;
import io.github.qorechain.qoresign.PqLayerResult;
import io.github.qorechain.qoresign.QoreSignException;
import io.github.qorechain.qoresign.Qoresign_ffiKt;
import io.github.qorechain.qoresign.VerifyVersion;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Arrays;
import java.util.Locale;

/**
 * Verify a signed native-lane transaction before it is broadcast: the secp256k1 signature, the
 * ML-DSA-87 layer against the account's registered key, and that the signer recorded in the
 * transaction is the expected key.
 */
public final class TxVerifier {

    /**
     * Arguments of {@link #verifyTx}.
     *
     * @param txBytes encoded {@code TxRaw}
     * @param chainId e.g. {@code qorechain-vladi}
     * @param accountNumber from {@code /cosmos/auth/v1beta1/account_info/{address}}
     * @param classicalPublicKey the signer's 33-byte compressed secp256k1 key
     * @param ethSecp256k1 true for eth-native accounts (coin type 60), false for coin type 118
     * @param pqPublicKey the ML-DSA-87 key registered for the account, or null to check the
     *     classical signature only
     * @param signBytesVersion {@code v1}, {@code v2} (default, what both public networks verify)
     *     or {@code either}
     */
    public record VerifyTxArgs(
            byte[] txBytes,
            String chainId,
            long accountNumber,
            byte[] classicalPublicKey,
            boolean ethSecp256k1,
            byte[] pqPublicKey,
            String signBytesVersion) {}

    /**
     * Result of {@link #verifyTx}.
     *
     * @param valid true when every check that was asked for passed
     * @param signerKey {@code match}, {@code absent} (the transaction carries no public key) or
     *     {@code mismatch}
     * @param pqValid null when no ML-DSA-87 key was given
     * @param pqSignBytesVersion the sign-bytes version the layer verified under, or null
     * @param pqReason why the layer did not verify, or null
     */
    public record VerifyTxResult(
            boolean valid,
            boolean classical,
            String signerKey,
            Boolean pqValid,
            String pqSignBytesVersion,
            String pqReason) {

        /** The same JSON shape as the other languages of the kit. */
        public JsonObject toJson() {
            JsonObject o = new JsonObject();
            o.addProperty("valid", valid);
            o.addProperty("classical", classical);
            o.addProperty("signerKey", signerKey);
            if (pqValid == null) {
                o.add("pq", JsonNull.INSTANCE);
            } else {
                JsonObject pq = new JsonObject();
                pq.addProperty("valid", pqValid);
                pq.addProperty("signBytesVersion", pqSignBytesVersion);
                pq.addProperty("reason", pqReason);
                o.add("pq", pq);
            }
            return o;
        }
    }

    // QoreSign's Kotlin verifyHybridTx takes the account number as a ULong. Kotlin compiles a
    // function with an unsigned (inline class) parameter under a mangled JVM name, e.g.
    // "verifyHybridTx-5DnABAY", which Java source cannot name. The method is found once by its
    // name prefix and exact parameter types; the ULong arrives as a plain long.
    private static final Method VERIFY_HYBRID_TX = findVerifyHybridTx();

    private static Method findVerifyHybridTx() {
        Class<?>[] params = {
            byte[].class, String.class, long.class, byte[].class, byte[].class,
            ClassicalKeyType.class, VerifyVersion.class
        };
        for (Method m : Qoresign_ffiKt.class.getMethods()) {
            if (m.getName().startsWith("verifyHybridTx-")
                    && !m.getName().endsWith("$default")
                    && Arrays.equals(m.getParameterTypes(), params)) {
                return m;
            }
        }
        throw new IllegalStateException("QoreSign verifyHybridTx not found; check the qoresign version");
    }

    private TxVerifier() {}

    /** Verify a single-signer transaction. Throws on malformed input, never on a bad signature. */
    public static VerifyTxResult verifyTx(VerifyTxArgs args) {
        JsonObject decoded = TxDecoder.decodeTx(args.txBytes());
        JsonArray signers = decoded.getAsJsonArray("signers");
        String signerKey = "absent";
        if (signers.size() == 1) {
            JsonElement pk = signers.get(0).getAsJsonObject().get("publicKey");
            if (!pk.isJsonNull()) {
                signerKey = pk.getAsString().equals(Proto.toHex(args.classicalPublicKey())) ? "match" : "mismatch";
            }
        } else {
            signerKey = "mismatch";
        }
        String version = args.signBytesVersion() == null ? "v2" : args.signBytesVersion();
        VerifyVersion vv = switch (version) {
            case "v1" -> VerifyVersion.V1;
            case "v2" -> VerifyVersion.V2;
            case "either" -> VerifyVersion.EITHER;
            default -> throw new CustodyKitException("INVALID_ARGUMENT", "signBytesVersion must be v1, v2 or either");
        };
        HybridTxResult r;
        try {
            r = (HybridTxResult) VERIFY_HYBRID_TX.invoke(
                    null,
                    args.txBytes(),
                    args.chainId(),
                    args.accountNumber(),
                    args.classicalPublicKey(),
                    args.pqPublicKey(),
                    args.ethSecp256k1() ? ClassicalKeyType.ETH_SECP256K1 : ClassicalKeyType.SECP256K1,
                    vv);
        } catch (IllegalAccessException e) {
            throw new IllegalStateException(e);
        } catch (InvocationTargetException e) {
            if (e.getCause() instanceof QoreSignException q) {
                throw new CustodyKitException("INVALID_ARGUMENT", q.getMessage());
            }
            throw new IllegalStateException(e.getCause());
        }
        PqLayerResult pq = r.getPq();
        Boolean pqValid = pq == null ? null : pq.getValid();
        String pqVersion = pq == null || pq.getSignBytesVersion() == null
                ? null
                : pq.getSignBytesVersion().name().toLowerCase(Locale.ROOT);
        String pqReason = pq == null || pq.getReason() == null ? null : pq.getReason().name().toLowerCase(Locale.ROOT);
        return new VerifyTxResult(
                r.getValid() && !signerKey.equals("mismatch"), r.getClassical(), signerKey, pqValid, pqVersion, pqReason);
    }
}
