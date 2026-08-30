![Ember Scanner](./docs/images/ember-scanner.png?raw=true)

# Ember Scanner

Ember Scanner ingests and distributes audio produced by software-defined radio recorders. Its web interface recreates the experience of a physical radio scanner while adding search, filtering, administration, and remote listening features.

This project is a fork of [Rdio Scanner](https://github.com/chuot/rdio-scanner). Ember Scanner is independently maintained and is not an official Rdio Scanner release.

## Recorder compatibility

Ember Scanner accepts per-conversation or per-transmission audio files. Known compatible recorders include:

| Recorder                                                       | API | Directory watch |
| -------------------------------------------------------------- | --- | --------------- |
| [Trunk Recorder](https://github.com/robotastic/trunk-recorder) | X   | X               |
| [RTLSDR-Airband](https://github.com/szpajder/RTLSDR-Airband)   |     | X               |
| [SDRTrunk](https://github.com/DSheirer/sdrtrunk)               | X   |                 |
| [voxcall](https://github.com/aaknitt/voxcall)                  | X   |                 |
| [ProScan](https://www.proscan.org/)                            |     | X               |
| [DSDPlus Fast Lane](https://www.dsdplus.com/)                  |     | X               |

## Build from source

Prerequisites:

- Go (see `server/go.mod` for the required version)
- Node.js 20.19 or later (or another version supported by Angular 21) and npm
- `make`, `zip`, and `pandoc` for release packages
- FFmpeg at runtime for audio conversion

Build the web application and server for the current platform:

```sh
cd client
npm ci
npm run build

cd ../server
go build -o ../ember-scanner
```

Run `./ember-scanner -h` for configuration options. New installations default to `ember-scanner.ini`, `ember-scanner.db`, and the administrative password `ember-scanner`. The password can also be supplied with `EMBER_ADMIN_PASSWORD`.

For upgrades, Ember Scanner automatically discovers legacy `rdio-scanner.ini` and `rdio-scanner.db` files when their renamed equivalents do not exist. `RDIO_ADMIN_PASSWORD` remains accepted as a fallback during migration.

Platform-specific and container documentation is available in [`docs`](./docs).

## Project links

- [Issues](https://github.com/jjcazau/EmberScanner/issues)
- [Discussions](https://github.com/jjcazau/EmberScanner/discussions)
- [Developer guide](./DEVELOPER.md)
- [Security policy](./SECURITY.md)
- [Contributing guide](./CONTRIBUTING.md)

## License and attribution

Ember Scanner remains licensed under the GNU General Public License as described in [`LICENSE`](./LICENSE). Copyright notices and attribution from the upstream project have been retained.

The repository includes upstream API terms in [`API_ACCESS_POLICY.md`](./API_ACCESS_POLICY.md). Review those terms before relying on the WebSocket API.
