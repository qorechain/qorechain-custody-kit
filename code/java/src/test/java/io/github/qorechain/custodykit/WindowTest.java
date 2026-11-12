// SPDX-License-Identifier: Apache-2.0
package io.github.qorechain.custodykit;

import static org.testng.Assert.assertEquals;

import com.google.gson.JsonParser;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import org.testng.annotations.Test;

/**
 * MsgOpenEVMWindow with every optional field (5 to 9) set, encoded field by field here rather than
 * read from the vectors file.
 */
public class WindowTest {
    static final String TYPE = "/qorechain.pqc.v1.MsgOpenEVMWindow";
    static final String SENDER = "qor1npvwllfr9dqr8erajqqr6s0vxnk2ak55am9g2c";
    static final String TARGET = "0x000000000000000000000000000000000000dEaD";
    static final String VALIDATOR = "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789";
    static final String VALOPER1 = "qorvaloper19rl4cm2hmr8afy4kldpxz3fka4jguq0a5ws5he";
    static final String VALOPER2 = "qorvaloper1npvwllfr9dqr8erajqqr6s0vxnk2ak55p70zhk";
    static final String RECEIVER = "channel-0/cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4";

    private static void varint(ByteArrayOutputStream out, long v) {
        while ((v & ~0x7fL) != 0) {
            out.write((int) ((v & 0x7f) | 0x80));
            v >>>= 7;
        }
        out.write((int) v);
    }

    private static void str(ByteArrayOutputStream out, int num, String s) {
        byte[] b = s.getBytes(StandardCharsets.UTF_8);
        varint(out, ((long) num << 3) | 2);
        varint(out, b.length);
        out.writeBytes(b);
    }

    private static void uint(ByteArrayOutputStream out, int num, long v) {
        varint(out, (long) num << 3);
        varint(out, v);
    }

    private static ByteArrayOutputStream full() {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        str(out, 1, SENDER);
        uint(out, 2, 600);
        uint(out, 3, 10);
        str(out, 4, "25000000");
        uint(out, 5, 1);
        str(out, 6, TARGET);
        str(out, 7, VALIDATOR);
        str(out, 8, VALOPER1);
        str(out, 8, VALOPER2);
        str(out, 9, RECEIVER);
        return out;
    }

    private static String codeOf(Runnable r) {
        try {
            r.run();
        } catch (CustodyKitException e) {
            return e.getCode();
        }
        return "NO_ERROR";
    }

    @Test
    public void decodesEveryField() {
        String want = "{\"typeUrl\":\"" + TYPE + "\",\"fields\":{"
                + "\"sender\":\"" + SENDER + "\",\"blocks\":\"600\",\"max_txs\":\"10\","
                + "\"max_value\":\"25000000\",\"native_only\":true,"
                + "\"allowed_targets\":[\"" + TARGET + "\"],"
                + "\"validators\":[\"" + VALIDATOR + "\"],"
                + "\"staking_validators\":[\"" + VALOPER1 + "\",\"" + VALOPER2 + "\"],"
                + "\"ibc_receivers\":[\"" + RECEIVER + "\"]},\"value\":null}";
        assertEquals(TxDecoder.decodeMessage(TYPE, full().toByteArray()), JsonParser.parseString(want));
    }

    @Test
    public void stillRefusesUnknownField10() {
        ByteArrayOutputStream a = full();
        str(a, 10, "x");
        assertEquals(codeOf(() -> TxDecoder.decodeMessage(TYPE, a.toByteArray())), "UNKNOWN_FIELD");
        ByteArrayOutputStream b = full();
        uint(b, 10, 1);
        assertEquals(codeOf(() -> TxDecoder.decodeMessage(TYPE, b.toByteArray())), "UNKNOWN_FIELD");
    }

    @Test
    public void refusesListFieldWithWrongWireType() {
        ByteArrayOutputStream a = full();
        uint(a, 9, 1);
        assertEquals(codeOf(() -> TxDecoder.decodeMessage(TYPE, a.toByteArray())), "MALFORMED_TX");
    }
}
