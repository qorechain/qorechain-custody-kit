// SPDX-License-Identifier: Apache-2.0
package io.github.qorechain.custodykit;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * A strict protobuf reader, enough to decode transactions. It refuses truncated input, overlong
 * varints and the deprecated group wire types. Every field of a message is read before any of
 * them is interpreted, so a malformed tail is reported as such.
 */
final class Proto {
    static final int WIRE_VARINT = 0;
    static final int WIRE_FIXED64 = 1;
    static final int WIRE_LEN = 2;
    static final int WIRE_FIXED32 = 5;

    /** One field. {@code value} is set for varints (as an unsigned 64-bit value); {@code bytes} otherwise. */
    record Field(int num, int wire, long value, byte[] bytes) {}

    private Proto() {}

    private static CustodyKitException malformed(String message) {
        return new CustodyKitException("MALFORMED_TX", message);
    }

    /** Returns {value, newPosition}. */
    private static long[] readVarint(byte[] buf, int pos) {
        long result = 0;
        for (int i = 0; i < 10; i++) {
            if (pos >= buf.length) throw malformed("truncated varint");
            int b = buf[pos++] & 0xff;
            if (i == 9 && (b & 0x7f) > 1) throw malformed("varint overflows 64 bits");
            result |= ((long) (b & 0x7f)) << (7 * i);
            if ((b & 0x80) == 0) return new long[] {result, pos};
        }
        throw malformed("varint longer than 10 bytes");
    }

    /** Read every field of a message, in order. */
    static List<Field> readFields(byte[] buf) {
        List<Field> out = new ArrayList<>();
        int pos = 0;
        while (pos < buf.length) {
            long[] key = readVarint(buf, pos);
            pos = (int) key[1];
            long num = key[0] >>> 3;
            int wire = (int) (key[0] & 7);
            if (num == 0) throw malformed("field number 0");
            // Larger field numbers are reported as unknown fields, as in the other languages.
            int fieldNum = num > Integer.MAX_VALUE ? Integer.MAX_VALUE : (int) num;
            switch (wire) {
                case WIRE_VARINT -> {
                    long[] v = readVarint(buf, pos);
                    pos = (int) v[1];
                    out.add(new Field(fieldNum, wire, v[0], null));
                }
                case WIRE_FIXED64, WIRE_FIXED32 -> {
                    int n = wire == WIRE_FIXED64 ? 8 : 4;
                    if (pos + n > buf.length) throw malformed("truncated fixed field");
                    out.add(new Field(fieldNum, wire, 0, Arrays.copyOfRange(buf, pos, pos + n)));
                    pos += n;
                }
                case WIRE_LEN -> {
                    long[] len = readVarint(buf, pos);
                    pos = (int) len[1];
                    if (Long.compareUnsigned(len[0], buf.length - pos) > 0) {
                        throw malformed("length-delimited field runs past the end");
                    }
                    int n = (int) len[0];
                    out.add(new Field(fieldNum, wire, 0, Arrays.copyOfRange(buf, pos, pos + n)));
                    pos += n;
                }
                default -> throw malformed("unsupported wire type " + wire);
            }
        }
        return out;
    }

    static void expectWire(Field f, int wire, String what) {
        if (f.wire() != wire) {
            throw malformed(what + ": field " + f.num() + " has wire type " + f.wire() + ", expected " + wire);
        }
    }

    static String asString(Field f, String what) {
        expectWire(f, WIRE_LEN, what);
        try {
            return StandardCharsets.UTF_8
                    .newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(f.bytes()))
                    .toString();
        } catch (CharacterCodingException e) {
            throw malformed(what + ": field " + f.num() + " is not valid UTF-8");
        }
    }

    static byte[] asBytes(Field f, String what) {
        expectWire(f, WIRE_LEN, what);
        return f.bytes();
    }

    /** The varint as an unsigned decimal string. */
    static String asUint(Field f, String what) {
        expectWire(f, WIRE_VARINT, what);
        return Long.toUnsignedString(f.value());
    }

    static long asUintRaw(Field f, String what) {
        expectWire(f, WIRE_VARINT, what);
        return f.value();
    }

    static String toHex(byte[] b) {
        StringBuilder sb = new StringBuilder(b.length * 2);
        for (byte x : b) sb.append(Character.forDigit((x >> 4) & 0xf, 16)).append(Character.forDigit(x & 0xf, 16));
        return sb.toString();
    }

    static byte[] fromHex(String s) {
        String clean = s.startsWith("0x") ? s.substring(2) : s;
        if (clean.length() % 2 != 0 || !clean.matches("[0-9a-fA-F]*")) {
            throw new CustodyKitException("INVALID_ARGUMENT", "not a hex string");
        }
        byte[] out = new byte[clean.length() / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(clean.substring(2 * i, 2 * i + 2), 16);
        }
        return out;
    }
}
