<!-- SPDX-License-Identifier: Apache-2.0 -->
# Contributing to the QoreChain custody kit

Issues, pull requests and discussion are welcome.

## Layout

| Path | Contents |
|---|---|
| `docs` | the integration guide |
| `code/ts` | TypeScript reference implementation and the vector generator |
| `code/python`, `code/go`, `code/rust`, `code/java` | ports with the same API and results |
| `vectors` | `custody-v1.json`, shared by every language |
| `scripts` | `fetch-qoresign-vectors.sh` (downloads the QoreSign vectors and checks their SHA-256) |

## Build and test

```bash
scripts/fetch-qoresign-vectors.sh                                   # optional, enables the QoreSign vector checks
(cd code/ts && pnpm install && pnpm build && pnpm typecheck && pnpm test)
(cd code/python && pip install -r requirements-dev.txt && python -m pytest)
(cd code/go && gofmt -l . && go vet ./... && go test ./...)
(cd code/rust && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test)
(cd code/java && mvn -B test)
```

Live checks against the testnet are read-only and run with `QORE_LIVE_TEST=1`; `QORE_REST` overrides the endpoint (useful when only a local node or relay is reachable).

## Changing the vectors

The TypeScript implementation is the reference. `code/ts/scripts/gen-vectors.mjs` writes `vectors/custody-v1.json`, with transactions hand-encoded and signed by QoreSign and the expected results written from the inputs. A change to the file must pass in every language in the same pull request. A change of meaning (not an addition) gets a new versioned file.

## Documentation

Values quoted from the network (parameters, releases, block times) are read live and dated. Prefer telling readers which endpoint to read over hard-coding a value.

## Pull requests

- Keep changes focused; add tests for behaviour changes.
- Pin dependencies exactly; use versions at least 14 days old and permissive licences (MIT, Apache-2.0, BSD, ISC).
- Every source file starts with an `SPDX-License-Identifier` line.

## Code of Conduct

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Do not open public issues for vulnerabilities; see [SECURITY.md](SECURITY.md).
