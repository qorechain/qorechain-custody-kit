// SPDX-License-Identifier: Apache-2.0
package io.github.qorechain.custodykit;

import com.google.gson.JsonObject;
import io.github.qorechain.qoresign.AccountAddress;
import io.github.qorechain.qoresign.QoreSignException;
import io.github.qorechain.qoresign.Qoresign_ffiKt;
import java.util.EnumSet;
import java.util.Set;

/**
 * Address validation for deposit and withdrawal forms.
 *
 * <p>A QoreChain account has one 20-byte address with two spellings: bech32 {@code qor1...} and
 * hex {@code 0x...} (EIP-55 checksummed). Validator operator addresses use the {@code
 * qorvaloper1...} prefix over the same kind of 20 bytes.
 */
public final class Addresses {
    public static final String ACCOUNT_PREFIX = "qor";
    public static final String VALIDATOR_PREFIX = "qorvaloper";

    public enum AddressKind {
        ACCOUNT,
        VALIDATOR;

        String json() {
            return this == ACCOUNT ? "account" : "validator";
        }
    }

    /**
     * Options for {@link #validateAddress}.
     *
     * @param allow kinds to accept (default: accounts only)
     * @param requireEip55 refuse a hex address without an EIP-55 checksum
     */
    public record ValidateOptions(Set<AddressKind> allow, boolean requireEip55) {
        public static ValidateOptions defaults() {
            return new ValidateOptions(EnumSet.of(AddressKind.ACCOUNT), false);
        }
    }

    /**
     * Result of {@link #validateAddress}. When {@code valid} is false only {@code error} and
     * {@code detail} are set; otherwise only the other fields are.
     *
     * @param error a stable code: EMPTY, WHITESPACE, BAD_HEX, BAD_EIP55, NO_CHECKSUM, MIXED_CASE,
     *     BAD_BECH32, BAD_CHECKSUM, WRONG_PREFIX, BAD_LENGTH or KIND_NOT_ALLOWED
     * @param format {@code bech32} or {@code hex}: how the input was written
     * @param checksum {@code bech32}, {@code eip55} or {@code none} (hex without checksum)
     * @param bech32 canonical lowercase bech32 ({@code qor1...} or {@code qorvaloper1...})
     * @param hex EIP-55 hex form of the same 20 bytes
     */
    public record AddressCheck(
            boolean valid,
            String error,
            String detail,
            AddressKind kind,
            String format,
            String checksum,
            String bech32,
            String hex) {

        static AddressCheck fail(String error, String detail) {
            return new AddressCheck(false, error, detail, null, null, null, null, null);
        }

        /** The same JSON shape as the other languages of the kit. */
        public JsonObject toJson() {
            JsonObject o = new JsonObject();
            o.addProperty("valid", valid);
            if (!valid) {
                o.addProperty("error", error);
                o.addProperty("detail", detail);
                return o;
            }
            o.addProperty("kind", kind.json());
            o.addProperty("format", format);
            o.addProperty("checksum", checksum);
            o.addProperty("bech32", bech32);
            o.addProperty("hex", hex);
            return o;
        }
    }

    private Addresses() {}

    private static AccountAddress fromBytes(byte[] bytes) {
        try {
            return Qoresign_ffiKt.addressFromBytes(bytes);
        } catch (QoreSignException e) {
            throw new IllegalStateException(e);
        }
    }

    /**
     * Validate a {@code qor1...}, {@code qorvaloper1...} or {@code 0x...} address. Never throws:
     * an invalid input gives {@code valid == false} with a stable error code.
     */
    public static AddressCheck validateAddress(String input, ValidateOptions opts) {
        ValidateOptions o = opts == null ? ValidateOptions.defaults() : opts;
        Set<AddressKind> allow = o.allow() == null ? EnumSet.of(AddressKind.ACCOUNT) : o.allow();
        if (input == null || input.isEmpty()) return AddressCheck.fail("EMPTY", "the address is empty");
        if (!input.strip().equals(input)) {
            return AddressCheck.fail("WHITESPACE", "the address has leading or trailing whitespace");
        }

        if (input.startsWith("0x")) {
            String body = input.substring(2);
            if (!body.matches("[0-9a-fA-F]{40}")) {
                return AddressCheck.fail("BAD_HEX", "a hex address is 0x followed by 40 hex digits");
            }
            AccountAddress canonical = fromBytes(Proto.fromHex(body));
            boolean mixed = body.matches(".*[a-f].*") && body.matches(".*[A-F].*");
            String checksum;
            if (input.equals(canonical.getHex())) {
                checksum = "eip55";
            } else if (mixed) {
                return AddressCheck.fail("BAD_EIP55", "the EIP-55 checksum (letter case) does not match");
            } else {
                checksum = "none";
            }
            if (checksum.equals("none") && o.requireEip55()) {
                return AddressCheck.fail("NO_CHECKSUM", "the hex address carries no EIP-55 checksum");
            }
            if (!allow.contains(AddressKind.ACCOUNT)) {
                return AddressCheck.fail("KIND_NOT_ALLOWED", "a hex address is an account address");
            }
            return new AddressCheck(
                    true, null, null, AddressKind.ACCOUNT, "hex", checksum, canonical.getBech32(), canonical.getHex());
        }

        Bech32.Decoded decoded;
        try {
            decoded = Bech32.decode(input);
        } catch (Bech32.DecodeError e) {
            return AddressCheck.fail(e.code, e.getMessage());
        }
        AddressKind kind;
        if (decoded.hrp().equals(ACCOUNT_PREFIX)) kind = AddressKind.ACCOUNT;
        else if (decoded.hrp().equals(VALIDATOR_PREFIX)) kind = AddressKind.VALIDATOR;
        else {
            return AddressCheck.fail(
                    "WRONG_PREFIX",
                    "expected the \"" + ACCOUNT_PREFIX + "\" or \"" + VALIDATOR_PREFIX + "\" prefix, got \""
                            + decoded.hrp() + "\"");
        }
        if (decoded.bytes().length != 20) {
            return AddressCheck.fail(
                    "BAD_LENGTH", "addresses are 20 bytes, this one has " + decoded.bytes().length);
        }
        if (!allow.contains(kind)) {
            return AddressCheck.fail("KIND_NOT_ALLOWED", "a " + kind.json() + " address is not accepted here");
        }
        AccountAddress canonical = fromBytes(decoded.bytes());
        String bech32 = kind == AddressKind.ACCOUNT
                ? canonical.getBech32()
                : Bech32.encode(VALIDATOR_PREFIX, decoded.bytes());
        return new AddressCheck(true, null, null, kind, "bech32", "bech32", bech32, canonical.getHex());
    }

    /** {@link #validateAddress(String, ValidateOptions)} with the defaults (accounts only). */
    public static AddressCheck validateAddress(String input) {
        return validateAddress(input, ValidateOptions.defaults());
    }
}
