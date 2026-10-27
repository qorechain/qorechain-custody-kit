// SPDX-License-Identifier: Apache-2.0
//
// Deposit detection over the REST API: a query builder for incoming
// transfers to an address, and a parser that turns one tx_response into
// candidate deposits with a credit decision.

package custodykit

import (
	"encoding/json"
	"fmt"
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

// FeeCollector is the fee collector module account (same address on both
// networks). Fees and EVM gas refunds move through it.
const FeeCollector = "qor17xpfvakm2amg962yls6f84z3kell8c5lyj5r7l"

// Message types the deposit rules know.
const (
	MsgSend        = "/cosmos.bank.v1beta1.MsgSend"
	MsgMultiSend   = "/cosmos.bank.v1beta1.MsgMultiSend"
	MsgEthereumTx  = "/cosmos.evm.vm.v1.MsgEthereumTx"
	DepositsPath   = "/cosmos/tx/v1beta1/txs"
	defaultLimit   = 50
	maxLimit       = 100
	defaultDenom   = "uqor"
	eventTransfer  = "transfer"
	eventCoinRecvd = "coin_received"
)

// DepositQueryOptions are the inputs of BuildDepositQuery.
type DepositQueryOptions struct {
	// Address is a qor1... or 0x... account address.
	Address string
	// MinHeight and MaxHeight are inclusive bounds; nil leaves them open.
	MinHeight *uint64
	MaxHeight *uint64
	// Event is "transfer" (default, transfer.recipient) or "coin_received"
	// (coin_received.receiver).
	Event string
	// Page is 1-based; 0 means 1.
	Page int
	// Limit is 1 to 100; 0 means 50.
	Limit int
	// OrderBy is "asc" (default, oldest first) or "desc".
	OrderBy string
}

// PercentEncode applies RFC 3986 percent-encoding: everything except
// unreserved characters.
func PercentEncode(s string) string {
	var sb strings.Builder
	for _, b := range []byte(s) {
		if (b >= 'A' && b <= 'Z') || (b >= 'a' && b <= 'z') || (b >= '0' && b <= '9') || b == '-' || b == '.' || b == '_' || b == '~' {
			sb.WriteByte(b)
		} else {
			fmt.Fprintf(&sb, "%%%02X", b)
		}
	}
	return sb.String()
}

// DepositEventQuery is the events query, for example
// transfer.recipient='qor1...' AND tx.height>=100 AND tx.height<=200.
func DepositEventQuery(opts DepositQueryOptions) (string, error) {
	check := ValidateAddress(opts.Address, ValidateAddressOptions{})
	if !check.Valid {
		return "", errorf(CodeInvalidArgument, "deposit address: %s", check.Error)
	}
	key := "transfer.recipient"
	switch opts.Event {
	case "", eventTransfer:
	case eventCoinRecvd:
		key = "coin_received.receiver"
	default:
		return "", errorf(CodeInvalidArgument, "event must be transfer or coin_received")
	}
	parts := []string{fmt.Sprintf("%s='%s'", key, check.Bech32)}
	if opts.MinHeight != nil {
		parts = append(parts, fmt.Sprintf("tx.height>=%d", *opts.MinHeight))
	}
	if opts.MaxHeight != nil {
		parts = append(parts, fmt.Sprintf("tx.height<=%d", *opts.MaxHeight))
	}
	return strings.Join(parts, " AND "), nil
}

// BuildDepositQuery returns the path and query string for
// GET /cosmos/tx/v1beta1/txs. Append it to a REST base URL.
func BuildDepositQuery(opts DepositQueryOptions) (string, error) {
	page := opts.Page
	if page == 0 {
		page = 1
	}
	limit := opts.Limit
	if limit == 0 {
		limit = defaultLimit
	}
	if page < 1 {
		return "", errorf(CodeInvalidArgument, "page must be 1 or more")
	}
	if limit < 1 || limit > maxLimit {
		return "", errorf(CodeInvalidArgument, "limit must be between 1 and 100")
	}
	order := "ORDER_BY_ASC"
	switch opts.OrderBy {
	case "", "asc":
	case "desc":
		order = "ORDER_BY_DESC"
	default:
		return "", errorf(CodeInvalidArgument, "orderBy must be asc or desc")
	}
	q, err := DepositEventQuery(opts)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%s?query=%s&order_by=%s&page=%d&limit=%d", DepositsPath, PercentEncode(q), order, page, limit), nil
}

// DepositEntry is one incoming transfer with its credit decision.
type DepositEntry struct {
	TxHash      string `json:"txhash"`
	Height      string `json:"height"`
	MsgIndex    int    `json:"msgIndex"`
	MessageType string `json:"messageType"`
	Sender      string `json:"sender"`
	// Amount is the integer amount in the base denom.
	Amount string `json:"amount"`
	Denom  string `json:"denom"`
	Memo   string `json:"memo"`
	// Creditable is true when the kit's rules consider this a deposit to credit.
	Creditable bool `json:"creditable"`
	// Reason says why it is not creditable: evm_failed, fee_refund or
	// unsupported_message; nil when creditable.
	Reason *string `json:"reason"`
}

// TxResponse is the part of a REST tx_response the parser reads.
type TxResponse struct {
	Height string          `json:"height"`
	TxHash string          `json:"txhash"`
	Code   json.Number     `json:"code"`
	Tx     txResponseTx    `json:"tx"`
	Events []txEventStruct `json:"events"`
}

type txResponseTx struct {
	Body struct {
		Messages []map[string]any `json:"messages"`
		Memo     string           `json:"memo"`
	} `json:"body"`
}

type txEventStruct struct {
	Type       string `json:"type"`
	Attributes []struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	} `json:"attributes"`
}

func (e txEventStruct) attr(key string) (string, bool) {
	for _, a := range e.Attributes {
		if a.Key == key {
			return a.Value, true
		}
	}
	return "", false
}

var amountPart = regexp.MustCompile(`^(\d+)(.+)$`)
var digits = regexp.MustCompile(`^\d+$`)

func sumDenom(amounts, denom string) (*big.Int, bool) {
	var total *big.Int
	for _, part := range strings.Split(amounts, ",") {
		m := amountPart.FindStringSubmatch(strings.TrimSpace(part))
		if m != nil && m[2] == denom {
			v, _ := new(big.Int).SetString(m[1], 10)
			if total == nil {
				total = new(big.Int)
			}
			total.Add(total, v)
		}
	}
	return total, total != nil
}

// ExtractDeposits returns the incoming transfers of denom ("" means uqor)
// to address in one tx_response (as returned by GET /cosmos/tx/v1beta1/txs
// or /txs/{hash}), with a credit decision for each.
//
//   - A failed transaction (code != 0) gives nothing.
//   - Transfers without a msg_index (fee payment) are ignored.
//   - MsgSend and MsgMultiSend outputs are creditable.
//   - MsgEthereumTx is creditable unless the EVM execution failed
//     (ethereumTxFailed) or the transfer is a gas refund from the fee collector.
//   - Any other message (rewards, contract calls, IBC) is returned with
//     Creditable false and reason unsupported_message, for review.
func ExtractDeposits(resp TxResponse, address, denom string) ([]DepositEntry, error) {
	check := ValidateAddress(address, ValidateAddressOptions{})
	if !check.Valid {
		return nil, errorf(CodeInvalidArgument, "deposit address: %s", check.Error)
	}
	if denom == "" {
		denom = defaultDenom
	}
	out := []DepositEntry{}
	if resp.Code != "" && resp.Code != "0" {
		return out, nil
	}
	failedEvm := map[string]bool{}
	for _, ev := range resp.Events {
		if ev.Type != "ethereum_tx" {
			continue
		}
		if _, failed := ev.attr("ethereumTxFailed"); failed {
			idx, _ := ev.attr("msg_index")
			failedEvm[idx] = true
		}
	}
	for _, ev := range resp.Events {
		if ev.Type != eventTransfer {
			continue
		}
		if r, _ := ev.attr("recipient"); r != check.Bech32 {
			continue
		}
		idx, ok := ev.attr("msg_index")
		if !ok || !digits.MatchString(idx) {
			continue
		}
		amounts, _ := ev.attr("amount")
		amount, ok := sumDenom(amounts, denom)
		if !ok {
			continue
		}
		msgIndex, err := strconv.Atoi(idx)
		if err != nil {
			continue
		}
		messageType := ""
		if msgIndex < len(resp.Tx.Body.Messages) {
			if t, ok := resp.Tx.Body.Messages[msgIndex]["@type"].(string); ok {
				messageType = t
			}
		}
		sender, _ := ev.attr("sender")
		var reason *string
		set := func(s string) { reason = &s }
		switch {
		case messageType == MsgEthereumTx && failedEvm[idx]:
			set("evm_failed")
		case sender == FeeCollector:
			set("fee_refund")
		case messageType != MsgSend && messageType != MsgMultiSend && messageType != MsgEthereumTx:
			set("unsupported_message")
		}
		out = append(out, DepositEntry{
			TxHash:      resp.TxHash,
			Height:      resp.Height,
			MsgIndex:    msgIndex,
			MessageType: messageType,
			Sender:      sender,
			Amount:      amount.String(),
			Denom:       denom,
			Memo:        resp.Tx.Body.Memo,
			Creditable:  reason == nil,
			Reason:      reason,
		})
	}
	return out, nil
}

// ParseTxResponse decodes one tx_response JSON object.
func ParseTxResponse(raw []byte) (TxResponse, error) {
	var r TxResponse
	if err := json.Unmarshal(raw, &r); err != nil {
		return TxResponse{}, errorf(CodeInvalidArgument, "not a tx_response: %v", err)
	}
	return r, nil
}
