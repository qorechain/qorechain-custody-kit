// SPDX-License-Identifier: Apache-2.0
//
// Read-only checks against the testnet. Run with QORE_LIVE_TEST=1;
// QORE_REST overrides the endpoint (default https://api-testnet.qore.host).

package custodykit

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"os"
	"strconv"
	"strings"
	"testing"
)

// Derived from the public BIP-39 test mnemonic (vectors/custody-v1.json); its
// ML-DSA-87 key is registered on the testnet and anyone may use it there.
const publicTestAccount = "qor19rl4cm2hmr8afy4kldpxz3fka4jguq0agt672h"

func liveREST(t *testing.T) string {
	t.Helper()
	if os.Getenv("QORE_LIVE_TEST") != "1" {
		t.Skip("set QORE_LIVE_TEST=1 to run the testnet checks")
	}
	if r := os.Getenv("QORE_REST"); r != "" {
		return r
	}
	return DefaultTestnetREST
}

func TestLiveStakingParams(t *testing.T) {
	rest := liveREST(t)
	var staking struct {
		Params struct {
			BondDenom     string `json:"bond_denom"`
			UnbondingTime string `json:"unbonding_time"`
		} `json:"params"`
	}
	if err := GetJSON(rest, "/cosmos/staking/v1beta1/params", &staking); err != nil {
		t.Fatal(err)
	}
	if staking.Params.BondDenom != "uqor" || staking.Params.UnbondingTime != "1814400s" {
		t.Fatalf("staking params: %+v", staking.Params)
	}
	var tier struct {
		Enabled   bool `json:"enabled"`
		LockTiers []struct {
			Months int `json:"months"`
		} `json:"lock_tiers"`
	}
	if err := GetJSON(rest, "/qorechain/stakingtier/v1/params", &tier); err != nil {
		t.Fatal(err)
	}
	if !tier.Enabled || len(tier.LockTiers) != 3 || tier.LockTiers[0].Months != 3 || tier.LockTiers[1].Months != 6 || tier.LockTiers[2].Months != 12 {
		t.Fatalf("staking tier params: %+v", tier)
	}
}

func TestLiveDepositQuery(t *testing.T) {
	rest := liveREST(t)
	var recent struct {
		TxResponses []json.RawMessage `json:"tx_responses"`
	}
	path := "/cosmos/tx/v1beta1/txs?query=" + PercentEncode("message.action='/cosmos.bank.v1beta1.MsgSend'") + "&order_by=ORDER_BY_DESC&limit=20"
	if err := GetJSON(rest, path, &recent); err != nil {
		t.Fatal(err)
	}
	var target *TxResponse
	var to string
	want := new(big.Int)
	for _, raw := range recent.TxResponses {
		r, err := ParseTxResponse(raw)
		if err != nil || r.Code != "0" || len(r.Tx.Body.Messages) != 1 {
			continue
		}
		msg := r.Tx.Body.Messages[0]
		sum := new(big.Int)
		coins, _ := msg["amount"].([]any)
		for _, c := range coins {
			coin, _ := c.(map[string]any)
			if coin["denom"] == "uqor" {
				v, _ := new(big.Int).SetString(coin["amount"].(string), 10)
				sum.Add(sum, v)
			}
		}
		if sum.Sign() > 0 && msg["from_address"] != msg["to_address"] {
			target, to, want = &r, msg["to_address"].(string), sum
			break
		}
	}
	if target == nil {
		t.Fatal("no recent MsgSend of uqor on the testnet")
	}
	h, _ := strconv.ParseUint(target.Height, 10, 64)
	q, err := BuildDepositQuery(DepositQueryOptions{Address: to, MinHeight: &h, MaxHeight: &h})
	if err != nil {
		t.Fatal(err)
	}
	var found struct {
		TxResponses []json.RawMessage `json:"tx_responses"`
	}
	if err := GetJSON(rest, q, &found); err != nil {
		t.Fatal(err)
	}
	for _, raw := range found.TxResponses {
		r, _ := ParseTxResponse(raw)
		entries, err := ExtractDeposits(r, to, "")
		if err != nil {
			t.Fatal(err)
		}
		for _, e := range entries {
			if e.TxHash == target.TxHash && e.Creditable && e.MessageType == MsgSend && e.Amount == want.String() {
				return
			}
		}
	}
	t.Fatalf("deposit %s of %s uqor to %s not found", target.TxHash, want, to)
}

func TestLiveVerifyCommittedTx(t *testing.T) {
	rest := liveREST(t)
	var found struct {
		TxResponses []struct {
			TxHash string `json:"txhash"`
			Height string `json:"height"`
		} `json:"tx_responses"`
	}
	path := "/cosmos/tx/v1beta1/txs?query=" + PercentEncode("message.sender='"+publicTestAccount+"'") + "&order_by=ORDER_BY_DESC&limit=1"
	if err := GetJSON(rest, path, &found); err != nil {
		t.Fatal(err)
	}
	if len(found.TxResponses) == 0 {
		t.Skip("the public test account has not transacted on this network")
	}
	resp := found.TxResponses[0]
	var block struct {
		Block struct {
			Data struct {
				Txs []string `json:"txs"`
			} `json:"data"`
		} `json:"block"`
	}
	if err := GetJSON(rest, "/cosmos/base/tendermint/v1beta1/blocks/"+resp.Height, &block); err != nil {
		t.Fatal(err)
	}
	var txBytes []byte
	for _, b64 := range block.Block.Data.Txs {
		b, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			continue
		}
		sum := sha256.Sum256(b)
		if strings.EqualFold(ToHex(sum[:]), resp.TxHash) {
			txBytes = b
		}
	}
	if txBytes == nil {
		t.Fatal("transaction not found in its block")
	}
	var info struct {
		Info struct {
			AccountNumber string `json:"account_number"`
			PubKey        struct {
				Key string `json:"key"`
			} `json:"pub_key"`
		} `json:"info"`
	}
	if err := GetJSON(rest, "/cosmos/auth/v1beta1/account_info/"+publicTestAccount, &info); err != nil {
		t.Fatal(err)
	}
	var pqc struct {
		Account struct {
			PublicKey string `json:"public_key"`
		} `json:"account"`
	}
	if err := GetJSON(rest, "/qorechain/pqc/v1/account/"+publicTestAccount, &pqc); err != nil {
		t.Fatal(err)
	}
	var node struct {
		DefaultNodeInfo struct {
			Network string `json:"network"`
		} `json:"default_node_info"`
	}
	if err := GetJSON(rest, "/cosmos/base/tendermint/v1beta1/node_info", &node); err != nil {
		t.Fatal(err)
	}
	accNum, _ := strconv.ParseUint(info.Info.AccountNumber, 10, 64)
	pub, _ := base64.StdEncoding.DecodeString(info.Info.PubKey.Key)
	pq, _ := base64.StdEncoding.DecodeString(pqc.Account.PublicKey)
	r, err := VerifyTx(VerifyTxArgs{
		TxBytes:            txBytes,
		ChainID:            node.DefaultNodeInfo.Network,
		AccountNumber:      accNum,
		ClassicalPublicKey: pub,
		PqPublicKey:        pq,
	})
	if err != nil {
		t.Fatal(err)
	}
	sameJSON(t, r, json.RawMessage(`{"valid":true,"classical":true,"signerKey":"match","pq":{"valid":true,"signBytesVersion":"v2","reason":null}}`))
}
