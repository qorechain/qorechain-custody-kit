// SPDX-License-Identifier: Apache-2.0
//
// Checks the Go port against vectors/custody-v1.json and, when it has been
// fetched (scripts/fetch-qoresign-vectors.sh), against the hybrid
// transactions of vectors/qoresign-v1.json.

package custodykit

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

var vectorsDir = filepath.Join("..", "..", "vectors")

type vectorFile struct {
	Addresses struct {
		Valid []struct {
			Input        string          `json:"input"`
			Allow        []string        `json:"allow"`
			RequireEip55 bool            `json:"requireEip55"`
			Expected     json.RawMessage `json:"expected"`
		} `json:"valid"`
		Invalid []struct {
			Input        string   `json:"input"`
			Allow        []string `json:"allow"`
			RequireEip55 bool     `json:"requireEip55"`
			Error        string   `json:"error"`
		} `json:"invalid"`
	} `json:"addresses"`
	Transactions []struct {
		Name               string          `json:"name"`
		ChainID            string          `json:"chainId"`
		AccountNumber      uint64          `json:"accountNumber"`
		ClassicalKeyType   string          `json:"classicalKeyType"`
		ClassicalPublicKey string          `json:"classicalPublicKey"`
		PqPublicKey        string          `json:"pqPublicKey"`
		TxBytes            string          `json:"txBytes"`
		Decoded            json.RawMessage `json:"decoded"`
		VerifyCases        []struct {
			Description        string          `json:"description"`
			ChainID            *string         `json:"chainId"`
			AccountNumber      *uint64         `json:"accountNumber"`
			ClassicalPublicKey *string         `json:"classicalPublicKey"`
			ClassicalKeyType   *string         `json:"classicalKeyType"`
			PqPublicKey        *string         `json:"pqPublicKey"`
			OmitPqPublicKey    bool            `json:"omitPqPublicKey"`
			Expected           json.RawMessage `json:"expected"`
		} `json:"verifyCases"`
	} `json:"transactions"`
	Messages []struct {
		TypeURL string          `json:"typeUrl"`
		Value   string          `json:"value"`
		Decoded json.RawMessage `json:"decoded"`
	} `json:"messages"`
	Malformed []struct {
		Name    string `json:"name"`
		TxBytes string `json:"txBytes"`
		Error   string `json:"error"`
	} `json:"malformed"`
	DepositQueries []struct {
		Options  json.RawMessage `json:"options"`
		Expected string          `json:"expected"`
	} `json:"depositQueries"`
	DepositQueryErrors []struct {
		Options json.RawMessage `json:"options"`
		Error   string          `json:"error"`
	} `json:"depositQueryErrors"`
	Deposits []struct {
		Name       string          `json:"name"`
		Address    string          `json:"address"`
		Denom      string          `json:"denom"`
		TxResponse json.RawMessage `json:"txResponse"`
		Expected   json.RawMessage `json:"expected"`
	} `json:"deposits"`
}

func loadVectors(t *testing.T) vectorFile {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(vectorsDir, "custody-v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var v vectorFile
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

// sameJSON compares a Go value with expected JSON after a round trip
// through encoding/json on both sides.
func sameJSON(t *testing.T, got any, want json.RawMessage) {
	t.Helper()
	g, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	var a, b any
	if err := json.Unmarshal(g, &a); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(want, &b); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(a, b) {
		t.Fatalf("got  %s\nwant %s", g, want)
	}
}

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := FromHex(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestAddresses(t *testing.T) {
	v := loadVectors(t)
	for _, c := range v.Addresses.Valid {
		r := ValidateAddress(c.Input, ValidateAddressOptions{Allow: c.Allow, RequireEIP55: c.RequireEip55})
		var want map[string]any
		_ = json.Unmarshal(c.Expected, &want)
		want["valid"] = true
		w, _ := json.Marshal(want)
		sameJSON(t, r, w)
	}
	for _, c := range v.Addresses.Invalid {
		r := ValidateAddress(c.Input, ValidateAddressOptions{Allow: c.Allow, RequireEIP55: c.RequireEip55})
		if r.Valid || r.Error != c.Error {
			t.Errorf("%q: got valid=%v error=%s, want %s", c.Input, r.Valid, r.Error, c.Error)
		}
	}
}

func TestTransactions(t *testing.T) {
	v := loadVectors(t)
	for _, tx := range v.Transactions {
		txBytes := mustHex(t, tx.TxBytes)
		d, err := DecodeTx(txBytes)
		if err != nil {
			t.Fatalf("%s: %v", tx.Name, err)
		}
		sameJSON(t, d, tx.Decoded)
		for _, c := range tx.VerifyCases {
			args := VerifyTxArgs{
				TxBytes:            txBytes,
				ChainID:            tx.ChainID,
				AccountNumber:      tx.AccountNumber,
				ClassicalPublicKey: mustHex(t, tx.ClassicalPublicKey),
				ClassicalKeyType:   tx.ClassicalKeyType,
				PqPublicKey:        mustHex(t, tx.PqPublicKey),
			}
			if c.ChainID != nil {
				args.ChainID = *c.ChainID
			}
			if c.AccountNumber != nil {
				args.AccountNumber = *c.AccountNumber
			}
			if c.ClassicalPublicKey != nil {
				args.ClassicalPublicKey = mustHex(t, *c.ClassicalPublicKey)
			}
			if c.ClassicalKeyType != nil {
				args.ClassicalKeyType = *c.ClassicalKeyType
			}
			if c.PqPublicKey != nil {
				args.PqPublicKey = mustHex(t, *c.PqPublicKey)
			}
			if c.OmitPqPublicKey {
				args.PqPublicKey = nil
			}
			r, err := VerifyTx(args)
			if err != nil {
				t.Fatalf("%s / %s: %v", tx.Name, c.Description, err)
			}
			sameJSON(t, r, c.Expected)
		}
	}
}

func TestMessages(t *testing.T) {
	v := loadVectors(t)
	for _, m := range v.Messages {
		d, err := DecodeMessage(m.TypeURL, mustHex(t, m.Value))
		if err != nil {
			t.Fatalf("%s: %v", m.TypeURL, err)
		}
		sameJSON(t, d, m.Decoded)
	}
}

func TestMalformed(t *testing.T) {
	v := loadVectors(t)
	for _, m := range v.Malformed {
		_, err := DecodeTx(mustHex(t, m.TxBytes))
		if ErrorCode(err) != m.Error {
			t.Errorf("%s: got %v, want %s", m.Name, err, m.Error)
		}
	}
}

type queryOptionsJSON struct {
	Address   string  `json:"address"`
	MinHeight *uint64 `json:"minHeight"`
	MaxHeight *uint64 `json:"maxHeight"`
	Event     string  `json:"event"`
	Page      *int    `json:"page"`
	Limit     *int    `json:"limit"`
	OrderBy   string  `json:"orderBy"`
}

func queryOptions(t *testing.T, raw json.RawMessage) DepositQueryOptions {
	t.Helper()
	var o queryOptionsJSON
	if err := json.Unmarshal(raw, &o); err != nil {
		t.Fatal(err)
	}
	out := DepositQueryOptions{Address: o.Address, MinHeight: o.MinHeight, MaxHeight: o.MaxHeight, Event: o.Event, OrderBy: o.OrderBy}
	if o.Page != nil {
		out.Page = *o.Page
		if *o.Page == 0 {
			out.Page = -1 // an explicit 0 is an error, not the default
		}
	}
	if o.Limit != nil {
		out.Limit = *o.Limit
		if *o.Limit == 0 {
			out.Limit = -1
		}
	}
	return out
}

func TestDepositQueries(t *testing.T) {
	v := loadVectors(t)
	for _, q := range v.DepositQueries {
		got, err := BuildDepositQuery(queryOptions(t, q.Options))
		if err != nil {
			t.Fatal(err)
		}
		if got != q.Expected {
			t.Errorf("got  %s\nwant %s", got, q.Expected)
		}
	}
	for _, q := range v.DepositQueryErrors {
		_, err := BuildDepositQuery(queryOptions(t, q.Options))
		if ErrorCode(err) != q.Error {
			t.Errorf("%s: got %v, want %s", q.Options, err, q.Error)
		}
	}
}

func TestDeposits(t *testing.T) {
	v := loadVectors(t)
	for _, d := range v.Deposits {
		resp, err := ParseTxResponse(d.TxResponse)
		if err != nil {
			t.Fatal(err)
		}
		got, err := ExtractDeposits(resp, d.Address, d.Denom)
		if err != nil {
			t.Fatalf("%s: %v", d.Name, err)
		}
		sameJSON(t, got, d.Expected)
	}
}

func TestQoreSignVectors(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join(vectorsDir, "qoresign-v1.json"))
	if os.IsNotExist(err) {
		t.Skip("vectors/qoresign-v1.json not fetched (scripts/fetch-qoresign-vectors.sh)")
	}
	if err != nil {
		t.Fatal(err)
	}
	var q struct {
		ChainID  string `json:"chainId"`
		Accounts struct {
			Secp256k1 struct {
				PublicKey string `json:"publicKey"`
			} `json:"secp256k1"`
		} `json:"accounts"`
		Canonical []struct {
			PublicKey string `json:"publicKey"`
		} `json:"canonical"`
		HybridTx struct {
			AccountNumber uint64 `json:"accountNumber"`
			Cases         []struct {
				SignBytesVersion string `json:"signBytesVersion"`
				TxBytes          string `json:"txBytes"`
			} `json:"cases"`
		} `json:"hybridTx"`
	}
	if err := json.Unmarshal(raw, &q); err != nil {
		t.Fatal(err)
	}
	for _, c := range q.HybridTx.Cases {
		r, err := VerifyTx(VerifyTxArgs{
			TxBytes:            mustHex(t, c.TxBytes),
			ChainID:            q.ChainID,
			AccountNumber:      q.HybridTx.AccountNumber,
			ClassicalPublicKey: mustHex(t, q.Accounts.Secp256k1.PublicKey),
			PqPublicKey:        mustHex(t, q.Canonical[0].PublicKey),
			SignBytesVersion:   "either",
		})
		if err != nil {
			t.Fatal(err)
		}
		want := `{"valid":true,"classical":true,"signerKey":"match","pq":{"valid":true,"signBytesVersion":"` + c.SignBytesVersion + `","reason":null}}`
		sameJSON(t, r, json.RawMessage(want))
	}
}
