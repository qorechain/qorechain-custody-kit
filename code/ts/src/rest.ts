// SPDX-License-Identifier: Apache-2.0
//
// Minimal REST access for the examples and the live checks. Production
// systems should query their own node.

export const DEFAULT_TESTNET_REST = "https://api-testnet.qore.host";

/** GET a JSON document from `rest + path`. Throws on a non-2xx status. */
export async function getJson(rest: string, path: string): Promise<Record<string, unknown>> {
  const url = rest.replace(/\/+$/, "") + path;
  const res = await fetch(url, { headers: { accept: "application/json", "user-agent": "qorechain-custody-kit" } });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}
