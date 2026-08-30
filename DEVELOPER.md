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
go run . -base_dir ../.dev-data -listen :3000
```

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
