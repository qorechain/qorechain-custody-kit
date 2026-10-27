// SPDX-License-Identifier: Apache-2.0
package io.github.qorechain.custodykit;

import com.google.gson.JsonObject;
import java.util.List;

/**
 * QoreChain custody kit, Java examples built on QoreSign ({@code io.github.qorechain:qoresign}).
 * One entry point over {@link Addresses}, {@link TxDecoder}, {@link TxVerifier} and {@link
 * Deposits}.
 */
public final class CustodyKit {
    private CustodyKit() {}

    /** Validate a {@code qor1...}, {@code qorvaloper1...} or {@code 0x...} address. */
    public static Addresses.AddressCheck validateAddress(String input, Addresses.ValidateOptions opts) {
        return Addresses.validateAddress(input, opts);
    }

    /** Decode a signed {@code TxRaw}. */
    public static JsonObject decodeTx(byte[] txBytes) {
        return TxDecoder.decodeTx(txBytes);
    }

    /** Decode one message by type URL. */
    public static JsonObject decodeMessage(String typeUrl, byte[] value) {
        return TxDecoder.decodeMessage(typeUrl, value);
    }

    /** Verify a single-signer transaction (classical signature, ML-DSA-87 layer, signer key). */
    public static TxVerifier.VerifyTxResult verifyTx(TxVerifier.VerifyTxArgs args) {
        return TxVerifier.verifyTx(args);
    }

    /** Path and query string of the deposit search. */
    public static String buildDepositQuery(Deposits.DepositQueryOptions opts) {
        return Deposits.buildDepositQuery(opts);
    }

    /** Incoming transfers in one {@code tx_response}, with a credit decision for each. */
    public static List<Deposits.DepositEntry> extractDeposits(JsonObject txResponse, String address, String denom) {
        return Deposits.extractDeposits(txResponse, address, denom);
    }

    /** Lowercase hex to bytes (an optional {@code 0x} is accepted). */
    public static byte[] fromHex(String hex) {
        return Proto.fromHex(hex);
    }

    /** Bytes to lowercase hex. */
    public static String toHex(byte[] bytes) {
        return Proto.toHex(bytes);
    }
}
