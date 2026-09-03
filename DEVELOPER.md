# Ember Scanner development

## Quick development server

Requirements:

- Go 1.26 or later
- Node.js `^20.19`, `^22.12`, or `>=24`
- npm
- FFmpeg for audio conversion

From the repository root, install the frontend dependencies and build the embedded web application once:

```sh
cd client
npm ci
npm run build
cd ..
```

The initial build creates `server/webapp`, which Go requires for `go:embed`. After that, run the backend and frontend in separate terminals.

Terminal 1 — API and WebSocket server:

```sh
cd server
go run . -base_dir ../.dev-data -listen :3000 --test
```

`--test` creates an isolated `ember-scanner-test.db`, immediately populates it
with random systems, talkgroups, units, call history, patched seasonal-district
calls, and playable synthetic WAV
audio, then emits a new test transmission every 4–10 seconds. Omit the flag when
testing with recorder uploads or your own development database.

Terminal 2 — Angular development server with live reload:

```sh
cd client
npm run serve
```

Open:

- Application: <http://localhost:4200>
- Administration: <http://localhost:4200/admin>
- Embedded production build: <http://localhost:3000>

The initial administrator password is `ember-scanner`. Development data is kept in the ignored `.dev-data` directory. Angular proxies API and WebSocket requests to `http://localhost:3000` through `client/src/proxy.conf.js`.

Restart the Go process after backend changes. Angular rebuilds automatically after frontend changes.

## Radio activity

Open **Administration → Radio activity** for a rolling 1-hour, 6-hour,
24-hour, or 7-day view. The timeline and talkgroup heatmap share time buckets;
selecting a bucket updates the top-five ranking, and selecting a talkgroup
isolates its timeline. The shared colour scale compares call volume, while
the per-talkgroup scale reveals patterns on quieter channels. Systems can be
filtered, and the heatmap supports talkgroup search and pagination.

Counts use the recording timestamp of retained calls, not upload time or
listener counts. Each call counts once under its primary talkgroup, even if
patched. First and last buckets can be partial. Pruned calls and missing
recorder coverage affect the displayed history.

`GET /api/admin/activity?hours=24&system=0` requires the existing admin token.
Ranges are bounded; `system` is a database system ID (zero means all systems).
The response contains millisecond timestamps, bucket counts, system labels,
and per-talkgroup bucket counts, without audio. A timestamp-leading index
supports aggregation. The view refreshes every 30 seconds while visible and
stops polling when its admin section is closed.

The main scanner's **ACTIVITY** button opens a compact LCD-styled view with
the call timeline and talkgroup intensity heatmap. Audio continues playing;
closing the view stops its polling. Time markers are every 10 minutes, 30
minutes, 2 hours, or 12 hours for the respective ranges.

The chart calculations live in `client/src/app/components/ember-scanner/activity`
and are shared by the admin and scanner views. The scanner uses the existing
listener WebSocket (`ACT`, with hours/system and a request correlation flag).
Each request revalidates listener access; counts and system labels are scoped
to permitted primary talkgroups, and pending/configured delays are excluded.

## Commands to know

Run backend tests:

```sh
cd server
go test ./...
```

Format and inspect backend code:

```sh
gofmt -w server/*.go
cd server && go vet ./...
```

Create a production frontend build:

```sh
cd client
npm run build
```

Build a local server executable after building the frontend:

```sh
cd server
go build -o ../ember-scanner .
```

Run the integrated executable:

```sh
./ember-scanner -base_dir ./.dev-data -listen :3000
```

Show server options and advanced commands:

```sh
cd server
go run . -h
go run . -cmd help
```

Write a development configuration file:

```sh
cd server
go run . -base_dir ../.dev-data -config_save
```

Build a Linux AMD64 release package, including the web application and PDF documentation:

```sh
make linux-amd64
```

Build a local container image after `npm run build`:

```sh
podman build -t ember-scanner:dev .
podman run --rm -p 3000:3000 -v "$(pwd)/.dev-data:/app/data" ember-scanner:dev
```

Remove generated dependencies and build outputs:

```sh
make clean
```

`make clean` removes `client/node_modules`, `server/webapp`, and `dist`, so run `npm ci` and `npm run build` again before the next development session.
