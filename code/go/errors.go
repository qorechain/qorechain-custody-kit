// SPDX-License-Identifier: Apache-2.0

package custodykit

import "fmt"

// Stable error codes, identical in every language of the kit.
const (
	// CodeMalformedTx: the bytes are not a well-formed transaction.
	CodeMalformedTx = "MALFORMED_TX"
	// CodeUnknownField: a field the decoder does not know, in a structure it
	// decodes strictly. The network refuses such transactions too.
	CodeUnknownField = "UNKNOWN_FIELD"
	// CodeInvalidArgument: a caller error (bad option, bad address for a query).
	CodeInvalidArgument = "INVALID_ARGUMENT"
)

// Error is every error the kit returns on purpose.
type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func errorf(code, format string, args ...any) *Error {
	return &Error{Code: code, Message: fmt.Sprintf(format, args...)}
}

// ErrorCode returns the kit error code of err, or "" for any other error.
func ErrorCode(err error) string {
	if e, ok := err.(*Error); ok {
		return e.Code
	}
	return ""
}
