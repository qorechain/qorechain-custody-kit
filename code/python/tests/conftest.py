# SPDX-License-Identifier: Apache-2.0
import json
from pathlib import Path

import pytest

VECTORS_DIR = Path(__file__).resolve().parents[3] / "vectors"


@pytest.fixture(scope="session")
def vectors():
    return json.loads((VECTORS_DIR / "custody-v1.json").read_text(encoding="utf-8"))
