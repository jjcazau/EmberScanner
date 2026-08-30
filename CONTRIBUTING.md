# Contributing to Ember Scanner

Bug reports, feature requests, documentation improvements, and code contributions are welcome.

## Issues

Search the [existing issues](https://github.com/jjcazau/EmberScanner/issues) before opening a new one. Bug reports should include the affected version, operating system, relevant configuration, logs, and reproducible steps. Feature requests should explain the use case and expected behavior.

## Pull requests

Keep changes focused and explain their purpose and testing in the pull request. For substantial changes, open an issue first so the approach can be discussed.

Before submitting code:

```sh
cd server && go test ./...
cd ../client && npm ci && npm run build
```

Contributions are submitted under the repository's GPL license. Existing upstream copyright notices must be preserved.
