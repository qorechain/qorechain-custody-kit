// SPDX-License-Identifier: Apache-2.0
//
// Decode a signed native-lane transaction (TxRaw) into what a custody
// operator reviews before broadcasting: the messages and their fields, the
// fee, the signer, and whether the ML-DSA-87 layer is present.

package custodykit

import (
	"crypto/sha256"
	"strconv"
	"strings"
)

// PQCHybridTypeURL is the type URL of the ML-DSA-87 layer extension.
const PQCHybridTypeURL = "/qorechain.pqc.v1.PQCHybridSignature"

// Coin is an amount of one denom.
type Coin struct {
	Denom  string `json:"denom"`
	Amount string `json:"amount"`
}

// InputOutput is one side of a MsgMultiSend.
type InputOutput struct {
	Address string `json:"address"`
	Coins   []Coin `json:"coins"`
}

// DecodedMessage is one message of a transaction.
type DecodedMessage struct {
	TypeURL string `json:"typeUrl"`
	// Fields holds the decoded fields (proto field names) for the message
	// types the kit knows; nil otherwise.
	Fields map[string]any `json:"fields"`
	// Value is the hex of the message bytes, only for unknown message types.
	Value *string `json:"value"`
}

// PqcLayerSummary describes one ML-DSA-87 layer extension.
type PqcLayerSummary struct {
	AlgorithmID     uint64 `json:"algorithmId"`
	SignatureLength int    `json:"signatureLength"`
	// PublicKeyLength is 0 when the public key is not embedded.
	PublicKeyLength int `json:"publicKeyLength"`
}

// DecodedSigner is one signer info of the auth info.
type DecodedSigner struct {
	PublicKeyType *string `json:"publicKeyType"`
	// PublicKey is the hex of the compressed secp256k1 key, for single-key accounts.
	PublicKey *string `json:"publicKey"`
	Sequence  string  `json:"sequence"`
	// SignMode is 1 for SIGN_MODE_DIRECT, nil for a multisig mode.
	SignMode *uint64 `json:"signMode"`
}

// Fee is the fee of a transaction.
type Fee struct {
	Amount   []Coin `json:"amount"`
	GasLimit string `json:"gasLimit"`
	Payer    string `json:"payer"`
	Granter  string `json:"granter"`
}

// DecodedTx is a decoded TxRaw.
type DecodedTx struct {
	// TxHash is the uppercase hex SHA-256 of the transaction bytes.
	TxHash                      string            `json:"txHash"`
	Messages                    []DecodedMessage  `json:"messages"`
	Memo                        string            `json:"memo"`
	TimeoutHeight               string            `json:"timeoutHeight"`
	Unordered                   bool              `json:"unordered"`
	TimeoutTimestampSeconds     string            `json:"timeoutTimestampSeconds"`
	ExtensionOptions            []string          `json:"extensionOptions"`
	NonCriticalExtensionOptions []string          `json:"nonCriticalExtensionOptions"`
	PqcLayers                   []PqcLayerSummary `json:"pqcLayers"`
	Signers                     []DecodedSigner   `json:"signers"`
	Fee                         Fee               `json:"fee"`
	SignatureCount              int               `json:"signatureCount"`
}

type fieldKind int

const (
	kString fieldKind = iota
	kUint
	kBool
	kBytes
	kCoin
	kCoins
	kStrings
	kIO
)

type fieldSpec struct {
	num  uint64
	name string
	kind fieldKind
}

var delegationLayout = []fieldSpec{
	{1, "delegator_address", kString},
	{2, "validator_address", kString},
	{3, "amount", kCoin},
}

// knownMessages are the field layouts of the message types a custodian handles.
var knownMessages = map[string][]fieldSpec{
	"/cosmos.bank.v1beta1.MsgSend": {
		{1, "from_address", kString}, {2, "to_address", kString}, {3, "amount", kCoins},
	},
	"/cosmos.bank.v1beta1.MsgMultiSend":     {{1, "inputs", kIO}, {2, "outputs", kIO}},
	"/cosmos.staking.v1beta1.MsgDelegate":   delegationLayout,
	"/cosmos.staking.v1beta1.MsgUndelegate": delegationLayout,
	"/cosmos.staking.v1beta1.MsgBeginRedelegate": {
		{1, "delegator_address", kString}, {2, "validator_src_address", kString},
		{3, "validator_dst_address", kString}, {4, "amount", kCoin},
	},
	"/cosmos.staking.v1beta1.MsgCancelUnbondingDelegation": {
		{1, "delegator_address", kString}, {2, "validator_address", kString},
		{3, "amount", kCoin}, {4, "creation_height", kUint},
	},
	"/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward": {
		{1, "delegator_address", kString}, {2, "validator_address", kString},
	},
	"/cosmos.distribution.v1beta1.MsgSetWithdrawAddress": {
		{1, "delegator_address", kString}, {2, "withdraw_address", kString},
	},
	"/qorechain.stakingtier.v1.MsgLockDelegation": {
		{1, "delegator", kString}, {2, "validator", kString}, {3, "amount", kString}, {4, "months", kUint},
	},
	"/qorechain.stakingtier.v1.MsgUnlockEarly": {{1, "delegator", kString}, {2, "lock_id", kUint}},
	"/qorechain.stakingtier.v1.MsgClaimBonus":  {{1, "holder", kString}},
	"/qorechain.pqc.v1.MsgRegisterPQCKeyV2": {
		{1, "sender", kString}, {2, "public_key", kBytes}, {3, "algorithm_id", kUint},
		{4, "ecdsa_pubkey", kBytes}, {5, "key_type", kString}, {6, "proof_of_possession", kBytes},
	},
	"/qorechain.pqc.v1.MsgRotatePQCKey": {
		{1, "sender", kString}, {2, "old_public_key", kBytes}, {3, "new_public_key", kBytes},
		{4, "old_signature", kBytes}, {5, "new_signature", kBytes},
	},
	"/qorechain.pqc.v1.MsgOpenEVMWindow": {
		{1, "sender", kString}, {2, "blocks", kUint}, {3, "max_txs", kUint},
		{4, "max_value", kString}, {5, "native_only", kBool}, {6, "allowed_targets", kStrings},
	},
	"/qorechain.pqc.v1.MsgCloseEVMWindow": {{1, "sender", kString}},
}

// KnownMessageTypes lists the message type URLs DecodeMessage decodes field by field.
func KnownMessageTypes() []string {
	out := make([]string, 0, len(knownMessages))
	for k := range knownMessages {
		out = append(out, k)
	}
	return out
}

func unknownField(what string, f field) error {
	return errorf(CodeUnknownField, "%s: unknown field %d", what, f.num)
}

func decodeCoin(b []byte) (Coin, error) {
	c := Coin{}
	fs, err := readFields(b)
	if err != nil {
		return c, err
	}
	for _, f := range fs {
		switch f.num {
		case 1:
			c.Denom, err = asString(f, "Coin")
		case 2:
			c.Amount, err = asString(f, "Coin")
		default:
			err = unknownField("Coin", f)
		}
		if err != nil {
			return c, err
		}
	}
	return c, nil
}

func decodeCoinField(f field, what string) (Coin, error) {
	b, err := asBytes(f, what)
	if err != nil {
		return Coin{}, err
	}
	return decodeCoin(b)
}

func decodeIO(b []byte) (InputOutput, error) {
	io := InputOutput{Coins: []Coin{}}
	fs, err := readFields(b)
	if err != nil {
		return io, err
	}
	for _, f := range fs {
		switch f.num {
		case 1:
			io.Address, err = asString(f, "Input/Output")
		case 2:
			var c Coin
			c, err = decodeCoinField(f, "Input/Output")
			io.Coins = append(io.Coins, c)
		default:
			err = unknownField("Input/Output", f)
		}
		if err != nil {
			return io, err
		}
	}
	return io, nil
}

func defaultFor(k fieldKind) any {
	switch k {
	case kString, kBytes:
		return ""
	case kUint:
		return "0"
	case kBool:
		return false
	case kCoin:
		return nil
	case kCoins:
		return []Coin{}
	case kStrings:
		return []string{}
	default:
		return []InputOutput{}
	}
}

// DecodeMessage decodes one message. Unknown types come back with their bytes in hex.
func DecodeMessage(typeURL string, value []byte) (DecodedMessage, error) {
	layout, ok := knownMessages[typeURL]
	if !ok {
		h := ToHex(value)
		return DecodedMessage{TypeURL: typeURL, Value: &h}, nil
	}
	fields := map[string]any{}
	for _, s := range layout {
		fields[s.name] = defaultFor(s.kind)
	}
	fs, err := readFields(value)
	if err != nil {
		return DecodedMessage{}, err
	}
	for _, f := range fs {
		var spec *fieldSpec
		for i := range layout {
			if layout[i].num == f.num {
				spec = &layout[i]
				break
			}
		}
		if spec == nil {
			return DecodedMessage{}, unknownField(typeURL, f)
		}
		switch spec.kind {
		case kString:
			fields[spec.name], err = asString(f, typeURL)
		case kBytes:
			var b []byte
			b, err = asBytes(f, typeURL)
			fields[spec.name] = ToHex(b)
		case kUint:
			var v uint64
			v, err = asUint(f, typeURL)
			fields[spec.name] = strconv.FormatUint(v, 10)
		case kBool:
			var v uint64
			v, err = asUint(f, typeURL)
			fields[spec.name] = v != 0
		case kCoin:
			var c Coin
			c, err = decodeCoinField(f, typeURL)
			fields[spec.name] = c
		case kCoins:
			var c Coin
			c, err = decodeCoinField(f, typeURL)
			fields[spec.name] = append(fields[spec.name].([]Coin), c)
		case kStrings:
			var s string
			s, err = asString(f, typeURL)
			fields[spec.name] = append(fields[spec.name].([]string), s)
		case kIO:
			var b []byte
			if b, err = asBytes(f, typeURL); err == nil {
				var io InputOutput
				io, err = decodeIO(b)
				fields[spec.name] = append(fields[spec.name].([]InputOutput), io)
			}
		}
		if err != nil {
			return DecodedMessage{}, err
		}
	}
	return DecodedMessage{TypeURL: typeURL, Fields: fields}, nil
}

func decodeAny(b []byte, what string) (string, []byte, error) {
	typeURL := ""
	value := []byte{}
	fs, err := readFields(b)
	if err != nil {
		return "", nil, err
	}
	for _, f := range fs {
		switch f.num {
		case 1:
			typeURL, err = asString(f, what)
		case 2:
			value, err = asBytes(f, what)
		default:
			err = unknownField(what, f)
		}
		if err != nil {
			return "", nil, err
		}
	}
	return typeURL, value, nil
}

func decodePqcLayer(b []byte) (PqcLayerSummary, error) {
	out := PqcLayerSummary{}
	fs, err := readFields(b)
	if err != nil {
		return out, err
	}
	for _, f := range fs {
		switch f.num {
		case 1:
			out.AlgorithmID, err = asUint(f, "PQCHybridSignature")
		case 2:
			var s []byte
			s, err = asBytes(f, "PQCHybridSignature")
			out.SignatureLength = len(s)
		case 3:
			var s []byte
			s, err = asBytes(f, "PQCHybridSignature")
			out.PublicKeyLength = len(s)
		default:
			err = unknownField("PQCHybridSignature", f)
		}
		if err != nil {
			return out, err
		}
	}
	return out, nil
}

var singleKeyTypes = map[string]bool{
	"/cosmos.crypto.secp256k1.PubKey":           true,
	"/cosmos.evm.crypto.v1.ethsecp256k1.PubKey": true,
}

func decodeSigner(b []byte) (DecodedSigner, error) {
	s := DecodedSigner{Sequence: "0"}
	fs, err := readFields(b)
	if err != nil {
		return s, err
	}
	for _, f := range fs {
		switch f.num {
		case 1:
			var pk []byte
			if pk, err = asBytes(f, "SignerInfo"); err != nil {
				return s, err
			}
			typeURL, value, err := decodeAny(pk, "SignerInfo.public_key")
			if err != nil {
				return s, err
			}
			s.PublicKeyType = &typeURL
			if singleKeyTypes[typeURL] {
				kfs, err := readFields(value)
				if err != nil {
					return s, err
				}
				for _, k := range kfs {
					if k.num != 1 {
						return s, unknownField("PubKey", k)
					}
					kb, err := asBytes(k, "PubKey")
					if err != nil {
						return s, err
					}
					h := ToHex(kb)
					s.PublicKey = &h
				}
			}
		case 2:
			var mb []byte
			if mb, err = asBytes(f, "ModeInfo"); err != nil {
				return s, err
			}
			mfs, err := readFields(mb)
			if err != nil {
				return s, err
			}
			for _, m := range mfs {
				switch m.num {
				case 1:
					zero := uint64(0)
					s.SignMode = &zero
					sb, err := asBytes(m, "ModeInfo.Single")
					if err != nil {
						return s, err
					}
					sfs, err := readFields(sb)
					if err != nil {
						return s, err
					}
					for _, single := range sfs {
						if single.num != 1 {
							return s, unknownField("ModeInfo.Single", single)
						}
						v, err := asUint(single, "ModeInfo.Single")
						if err != nil {
							return s, err
						}
						s.SignMode = &v
					}
				case 2:
					if err := expectWire(m, wireLen, "ModeInfo.Multi"); err != nil {
						return s, err
					}
					s.SignMode = nil
				default:
					return s, unknownField("ModeInfo", m)
				}
			}
		case 3:
			var v uint64
			if v, err = asUint(f, "SignerInfo"); err != nil {
				return s, err
			}
			s.Sequence = strconv.FormatUint(v, 10)
		default:
			return s, unknownField("SignerInfo", f)
		}
	}
	return s, nil
}

// DecodeTx decodes a signed TxRaw. Errors are *Error with code MALFORMED_TX
// or UNKNOWN_FIELD.
func DecodeTx(txBytes []byte) (DecodedTx, error) {
	var bodyBytes, authInfoBytes []byte
	haveBody, haveAuth := false, false
	sigs := 0
	fs, err := readFields(txBytes)
	if err != nil {
		return DecodedTx{}, err
	}
	for _, f := range fs {
		switch f.num {
		case 1:
			bodyBytes, err = asBytes(f, "TxRaw")
			haveBody = true
		case 2:
			authInfoBytes, err = asBytes(f, "TxRaw")
			haveAuth = true
		case 3:
			_, err = asBytes(f, "TxRaw")
			sigs++
		default:
			err = unknownField("TxRaw", f)
		}
		if err != nil {
			return DecodedTx{}, err
		}
	}
	if !haveBody || !haveAuth {
		return DecodedTx{}, malformed("TxRaw needs body_bytes and auth_info_bytes")
	}
	sum := sha256.Sum256(txBytes)
	tx := DecodedTx{
		TxHash:                      strings.ToUpper(ToHex(sum[:])),
		Messages:                    []DecodedMessage{},
		TimeoutHeight:               "0",
		TimeoutTimestampSeconds:     "0",
		ExtensionOptions:            []string{},
		NonCriticalExtensionOptions: []string{},
		PqcLayers:                   []PqcLayerSummary{},
		Signers:                     []DecodedSigner{},
		Fee:                         Fee{Amount: []Coin{}, GasLimit: "0"},
		SignatureCount:              sigs,
	}

	bfs, err := readFields(bodyBytes)
	if err != nil {
		return DecodedTx{}, err
	}
	for _, f := range bfs {
		switch f.num {
		case 1:
			var b []byte
			if b, err = asBytes(f, "TxBody"); err != nil {
				break
			}
			var typeURL string
			var value []byte
			if typeURL, value, err = decodeAny(b, "TxBody.messages"); err != nil {
				break
			}
			var m DecodedMessage
			if m, err = DecodeMessage(typeURL, value); err == nil {
				tx.Messages = append(tx.Messages, m)
			}
		case 2:
			tx.Memo, err = asString(f, "TxBody")
		case 3:
			var v uint64
			v, err = asUint(f, "TxBody")
			tx.TimeoutHeight = strconv.FormatUint(v, 10)
		case 4:
			var v uint64
			v, err = asUint(f, "TxBody")
			tx.Unordered = v != 0
		case 5:
			var b []byte
			if b, err = asBytes(f, "TxBody"); err != nil {
				break
			}
			var tfs []field
			if tfs, err = readFields(b); err != nil {
				break
			}
			for _, t := range tfs {
				var v uint64
				switch t.num {
				case 1:
					v, err = asUint(t, "Timestamp")
					tx.TimeoutTimestampSeconds = strconv.FormatUint(v, 10)
				case 2:
					_, err = asUint(t, "Timestamp")
				default:
					err = unknownField("Timestamp", t)
				}
				if err != nil {
					break
				}
			}
		case 1023:
			var b []byte
			if b, err = asBytes(f, "TxBody"); err != nil {
				break
			}
			var typeURL string
			var value []byte
			if typeURL, value, err = decodeAny(b, "TxBody.extension_options"); err != nil {
				break
			}
			tx.ExtensionOptions = append(tx.ExtensionOptions, typeURL)
			if typeURL == PQCHybridTypeURL {
				var l PqcLayerSummary
				if l, err = decodePqcLayer(value); err == nil {
					tx.PqcLayers = append(tx.PqcLayers, l)
				}
			}
		case 2047:
			var b []byte
			if b, err = asBytes(f, "TxBody"); err != nil {
				break
			}
			var typeURL string
			if typeURL, _, err = decodeAny(b, "TxBody.non_critical_extension_options"); err == nil {
				tx.NonCriticalExtensionOptions = append(tx.NonCriticalExtensionOptions, typeURL)
			}
		default:
			err = unknownField("TxBody", f)
		}
		if err != nil {
			return DecodedTx{}, err
		}
	}

	afs, err := readFields(authInfoBytes)
	if err != nil {
		return DecodedTx{}, err
	}
	for _, f := range afs {
		switch f.num {
		case 1:
			var b []byte
			if b, err = asBytes(f, "AuthInfo"); err != nil {
				break
			}
			var s DecodedSigner
			if s, err = decodeSigner(b); err == nil {
				tx.Signers = append(tx.Signers, s)
			}
		case 2:
			var b []byte
			if b, err = asBytes(f, "AuthInfo"); err != nil {
				break
			}
			var gfs []field
			if gfs, err = readFields(b); err != nil {
				break
			}
			for _, g := range gfs {
				switch g.num {
				case 1:
					var c Coin
					if c, err = decodeCoinField(g, "Fee"); err == nil {
						tx.Fee.Amount = append(tx.Fee.Amount, c)
					}
				case 2:
					var v uint64
					v, err = asUint(g, "Fee")
					tx.Fee.GasLimit = strconv.FormatUint(v, 10)
				case 3:
					tx.Fee.Payer, err = asString(g, "Fee")
				case 4:
					tx.Fee.Granter, err = asString(g, "Fee")
				default:
					err = unknownField("Fee", g)
				}
				if err != nil {
					break
				}
			}
		default:
			err = unknownField("AuthInfo", f)
		}
		if err != nil {
			return DecodedTx{}, err
		}
	}
	return tx, nil
}
