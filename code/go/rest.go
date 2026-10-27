// SPDX-License-Identifier: Apache-2.0
//
// Minimal REST access for the example and the live checks. Production
// systems should query their own node.

package custodykit

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// DefaultTestnetREST is the public testnet REST endpoint.
const DefaultTestnetREST = "https://api-testnet.qore.host"

var httpClient = &http.Client{Timeout: 60 * time.Second}

// GetJSON fetches rest + path and decodes the JSON body into out. A non-2xx
// status is an error.
func GetJSON(rest, path string, out any) error {
	url := strings.TrimRight(rest, "/") + path
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "qorechain-custody-kit")
	res, err := httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		return err
	}
	if res.StatusCode < 200 || res.StatusCode > 299 {
		return fmt.Errorf("GET %s: HTTP %d", url, res.StatusCode)
	}
	return json.Unmarshal(body, out)
}
