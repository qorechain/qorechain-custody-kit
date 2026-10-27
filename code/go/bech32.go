// SPDX-License-Identifier: Apache-2.0
//
// Bech32 (BIP-173) with error classification. QoreChain addresses use the
// original bech32 checksum, not bech32m. Kept separate from QoreSign so that
// every language of the kit reports the same error code for the same input.

package custodykit

import "strings"

const bech32Charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"

var bech32Generator = [5]uint32{0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3}

type bech32Error struct {
	code string
	msg  string
}

func (e *bech32Error) Error() string { return e.msg }

func bech32Polymod(values []byte) uint32 {
	chk := uint32(1)
	for _, v := range values {
		top := chk >> 25
		chk = (chk&0x1ffffff)<<5 ^ uint32(v)
		for i := 0; i < 5; i++ {
			if (top>>uint(i))&1 == 1 {
				chk ^= bech32Generator[i]
			}
		}
	}
	return chk
}

func bech32HrpExpand(hrp string) []byte {
	out := make([]byte, 0, 2*len(hrp)+1)
	for i := 0; i < len(hrp); i++ {
		out = append(out, hrp[i]>>5)
	}
	out = append(out, 0)
	for i := 0; i < len(hrp); i++ {
		out = append(out, hrp[i]&31)
	}
	return out
}

func convertBits(data []byte, from, to uint, pad bool) ([]byte, error) {
	acc := uint32(0)
	bits := uint(0)
	maxv := uint32(1)<<to - 1
	var out []byte
	for _, value := range data {
		acc = acc<<from | uint32(value)
		bits += from
		for bits >= to {
			bits -= to
			out = append(out, byte((acc>>bits)&maxv))
		}
		acc &= uint32(1)<<bits - 1
	}
	if pad {
		if bits > 0 {
			out = append(out, byte((acc<<(to-bits))&maxv))
		}
	} else if bits >= from || (acc<<(to-bits))&maxv != 0 {
		return nil, &bech32Error{"BAD_BECH32", "invalid padding in the data part"}
	}
	return out, nil
}

// bech32Decode decodes a bech32 string into its prefix and data bytes.
func bech32Decode(input string) (string, []byte, error) {
	lower := strings.ToLower(input)
	upper := strings.ToUpper(input)
	if input != lower && input != upper {
		return "", nil, &bech32Error{"MIXED_CASE", "bech32 strings must be all lowercase or all uppercase"}
	}
	pos := strings.LastIndexByte(lower, '1')
	if pos < 1 || pos+7 > len(lower) {
		return "", nil, &bech32Error{"BAD_BECH32", "missing separator, prefix or checksum"}
	}
	hrp := lower[:pos]
	for i := 0; i < len(hrp); i++ {
		if hrp[i] < 33 || hrp[i] > 126 {
			return "", nil, &bech32Error{"BAD_BECH32", "invalid character in the prefix"}
		}
	}
	data := make([]byte, 0, len(lower)-pos-1)
	for _, ch := range lower[pos+1:] {
		v := strings.IndexRune(bech32Charset, ch)
		if v == -1 {
			return "", nil, &bech32Error{"BAD_BECH32", "invalid character " + string(ch)}
		}
		data = append(data, byte(v))
	}
	if bech32Polymod(append(bech32HrpExpand(hrp), data...)) != 1 {
		return "", nil, &bech32Error{"BAD_CHECKSUM", "bech32 checksum does not match"}
	}
	b, err := convertBits(data[:len(data)-6], 5, 8, false)
	if err != nil {
		return "", nil, err
	}
	return hrp, b, nil
}

// bech32Encode encodes bytes as bech32 (lowercase).
func bech32Encode(hrp string, b []byte) string {
	words, _ := convertBits(b, 8, 5, true)
	values := append(bech32HrpExpand(hrp), words...)
	values = append(values, 0, 0, 0, 0, 0, 0)
	mod := bech32Polymod(values) ^ 1
	var sb strings.Builder
	sb.WriteString(hrp)
	sb.WriteByte('1')
	for _, w := range words {
		sb.WriteByte(bech32Charset[w])
	}
	for i := 0; i < 6; i++ {
		sb.WriteByte(bech32Charset[(mod>>uint(5*(5-i)))&31])
	}
	return sb.String()
}
