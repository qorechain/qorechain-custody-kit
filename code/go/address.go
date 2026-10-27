// SPDX-License-Identifier: Apache-2.0
//
// Address validation for deposit and withdrawal forms.
//
// A QoreChain account has one 20-byte address with two spellings: bech32
// qor1... and hex 0x... (EIP-55 checksummed). Validator operator addresses
// use the qorvaloper1... prefix over the same kind of 20 bytes.

package custodykit

import (
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"

	qoresign "github.com/qorechain/qoresign/go"
)

const (
	AccountPrefix   = "qor"
	ValidatorPrefix = "qorvaloper"
)

// AddressKind is "account" or "validator".
type AddressKind = string

const (
	KindAccount   AddressKind = "account"
	KindValidator AddressKind = "validator"
)

// AddressCheck is the result of ValidateAddress. Valid inputs fill Kind,
// Format, Checksum, Bech32 and Hex; invalid ones fill Error and Detail.
type AddressCheck struct {
	Valid bool `json:"valid"`
	// Kind is "account" or "validator".
	Kind string `json:"kind,omitempty"`
	// Format is how the input was written: "bech32" or "hex".
	Format string `json:"format,omitempty"`
	// Checksum is "bech32", "eip55", or "none" for an all-lowercase or
	// all-uppercase hex input.
	Checksum string `json:"checksum,omitempty"`
	// Bech32 is the canonical lowercase bech32 form.
	Bech32 string `json:"bech32,omitempty"`
	// Hex is the EIP-55 form of the same 20 bytes.
	Hex string `json:"hex,omitempty"`
	// Error is a stable code: EMPTY, WHITESPACE, BAD_HEX, BAD_EIP55,
	// NO_CHECKSUM, MIXED_CASE, BAD_BECH32, BAD_CHECKSUM, WRONG_PREFIX,
	// BAD_LENGTH or KIND_NOT_ALLOWED.
	Error  string `json:"error,omitempty"`
	Detail string `json:"detail,omitempty"`
}

// ValidateAddressOptions narrows what ValidateAddress accepts.
type ValidateAddressOptions struct {
	// Allow lists the kinds to accept. Nil means accounts only.
	Allow []AddressKind
	// RequireEIP55 refuses a hex address that carries no EIP-55 checksum.
	RequireEIP55 bool
}

var hexBody = regexp.MustCompile(`^[0-9a-fA-F]{40}$`)

func failAddress(code, detail string) AddressCheck {
	return AddressCheck{Valid: false, Error: code, Detail: detail}
}

func allows(allow []AddressKind, kind AddressKind) bool {
	if allow == nil {
		allow = []AddressKind{KindAccount}
	}
	for _, k := range allow {
		if k == kind {
			return true
		}
	}
	return false
}

// ValidateAddress validates a qor1..., qorvaloper1... or 0x... address. It
// never fails with an error value: an invalid input gives Valid false and a
// stable code in Error.
func ValidateAddress(input string, opts ValidateAddressOptions) AddressCheck {
	if input == "" {
		return failAddress("EMPTY", "the address is empty")
	}
	if strings.TrimSpace(input) != input {
		return failAddress("WHITESPACE", "the address has leading or trailing whitespace")
	}
	if strings.HasPrefix(input, "0x") {
		body := input[2:]
		if !hexBody.MatchString(body) {
			return failAddress("BAD_HEX", "a hex address is 0x followed by 40 hex digits")
		}
		b, _ := hex.DecodeString(body)
		canonical, err := qoresign.AddressFromBytes(b)
		if err != nil {
			return failAddress("BAD_HEX", err.Error())
		}
		mixed := strings.ContainsAny(body, "abcdef") && strings.ContainsAny(body, "ABCDEF")
		checksum := "none"
		if input == canonical.Hex {
			checksum = "eip55"
		} else if mixed {
			return failAddress("BAD_EIP55", "the EIP-55 checksum (letter case) does not match")
		}
		if checksum == "none" && opts.RequireEIP55 {
			return failAddress("NO_CHECKSUM", "the hex address carries no EIP-55 checksum")
		}
		if !allows(opts.Allow, KindAccount) {
			return failAddress("KIND_NOT_ALLOWED", "a hex address is an account address")
		}
		return AddressCheck{Valid: true, Kind: KindAccount, Format: "hex", Checksum: checksum, Bech32: canonical.Bech32, Hex: canonical.Hex}
	}

	hrp, b, err := bech32Decode(input)
	if err != nil {
		be := err.(*bech32Error)
		return failAddress(be.code, be.msg)
	}
	var kind AddressKind
	switch hrp {
	case AccountPrefix:
		kind = KindAccount
	case ValidatorPrefix:
		kind = KindValidator
	default:
		return failAddress("WRONG_PREFIX", fmt.Sprintf("expected the %q or %q prefix, got %q", AccountPrefix, ValidatorPrefix, hrp))
	}
	if len(b) != 20 {
		return failAddress("BAD_LENGTH", fmt.Sprintf("addresses are 20 bytes, this one has %d", len(b)))
	}
	if !allows(opts.Allow, kind) {
		return failAddress("KIND_NOT_ALLOWED", fmt.Sprintf("a %s address is not accepted here", kind))
	}
	canonical, err := qoresign.AddressFromBytes(b)
	if err != nil {
		return failAddress("BAD_LENGTH", err.Error())
	}
	out := AddressCheck{Valid: true, Kind: kind, Format: "bech32", Checksum: "bech32", Bech32: canonical.Bech32, Hex: canonical.Hex}
	if kind == KindValidator {
		out.Bech32 = bech32Encode(ValidatorPrefix, b)
	}
	return out
}
