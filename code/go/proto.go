// SPDX-License-Identifier: Apache-2.0
//
// A strict protobuf reader, enough to decode transactions. It refuses
// truncated input, overlong varints and the deprecated group wire types.

package custodykit

import (
	"encoding/hex"
	"strings"
	"unicode/utf8"
)

const (
	wireVarint  = 0
	wireFixed64 = 1
	wireLen     = 2
	wireFixed32 = 5
)

type field struct {
	num   uint64
	wire  int
	int   uint64
	bytes []byte
}

func malformed(format string, args ...any) *Error {
	return errorf(CodeMalformedTx, format, args...)
}

func readVarint(buf []byte, pos int) (uint64, int, error) {
	var result uint64
	for i := 0; i < 10; i++ {
		if pos >= len(buf) {
			return 0, 0, malformed("truncated varint")
		}
		b := buf[pos]
		pos++
		if i == 9 && b > 1 {
			if b&0x80 == 0 {
				return 0, 0, malformed("varint overflows 64 bits")
			}
			return 0, 0, malformed("varint longer than 10 bytes")
		}
		result |= uint64(b&0x7f) << (7 * uint(i))
		if b&0x80 == 0 {
			return result, pos, nil
		}
	}
	return 0, 0, malformed("varint longer than 10 bytes")
}

// readFields reads every field of a message, in order.
func readFields(buf []byte) ([]field, error) {
	var out []field
	pos := 0
	for pos < len(buf) {
		key, next, err := readVarint(buf, pos)
		if err != nil {
			return nil, err
		}
		pos = next
		num := key >> 3
		wire := int(key & 7)
		if num == 0 {
			return nil, malformed("field number 0")
		}
		switch wire {
		case wireVarint:
			v, p, err := readVarint(buf, pos)
			if err != nil {
				return nil, err
			}
			pos = p
			out = append(out, field{num: num, wire: wire, int: v})
		case wireFixed64, wireFixed32:
			n := 4
			if wire == wireFixed64 {
				n = 8
			}
			if pos+n > len(buf) {
				return nil, malformed("truncated fixed field")
			}
			out = append(out, field{num: num, wire: wire, bytes: buf[pos : pos+n]})
			pos += n
		case wireLen:
			l, p, err := readVarint(buf, pos)
			if err != nil {
				return nil, err
			}
			pos = p
			if l > uint64(len(buf)-pos) {
				return nil, malformed("length-delimited field runs past the end")
			}
			n := int(l)
			out = append(out, field{num: num, wire: wire, bytes: buf[pos : pos+n]})
			pos += n
		default:
			return nil, malformed("unsupported wire type %d", wire)
		}
	}
	return out, nil
}

func expectWire(f field, wire int, what string) error {
	if f.wire != wire {
		return malformed("%s: field %d has wire type %d, expected %d", what, f.num, f.wire, wire)
	}
	return nil
}

func asString(f field, what string) (string, error) {
	if err := expectWire(f, wireLen, what); err != nil {
		return "", err
	}
	if !utf8.Valid(f.bytes) {
		return "", malformed("%s: field %d is not valid UTF-8", what, f.num)
	}
	return string(f.bytes), nil
}

func asBytes(f field, what string) ([]byte, error) {
	if err := expectWire(f, wireLen, what); err != nil {
		return nil, err
	}
	return f.bytes, nil
}

func asUint(f field, what string) (uint64, error) {
	if err := expectWire(f, wireVarint, what); err != nil {
		return 0, err
	}
	return f.int, nil
}

// ToHex is lowercase hex.
func ToHex(b []byte) string { return hex.EncodeToString(b) }

// FromHex decodes hex, with or without a 0x prefix.
func FromHex(s string) ([]byte, error) {
	s = strings.TrimPrefix(s, "0x")
	b, err := hex.DecodeString(s)
	if err != nil {
		return nil, errorf(CodeInvalidArgument, "not a hex string")
	}
	return b, nil
}
