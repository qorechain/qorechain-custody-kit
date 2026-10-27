// SPDX-License-Identifier: Apache-2.0
//
// Verify a signed native-lane transaction before it is broadcast: the
// secp256k1 signature, the ML-DSA-87 layer against the account's registered
// key, and that the signer recorded in the transaction is the expected key.

package custodykit

import (
	qoresign "github.com/qorechain/qoresign/go"
)

// VerifyTxArgs are the inputs of VerifyTx.
type VerifyTxArgs struct {
	// TxBytes is the encoded TxRaw.
	TxBytes []byte
	ChainID string
	// AccountNumber comes from /cosmos/auth/v1beta1/account_info/{address}.
	AccountNumber uint64
	// ClassicalPublicKey is the signer's 33-byte compressed secp256k1 key.
	ClassicalPublicKey []byte
	// ClassicalKeyType is "secp256k1" (default, coin type 118 accounts) or
	// "eth_secp256k1" (eth-native accounts).
	ClassicalKeyType string
	// PqPublicKey is the ML-DSA-87 key registered for the account
	// (/qorechain/pqc/v1/account/{address}). Nil checks the classical
	// signature only.
	PqPublicKey []byte
	// SignBytesVersion is "v1", "v2" (default, what both public networks
	// verify) or "either".
	SignBytesVersion string
}

// PqResult is the outcome of the ML-DSA-87 layer check.
type PqResult struct {
	Valid            bool    `json:"valid"`
	SignBytesVersion *string `json:"signBytesVersion"`
	Reason           *string `json:"reason"`
}

// VerifyTxResult is the outcome of VerifyTx.
type VerifyTxResult struct {
	// Valid is true when every check that was asked for passed.
	Valid     bool `json:"valid"`
	Classical bool `json:"classical"`
	// SignerKey is "match", "absent" (the transaction carries no public key;
	// the account's stored key applies) or "mismatch".
	SignerKey string `json:"signerKey"`
	// Pq is nil when no ML-DSA-87 key was given.
	Pq *PqResult `json:"pq"`
}

// VerifyTx verifies a single-signer transaction. It returns an error on
// malformed input, never on a bad signature.
func VerifyTx(args VerifyTxArgs) (VerifyTxResult, error) {
	decoded, err := DecodeTx(args.TxBytes)
	if err != nil {
		return VerifyTxResult{}, err
	}
	signerKey := "absent"
	if len(decoded.Signers) == 1 && decoded.Signers[0].PublicKey != nil {
		if *decoded.Signers[0].PublicKey == ToHex(args.ClassicalPublicKey) {
			signerKey = "match"
		} else {
			signerKey = "mismatch"
		}
	} else if len(decoded.Signers) != 1 {
		signerKey = "mismatch"
	}
	keyType := qoresign.ClassicalKeyType(args.ClassicalKeyType)
	if keyType == "" {
		keyType = qoresign.Secp256k1
	}
	version := qoresign.SignBytesVersion(args.SignBytesVersion)
	if version == "" {
		version = qoresign.SignBytesV2
	}
	r, err := qoresign.VerifyHybridTx(qoresign.VerifyHybridTxArgs{
		TxBytes:            args.TxBytes,
		ChainID:            args.ChainID,
		AccountNumber:      args.AccountNumber,
		ClassicalPublicKey: args.ClassicalPublicKey,
		ClassicalKeyType:   keyType,
		PqPublicKey:        args.PqPublicKey,
		SignBytesVersion:   version,
	})
	if err != nil {
		return VerifyTxResult{}, errorf(CodeInvalidArgument, "%v", err)
	}
	out := VerifyTxResult{Valid: r.Valid && signerKey != "mismatch", Classical: r.Classical, SignerKey: signerKey}
	if r.Pq != nil {
		pq := &PqResult{Valid: r.Pq.Valid}
		if r.Pq.SignBytesVersion != "" {
			v := string(r.Pq.SignBytesVersion)
			pq.SignBytesVersion = &v
		}
		if r.Pq.Reason != "" {
			reason := string(r.Pq.Reason)
			pq.Reason = &reason
		}
		out.Pq = pq
	}
	return out, nil
}
