# AGENTS.md — AI Coding Assistant Instructions

> This file provides context for AI coding assistants (Antigravity, Copilot, Cursor, etc.) working on this project.

## Project Overview

**OmniAntigravity Remote Chat** is a mobile remote control for Antigravity AI sessions.  
Architecture: Node.js server connects to Antigravity via Chrome DevTools Protocol (CDP), mirrors the chat UI to a mobile browser via WebSocket.

## Tech Stack

- **Runtime**: Node.js 16+ (ESM modules)
- **Server**: Express.js, WebSocket (ws), Cookie-based auth
- **Frontend**: Vanilla HTML/CSS/JS (no framework)
- **Protocol**: Chrome DevTools Protocol (CDP) for Antigravity communication
- **Ports**: CDP on 7800, web server on 4747 (configurable via .env)

## Project Structure

```
src/server.js       — Main server: Express + WebSocket + CDP connection
src/ui_inspector.js — UI DOM inspection utilities
public/             — Frontend: index.html, login.html, css/, js/
scripts/            — Shell launchers, SSL generator, context menu installers
docs/               — Extended documentation
launcher.js         — Node.js entry point (QR code + ngrok)
test.js             — Validation test suite
```

## Key Patterns

- **ESM imports** — All `.js` files use `import/export`, not `require()`
- **PROJECT_ROOT** — `src/server.js` uses `join(__dirname, '..')` as `PROJECT_ROOT` since it lives in `src/`
- **CDP connection** — `discoverCDP()` scans ports 7800-7803 for Antigravity targets
- **Multi-window** — `discoverAllCDP()` returns all available CDP targets across ports
- **Auth** — Cookie-based via `omni_ag_auth`, password from `APP_PASSWORD` env var
- **Snapshot polling** — Background loop captures DOM snapshots and broadcasts via WebSocket

## Development Commands

```bash
npm start            # Start server directly
npm run start:local  # Launch with QR code (Wi-Fi)
npm run start:web    # Launch with ngrok tunnel
npm test             # Run validation suite
```

## Important Notes

- Never use `require()` — this is an ESM project (`"type": "module"`)
- The `public/` directory is served as static files from `PROJECT_ROOT`
- SSL certs go in `certs/` at project root (auto-generated via `scripts/generate_ssl.js`)
- `.env` contains secrets — never commit it (it's in `.gitignore`)
