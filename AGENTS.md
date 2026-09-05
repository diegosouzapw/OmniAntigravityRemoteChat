# AGENTS.md — AI Coding Assistant Instructions

> This file provides context for AI coding assistants (Antigravity, Copilot, Cursor, etc.) working on this project.

## Project Overview

**OmniAntigravity Remote Chat** (v1.4.0) is a premium mobile command center for Antigravity AI sessions.  
Architecture: Node.js server connects to Antigravity via Chrome DevTools Protocol (CDP), mirrors the chat UI to a mobile browser via WebSocket, and adds remote workspace tools, supervisor intelligence, quota monitoring, and tunnel-based remote access.

## Tech Stack

- **Runtime**: Node.js 22+ (ESM modules, `"type": "module"`)
- **Server**: Express.js 4.22, WebSocket (ws 8.x), Cookie-based auth, compression
- **Frontend**: Vanilla HTML/CSS/JS (no framework), 5 themes, PWA support
- **Protocol**: Chrome DevTools Protocol (CDP) for Antigravity communication
- **Testing**: Vitest 4.x (unit), custom smoke suite (integration)
- **Tunneling**: Cloudflare Quick Tunnels, Pinggy (SSH-based), ngrok (optional)
- **Notifications**: Telegram Bot (optional, lazy-loaded `node-telegram-bot-api`)
- **AI Supervisor**: OmniRoute OpenAI-compatible API (optional)
- **Ports**: CDP on 7800-7803 (configurable via `CDP_PORTS`), web server on 4747 (configurable via `PORT`)
- **Docker**: `node:22-alpine` with production-only deps

## Project Structure

```
src/
├── server.js               — Main server: Express + WebSocket + CDP actions (3400+ lines)
├── config.js               — Constants, env vars, feature flags, version
├── env.js                  — dotenv bootstrap (resolves .env from project root)
├── state.js                — Shared mutable state + JSDoc type definitions
├── supervisor.js           — AI supervisor (OmniRoute), suggest queue, heuristic safety
├── quota-service.js        — Model quota polling via language server HTTPS API
├── session-stats.js        — In-memory session analytics and metrics
├── screenshot-timeline.js  — Persistent screenshot capture with disk storage
├── ui_inspector.js         — UI DOM inspection utilities
├── cdp/
│   └── connection.js       — CDP discovery, WebSocket connect, context management
└── utils/
    ├── network.js          — getLocalIP, isLocalRequest, getJson
    ├── process.js          — killPortProcess, isPortFree, launchAntigravity
    ├── hash.js             — djb2 hash for snapshot diff detection
    ├── telegram.js         — Telegram bot: commands, inline keyboards, rate-limiting, threading
    └── workspace.js        — File browser, terminal manager, Git actions, quick commands, uploads

public/
├── index.html              — Main mobile chat interface
├── login.html              — Authentication page
├── admin.html              — Admin panel (metrics, logs, tunnel control)
├── minimal.html            — Lite mode for unstable connections
├── manifest.json           — PWA manifest
├── sw.js                   — Service worker
├── css/                    — Modular CSS: variables, themes (5), layout, components, workspace, assist, chat
├── js/
│   ├── app.js              — Main client logic (WebSocket, rendering, UI state)
│   ├── admin.js            — Admin panel logic
│   ├── login.js            — Login page logic
│   ├── minimal.js          — Lite mode logic
│   ├── theme-bootstrap.js  — Theme initialization (CSP-compliant external script)
│   └── components/         — Modular workspace panels (assist, files, git, stats, terminal, timeline)
└── icons/                  — SVG app icons (standard + maskable)

scripts/
├── cloudflare-tunnel.js    — Cloudflare Quick Tunnel manager
├── pinggy-tunnel.js        — Pinggy SSH tunnel manager
├── generate_ssl.js         — SSL certificate generator (OpenSSL + Node.js crypto fallback)
├── setup-ssl.js            — Interactive SSL setup with mkcert
├── install_context_menu.*  — OS context menu installers (Windows/Linux)
├── start.sh / start.bat    — Shell launchers (local)
├── start_web.sh / start_web.bat — Shell launchers (remote)
├── sync_features.py        — Feature sync utility
└── windows-wsl-remote/     — PowerShell scripts for WSL2 integration

test/
├── test.js                 — Integration/smoke test suite
└── unit/                   — Vitest unit tests (13 test files, 102 tests)
    ├── action-decision.test.js
    ├── config.test.js
    ├── hash.test.js
    ├── mobile-viewport.test.js
    ├── network.test.js
    ├── quota-service.test.js
    ├── screenshot-timeline.test.js
    ├── send-lock.test.js
    ├── session-stats.test.js
    ├── supervisor.test.js
    ├── telegram.test.js
    ├── upload-audio.test.js
    └── upload-media.test.js

launcher.js                 — Node.js entry point (QR code, tunnel orchestration)
data/                       — Runtime data (quick-commands.json, screenshots/, uploads/)
docs/                       — Extended documentation (CODE_DOCUMENTATION, plans, competitive analysis)
```

## Key Patterns

- **ESM imports** — All `.js` files use `import/export`, not `require()`. Exceptions: `fix_ts.cjs` and `sync_wsl.cjs` (CommonJS utilities)
- **PROJECT_ROOT** — `src/config.js` uses `join(__dirname, '..')` as `PROJECT_ROOT` since it lives in `src/`
- **CDP connection** — `discoverCDP()` scans configurable ports (default 7800-7803) for Antigravity targets
- **Multi-window** — `discoverAllCDP()` returns all available CDP workbench targets across ports
- **Auth** — Cookie-based via `omni_ag_auth`, password from `APP_PASSWORD` env var, LAN auto-auth
- **CSP enforcement** — Strict `Content-Security-Policy` via both HTTP header and meta tags; zero inline JS
- **Snapshot polling** — Background loop captures DOM snapshots, detects changes via hash, and broadcasts via WebSocket
- **Tunnel support** — Multi-provider tunnel system (Cloudflare, Pinggy, ngrok) with automatic fallback
- **Supervisor** — OmniRoute-backed AI supervisor with heuristic safety gates and suggest queue
- **Quota monitoring** — Discovers local `language_server` processes, probes HTTPS endpoints for quota data
- **Screenshot timeline** — Disk-persisted screenshot captures with manifest, auto-capture on change, pruning
- **Session stats** — In-memory metrics (messages, approvals, errors, uploads, screen activity)
- **Telegram integration** — Lazy-loaded bot with commands, inline keyboards, rate-limiting, message threading
- **Workspace tools** — File browser, terminal streaming, Git panel, assist chat, all via REST API
- **Theme system** — 5 themes (dark, light, slate, pastel, rainbow) with CSS variables and persistence
- **Lexical & Gemini Staging** — Supports Gemini Antigravity Lexical editor with input boundary staging validation and multi-tab fallback
- **Concurrency Serialization** — Atomic Promise-chain locking (`withSendLock`) with SHA-256 deduplication and busy retry backoff
- **Interactive Question Prompts** — Mirrors Antigravity `ask_question` and Grill-Me sessions with optimistic mobile tap feedback, illuminated option badges, and zero-cycling grace locks

## API Surface (60+ endpoints)

### Core
- `POST /login`, `POST /logout`, `GET /health`, `GET /snapshot`

### Chat Control
- `POST /send`, `POST /stop`, `POST /set-mode`, `POST /set-model`
- `POST /new-chat`, `GET /chat-history`, `POST /select-chat`, `GET /chat-status`

### CDP / Multi-Window
- `GET /cdp-targets`, `POST /select-target`, `POST /api/launch-window`
- `POST /remote-click`, `POST /remote-scroll`, `GET /app-state`

### Workspace
- `GET /api/fs/ls`, `GET /api/fs/cat`
- `GET /api/terminal/history`, `POST /api/terminal/run`, `POST /api/terminal/stop`
- `GET /api/git/status`, `POST /api/git/add`, `POST /api/git/commit`, `POST /api/git/push`
- `GET /api/quick-commands`, `PUT /api/admin/quick-commands`

### Supervisor & Suggestions
- `POST /api/interact-action`
- `GET /api/suggestions`, `GET /api/suggestions/pending`
- `POST /api/suggestions/:id/approve`, `POST /api/suggestions/:id/reject`
- `DELETE /api/suggestions`

### Analytics & Monitoring
- `GET /api/stats`, `GET /api/quota`
- `GET /api/timeline`, `GET /api/timeline/:filename`, `POST /api/timeline/capture`, `DELETE /api/timeline`

### Assist
- `POST /api/assist/chat`, `GET /api/assist/history`, `DELETE /api/assist/history`

### Screencast & Media
- `GET /api/screencast/status`, `POST /api/screencast/start`, `POST /api/screencast/stop`
- `POST /api/upload-image`

### Admin
- `GET /admin`, `GET /api/admin/logs`, `GET /api/admin/metrics`
- `GET /api/admin/tunnel`, `POST /api/admin/tunnel/start`, `POST /api/admin/tunnel/stop`

### Debug
- `GET /ssl-status`, `POST /generate-ssl`, `GET /debug-ui`, `GET /ui-inspect`, `GET /minimal`

## Development Commands

```bash
npm start                # Start server directly
npm run dev              # Dev server (alias for start)
npm run start:local      # Launch with QR code (Wi-Fi)
npm run start:web        # Launch with tunnel (Cloudflare preferred)
npm run start:web:pinggy # Launch with Pinggy tunnel
npm run setup:ssl        # Generate trusted HTTPS certificates
npm test                 # Run integration/smoke test suite
npm run test:unit        # Run Vitest unit tests
npm run test:unit:watch  # Run Vitest in watch mode
npm run test:coverage    # Run Vitest with V8 coverage
npm run test:all         # Run both smoke + unit tests
```

## Important Notes

- Never use `require()` — this is an ESM project (`"type": "module"`)
- The `public/` directory is served as static files from `PROJECT_ROOT`
- SSL certs go in `certs/` at project root (auto-generated via `scripts/setup-ssl.js`)
- `.env` contains secrets — never commit it (it's in `.gitignore`)
- Runtime data lives in `data/` (quick-commands.json, screenshots/, uploads/)
- The `_tasks/` and `_references/` directories are internal development tracking — not part of the product
- Frontend workspace panels in `public/js/components/` are modular and self-contained
- Telegram bot is lazy-loaded — the server works fine without `node-telegram-bot-api` installed
- The supervisor is optional — set `OMNIROUTE_SUPERVISOR_ENABLED=true` to activate
- CSP is enforced both via HTTP header and HTML meta tags for defense-in-depth
