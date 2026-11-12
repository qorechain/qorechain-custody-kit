// SPDX-License-Identifier: Apache-2.0
//
// MsgOpenEVMWindow with every optional field (5 to 9) set, encoded field by
// field here rather than read from the vectors file.

package custodykit

import (
	"encoding/json"
	"testing"
)

const windowType = "/qorechain.pqc.v1.MsgOpenEVMWindow"

func pbVarint(v uint64) []byte {
	var out []byte
	for {
		b := byte(v & 0x7f)
		v >>= 7
		if v != 0 {
			out = append(out, b|0x80)
			continue
		}
		return append(out, b)
	}
}

func pbString(num uint64, s string) []byte {
	out := pbVarint(num<<3 | 2)
	out = append(out, pbVarint(uint64(len(s)))...)
	return append(out, s...)
}

func pbUint(num, v uint64) []byte { return append(pbVarint(num<<3), pbVarint(v)...) }

func fullWindow() []byte {
	var b []byte
	for _, part := range [][]byte{
		pbString(1, "qor1npvwllfr9dqr8erajqqr6s0vxnk2ak55am9g2c"),
		pbUint(2, 600),
		pbUint(3, 10),
		pbString(4, "25000000"),
		pbUint(5, 1),
		pbString(6, "0x000000000000000000000000000000000000dEaD"),
		pbString(7, "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"),
		pbString(8, "qorvaloper19rl4cm2hmr8afy4kldpxz3fka4jguq0a5ws5he"),
		pbString(8, "qorvaloper1npvwllfr9dqr8erajqqr6s0vxnk2ak55p70zhk"),
		pbString(9, "channel-0/cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4"),
	} {
		b = append(b, part...)
	}
	return b
}

func TestOpenEVMWindowAllFields(t *testing.T) {
	d, err := DecodeMessage(windowType, fullWindow())
	if err != nil {
		t.Fatal(err)
	}
	sameJSON(t, d, json.RawMessage(`{
		"typeUrl": "/qorechain.pqc.v1.MsgOpenEVMWindow",
		"fields": {
			"sender": "qor1npvwllfr9dqr8erajqqr6s0vxnk2ak55am9g2c",
			"blocks": "600",
			"max_txs": "10",
			"max_value": "25000000",
			"native_only": true,
			"allowed_targets": ["0x000000000000000000000000000000000000dEaD"],
			"validators": ["0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789"],
			"staking_validators": [
				"qorvaloper19rl4cm2hmr8afy4kldpxz3fka4jguq0a5ws5he",
				"qorvaloper1npvwllfr9dqr8erajqqr6s0vxnk2ak55p70zhk"
			],
			"ibc_receivers": ["channel-0/cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4"]
		},
		"value": null
	}`))
}

func TestOpenEVMWindowUnknownField(t *testing.T) {
	for name, extra := range map[string][]byte{
		"field 10 string": pbString(10, "x"),
		"field 10 varint": pbUint(10, 1),
	} {
		_, err := DecodeMessage(windowType, append(fullWindow(), extra...))
		if ErrorCode(err) != "UNKNOWN_FIELD" {
			t.Errorf("%s: got %v, want UNKNOWN_FIELD", name, err)
		}
	}
	_, err := DecodeMessage(windowType, append(fullWindow(), pbUint(9, 1)...))
	if ErrorCode(err) != "MALFORMED_TX" {
		t.Errorf("field 9 as varint: got %v, want MALFORMED_TX", err)
	}
}
