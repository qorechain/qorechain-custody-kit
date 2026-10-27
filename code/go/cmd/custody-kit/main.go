// SPDX-License-Identifier: Apache-2.0
//
// Example command line over the kit:
//
//	custody-kit validate <address> [--allow-validator] [--require-eip55]
//	custody-kit decode <tx hex or base64>
//	custody-kit verify <tx hex or base64> --chain-id ID --account-number N
//	                   --pubkey HEX [--eth] [--pq-pubkey HEX]
//	custody-kit deposits <address> [--from-height H] [--to-height H] [--rest URL]
package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"strconv"

	custodykit "github.com/qorechain/qorechain-custody-kit/code/go"
)

func flag(args []string, name string) string {
	for i, a := range args {
		if a == name && i+1 < len(args) {
			return args[i+1]
		}
	}
	return ""
}

func has(args []string, name string) bool {
	for _, a := range args {
		if a == name {
			return true
		}
	}
	return false
}

var hexRe = regexp.MustCompile(`^(0x)?[0-9a-fA-F]+$`)

func txBytesFrom(s string) ([]byte, error) {
	if hexRe.MatchString(s) {
		return custodykit.FromHex(s)
	}
	return base64.StdEncoding.DecodeString(s)
}

func print(v any) {
	b, _ := json.MarshalIndent(v, "", "  ")
	fmt.Println(string(b))
}

func run(argv []string) (int, error) {
	if len(argv) < 2 {
		fmt.Fprintln(os.Stderr, "usage: custody-kit validate|decode|verify|deposits <arg> [options]")
		return 2, nil
	}
	cmd, arg, rest := argv[0], argv[1], argv[2:]
	switch cmd {
	case "validate":
		allow := []string{custodykit.KindAccount}
		if has(rest, "--allow-validator") {
			allow = append(allow, custodykit.KindValidator)
		}
		r := custodykit.ValidateAddress(arg, custodykit.ValidateAddressOptions{Allow: allow, RequireEIP55: has(rest, "--require-eip55")})
		print(r)
		if !r.Valid {
			return 1, nil
		}
		return 0, nil
	case "decode":
		b, err := txBytesFrom(arg)
		if err != nil {
			return 1, err
		}
		d, err := custodykit.DecodeTx(b)
		if err != nil {
			return 1, err
		}
		print(d)
		return 0, nil
	case "verify":
		b, err := txBytesFrom(arg)
		if err != nil {
			return 1, err
		}
		accNum, _ := strconv.ParseUint(flag(rest, "--account-number"), 10, 64)
		pub, err := custodykit.FromHex(flag(rest, "--pubkey"))
		if err != nil {
			return 1, err
		}
		args := custodykit.VerifyTxArgs{TxBytes: b, ChainID: flag(rest, "--chain-id"), AccountNumber: accNum, ClassicalPublicKey: pub, ClassicalKeyType: "secp256k1"}
		if has(rest, "--eth") {
			args.ClassicalKeyType = "eth_secp256k1"
		}
		if pq := flag(rest, "--pq-pubkey"); pq != "" {
			if args.PqPublicKey, err = custodykit.FromHex(pq); err != nil {
				return 1, err
			}
		}
		r, err := custodykit.VerifyTx(args)
		if err != nil {
			return 1, err
		}
		print(r)
		if !r.Valid {
			return 1, nil
		}
		return 0, nil
	case "deposits":
		restURL := flag(rest, "--rest")
		if restURL == "" {
			restURL = os.Getenv("QORE_REST")
		}
		if restURL == "" {
			restURL = custodykit.DefaultTestnetREST
		}
		opts := custodykit.DepositQueryOptions{Address: arg}
		if s := flag(rest, "--from-height"); s != "" {
			h, err := strconv.ParseUint(s, 10, 64)
			if err != nil {
				return 2, err
			}
			opts.MinHeight = &h
		}
		if s := flag(rest, "--to-height"); s != "" {
			h, err := strconv.ParseUint(s, 10, 64)
			if err != nil {
				return 2, err
			}
			opts.MaxHeight = &h
		}
		path, err := custodykit.BuildDepositQuery(opts)
		if err != nil {
			return 1, err
		}
		var body struct {
			TxResponses []json.RawMessage `json:"tx_responses"`
		}
		if err := custodykit.GetJSON(restURL, path, &body); err != nil {
			return 1, err
		}
		out := []custodykit.DepositEntry{}
		for _, raw := range body.TxResponses {
			r, err := custodykit.ParseTxResponse(raw)
			if err != nil {
				return 1, err
			}
			entries, err := custodykit.ExtractDeposits(r, arg, "")
			if err != nil {
				return 1, err
			}
			out = append(out, entries...)
		}
		print(out)
		return 0, nil
	default:
		fmt.Fprintf(os.Stderr, "unknown command %s\n", cmd)
		return 2, nil
	}
}

func main() {
	code, err := run(os.Args[1:])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
	}
	os.Exit(code)
}
