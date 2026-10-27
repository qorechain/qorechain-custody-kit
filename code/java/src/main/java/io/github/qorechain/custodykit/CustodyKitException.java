// SPDX-License-Identifier: Apache-2.0
package io.github.qorechain.custodykit;

/**
 * An error with a stable code, identical in every language of the kit.
 *
 * <ul>
 *   <li>{@code MALFORMED_TX}: the bytes are not a well-formed transaction.</li>
 *   <li>{@code UNKNOWN_FIELD}: a field the decoder does not know, in a structure it decodes
 *       strictly. The network refuses such transactions too.</li>
 *   <li>{@code INVALID_ARGUMENT}: a caller error (bad option, bad address for a query).</li>
 * </ul>
 */
public final class CustodyKitException extends RuntimeException {
    private static final long serialVersionUID = 1L;

    private final String code;

    public CustodyKitException(String code, String message) {
        super(code + ": " + message);
        this.code = code;
    }

    /** {@code MALFORMED_TX}, {@code UNKNOWN_FIELD} or {@code INVALID_ARGUMENT}. */
    public String getCode() {
        return code;
    }
}
