# SPDX-License-Identifier: Apache-2.0
"""Errors with stable codes, identical in every language of the kit."""

#: The bytes are not a well-formed transaction.
MALFORMED_TX = "MALFORMED_TX"
#: A field the decoder does not know, in a structure it decodes strictly.
UNKNOWN_FIELD = "UNKNOWN_FIELD"
#: A caller error (bad option, bad address for a query).
INVALID_ARGUMENT = "INVALID_ARGUMENT"


class CustodyKitError(Exception):
    """Raised on purpose by the kit; ``code`` is one of the codes above."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
