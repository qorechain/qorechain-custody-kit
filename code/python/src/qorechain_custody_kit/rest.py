# SPDX-License-Identifier: Apache-2.0
"""Minimal REST access for the examples and the live checks.

Production systems should query their own node.
"""

import json
import urllib.request
from typing import Any, Dict

DEFAULT_TESTNET_REST = "https://api-testnet.qore.host"

# The public endpoints refuse Python's default urllib User-Agent.
USER_AGENT = "qorechain-custody-kit"


def get_json(rest: str, path: str, timeout: float = 30.0) -> Dict[str, Any]:
    """GET a JSON document from ``rest + path``. Raises on a non-2xx status."""
    url = rest.rstrip("/") + path
    req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as res:  # noqa: S310 (https or a local node)
        return json.loads(res.read().decode("utf-8"))
