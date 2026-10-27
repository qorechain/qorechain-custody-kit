// SPDX-License-Identifier: Apache-2.0
package io.github.qorechain.custodykit;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Bech32 (BIP-173) with error classification. QoreChain addresses use the original bech32
 * checksum, not bech32m. Kept separate from QoreSign so that every language of the kit reports
 * the same error code for the same input.
 */
final class Bech32 {
    private static final String CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
    private static final int[] GENERATOR = {0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3};

    /** A decoding failure: {@code MIXED_CASE}, {@code BAD_BECH32} or {@code BAD_CHECKSUM}. */
    static final class DecodeError extends Exception {
        private static final long serialVersionUID = 1L;
        final String code;

        DecodeError(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    record Decoded(String hrp, byte[] bytes) {}

    private Bech32() {}

    private static int polymod(List<Integer> values) {
        int chk = 1;
        for (int v : values) {
            int top = chk >>> 25;
            chk = ((chk & 0x1ffffff) << 5) ^ v;
            for (int i = 0; i < 5; i++) {
                if (((top >>> i) & 1) != 0) chk ^= GENERATOR[i];
            }
        }
        return chk;
    }

    private static List<Integer> hrpExpand(String hrp) {
        List<Integer> out = new ArrayList<>();
        for (int i = 0; i < hrp.length(); i++) out.add(hrp.charAt(i) >> 5);
        out.add(0);
        for (int i = 0; i < hrp.length(); i++) out.add(hrp.charAt(i) & 31);
        return out;
    }

    private static List<Integer> convertBits(List<Integer> data, int from, int to, boolean pad) throws DecodeError {
        int acc = 0;
        int bits = 0;
        int maxv = (1 << to) - 1;
        List<Integer> out = new ArrayList<>();
        for (int value : data) {
            acc = (acc << from) | value;
            bits += from;
            while (bits >= to) {
                bits -= to;
                out.add((acc >> bits) & maxv);
            }
            acc &= (1 << bits) - 1;
        }
        if (pad) {
            if (bits > 0) out.add((acc << (to - bits)) & maxv);
        } else if (bits >= from || ((acc << (to - bits)) & maxv) != 0) {
            throw new DecodeError("BAD_BECH32", "invalid padding in the data part");
        }
        return out;
    }

    /** Decode a bech32 string into its human-readable part and data bytes. */
    static Decoded decode(String input) throws DecodeError {
        String lower = input.toLowerCase(Locale.ROOT);
        String upper = input.toUpperCase(Locale.ROOT);
        if (!input.equals(lower) && !input.equals(upper)) {
            throw new DecodeError("MIXED_CASE", "bech32 strings must be all lowercase or all uppercase");
        }
        int pos = lower.lastIndexOf('1');
        if (pos < 1 || pos + 7 > lower.length()) {
            throw new DecodeError("BAD_BECH32", "missing separator, prefix or checksum");
        }
        String hrp = lower.substring(0, pos);
        for (int i = 0; i < hrp.length(); i++) {
            char c = hrp.charAt(i);
            if (c < 33 || c > 126) throw new DecodeError("BAD_BECH32", "invalid character in the prefix");
        }
        List<Integer> data = new ArrayList<>();
        for (int i = pos + 1; i < lower.length(); i++) {
            int v = CHARSET.indexOf(lower.charAt(i));
            if (v == -1) throw new DecodeError("BAD_BECH32", "invalid character '" + lower.charAt(i) + "'");
            data.add(v);
        }
        List<Integer> all = hrpExpand(hrp);
        all.addAll(data);
        if (polymod(all) != 1) throw new DecodeError("BAD_CHECKSUM", "bech32 checksum does not match");
        List<Integer> bytes = convertBits(data.subList(0, data.size() - 6), 5, 8, false);
        byte[] out = new byte[bytes.size()];
        for (int i = 0; i < out.length; i++) out[i] = (byte) (int) bytes.get(i);
        return new Decoded(hrp, out);
    }

    /** Encode bytes as bech32 (lowercase). */
    static String encode(String hrp, byte[] bytes) {
        List<Integer> in = new ArrayList<>();
        for (byte b : bytes) in.add(b & 0xff);
        List<Integer> words;
        try {
            words = convertBits(in, 8, 5, true);
        } catch (DecodeError e) {
            throw new IllegalStateException(e);
        }
        List<Integer> values = hrpExpand(hrp);
        values.addAll(words);
        for (int i = 0; i < 6; i++) values.add(0);
        int mod = polymod(values) ^ 1;
        StringBuilder sb = new StringBuilder(hrp).append('1');
        for (int w : words) sb.append(CHARSET.charAt(w));
        for (int i = 0; i < 6; i++) sb.append(CHARSET.charAt((mod >>> (5 * (5 - i))) & 31));
        return sb.toString();
    }
}
