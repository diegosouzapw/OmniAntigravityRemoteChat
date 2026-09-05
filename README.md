<div align="center">

# 📱 OmniAntigravity Remote Chat

### Your AI coding session shouldn't end when you leave your desk.

<br/>

<img src="assets/hero-banner.png" alt="Control your AI from the couch" width="700" />

<br/>
<br/>

![Version](https://img.shields.io/badge/version-1.4.0-6366f1) ![Node](https://img.shields.io/badge/node-22%2B-10b981) ![CI](https://github.com/diegosouzapw/OmniAntigravityRemoteChat/actions/workflows/ci.yml/badge.svg) ![License](https://img.shields.io/badge/license-GPL--3.0-blue)

[![npm](https://img.shields.io/npm/v/omni-antigravity-remote-chat?color=cc3534&logo=npm)](https://www.npmjs.com/package/omni-antigravity-remote-chat) [![npm downloads](https://img.shields.io/npm/dm/omni-antigravity-remote-chat?color=blue&logo=npm)](https://www.npmjs.com/package/omni-antigravity-remote-chat) [![Docker](https://img.shields.io/docker/pulls/diegosouzapw/omni-antigravity-remote-chat?color=2496ED&logo=docker&logoColor=white)](https://hub.docker.com/r/diegosouzapw/omni-antigravity-remote-chat)

**Mirror your Antigravity (Windsurf) AI chat on your phone in real-time.**
<br/>
**Send messages. Switch models. Manage windows. All from your mobile browser.**

[Get Started](#-get-started) · [Screenshots](#-see-it-in-action) · [How It Works](#-how-it-works) · [Docker](https://hub.docker.com/r/diegosouzapw/omni-antigravity-remote-chat) · [npm](https://www.npmjs.com/package/omni-antigravity-remote-chat)

🌐 **Available in:** 🇺🇸 English | 🇧🇷 [Português (Brasil)](README.pt-BR.md) | 🇪🇸 [Español](README.es.md) | 🇫🇷 [Français](README.fr.md) | 🇮🇹 [Italiano](README.it.md) | 🇷🇺 [Русский](README.ru.md) | 🇨🇳 [中文 (简体)](README.zh-CN.md) | 🇩🇪 [Deutsch](README.de.md) | 🇮🇳 [हिन्दी](README.in.md) | 🇹🇭 [ไทย](README.th.md) | 🇺🇦 [Українська](README.uk-UA.md) | 🇸🇦 [العربية](README.ar.md) | 🇯🇵 [日本語](README.ja.md) | 🇻🇳 [Tiếng Việt](README.vi.md) | 🇧🇬 [Български](README.bg.md) | 🇩🇰 [Dansk](README.da.md) | 🇫🇮 [Suomi](README.fi.md) | 🇮🇱 [עברית](README.he.md) | 🇭🇺 [Magyar](README.hu.md) | 🇮🇩 [Bahasa Indonesia](README.id.md) | 🇰🇷 [한국어](README.ko.md) | 🇲🇾 [Bahasa Melayu](README.ms.md) | 🇳🇱 [Nederlands](README.nl.md) | 🇳🇴 [Norsk](README.no.md) | 🇵🇹 [Português (Portugal)](README.pt.md) | 🇷🇴 [Română](README.ro.md) | 🇵🇱 [Polski](README.pl.md) | 🇸🇰 [Slovenčina](README.sk.md) | 🇸🇪 [Svenska](README.sv.md) | 🇵🇭 [Filipino](README.phi.md)

</div>

<br/>

## 😤 The Problem

You're deep into an AI-assisted coding session. Claude is generating code, Gemini is reviewing your architecture. Then your phone rings, someone needs you in the kitchen, or you just want to move to the couch.

**Your options today:**

- ❌ Walk back to the desk every time the AI responds
- ❌ Try to read your monitor from across the room
- ❌ Copy-paste into a separate mobile app (losing context)
- ❌ Just... stop coding

**There has to be a better way.**

## ✅ The Solution

OmniAntigravity mirrors your **entire Antigravity AI chat** to your phone — in real-time, with full interaction. Read responses, send follow-up messages, switch AI models, even manage multiple editor windows. All from your mobile browser.

```bash
npx omni-antigravity-remote-chat
```

That's it. Open the URL on your phone. You're in. 🚀

### What's New

- 🎙️ **Native Voice Memos** — Record and attach voice instructions directly from your phone's microphone for Gemini multimodal processing.
- 📋 **Interactive Plan & Action Decision Remote System** — Review Antigravity implementation plans in a dedicated mobile drawer, proceed with 1-tap, snooze, or submit review feedback remotely.
- 🛑 **Better Explicit STOP Button** — Enhanced active STOP button with an explicit, sober crimson satin finish and gentle ambient breathing pulse when the agent is actively generating, deactivating immediately upon turn completion.
- 🔔 **LIVE Badge & Agent Status** — Improved LIVE status badge reflecting real-time Antigravity connection and agent activity (Idle, Working, Thinking) with interactive toast details on tap.
- 📱 **Mobile Viewport & Keyboard Resizing** — Dynamic height and virtual keyboard adaptation with `interactive-widget=resizes-content` and full safe-area inset protection for notches and Dynamic Islands.
- 🖼️ **Image & Media Attachments** — Upload screenshots and media directly from your phone into the desktop Antigravity session.
- 📦 **PWA Icon & Shell Hardening** — Fixed missing PWA icons on mobile home screens and browser tabs with full manifest caching and favicon links.
- 🧪 **Developer Mode & Diagnostic Tools** — Isolated simulation tools in the Admin panel for status dots and mock actions; zero test clutter in the production UI.

---

## 📸 See It in Action

<div align="center">

|                    Main Interface                    |                    Model Selection                     |                     Ready to Chat                     |
| :--------------------------------------------------: | :----------------------------------------------------: | :---------------------------------------------------: |
| <img src="assets/screenshot-main.png" width="280" /> | <img src="assets/screenshot-models.png" width="280" /> | <img src="assets/screenshot-input.png" width="280" /> |
|            Premium dark UI with live sync            |           Switch between Gemini, Claude, GPT           |             Send messages from your phone             |

</div>

---

## ⚡ Get Started

### One command — zero config:

```bash
npx omni-antigravity-remote-chat
```

### Or install globally:

```bash
npm install -g omni-antigravity-remote-chat
omni-chat
```

### Or run with Docker:

```bash
docker run -d --name omni-chat \
  --network host \
  -e APP_PASSWORD=your_password \
  diegosouzapw/omni-antigravity-remote-chat:latest
```

### Prerequisite

Launch Antigravity in debug mode (one-time setup):

```bash
antigravity . --remote-debugging-port=7800
```

> 💡 **Pro tip:** Add `alias agd='antigravity . --remote-debugging-port=7800'` to your `~/.bashrc`

---

## 🏆 Why Developers Choose This

|     | Feature                | Details                                                                  |
| --- | ---------------------- | ------------------------------------------------------------------------ |
| 🛋️  | **Code from anywhere** | Read and reply to AI chats from your couch, bed, or kitchen              |
| 🪟  | **Multi-window**       | Switch between multiple Antigravity instances from one phone             |
| 🔄  | **Real-time sync**     | < 100ms latency via WebSocket — chat updates appear instantly            |
| 🤖  | **Model switching**    | Toggle between Gemini, Claude, GPT from a mobile dropdown                |
| 🤖  | **Remote Autonomy**    | Auto-detect and 1-tap accept/reject CLI instructions remotely            |
| 🧠  | **Suggest Mode**       | Queue supervisor suggestions for manual review before desktop execution  |
| 📊  | **Session Analytics**  | Track errors, approvals, uploads, quota warnings and screen activity     |
| 📈  | **Quota Visibility**   | Read real model limits from the local Antigravity language server        |
| 💬  | **Assist Workspace**   | Ask the supervisor for summaries, context and next actions               |
| 🖼️  | **Timeline**           | Keep a persistent screenshot history with manual and automatic captures  |
| 📱  | **Telegram Alerts**    | Get push notifications for Blocks, Task completion and Pending actions   |
| ❓  | **Interactive Questions & Grill-Me** | Mirror, tap, and submit Antigravity question prompts with instant highlight and zero cycling |
| ⚡  | **Lexical & Gemini Staging** | Full compatibility with Gemini-era Antigravity and input staging validation |
| 🔒  | **Concurrency Lock & Dedupe** | Promise-chain send locking and SHA-256 deduplication protecting against race conditions |
| 🎙️  | **Native Voice Memos** | Record audio on your phone and attach directly for Gemini multimodal processing |
| 📋  | **Plan Review Drawer** | Review implementation plans, submit feedback, or approve with 1-tap from your phone |
| 🖼️  | **Media Attachments**  | Upload screenshots and diagrams directly into the chat prompt from mobile |
| 🧪  | **Developer Mode**     | Isolated simulation and diagnostics via the Admin panel without production UI clutter |
| 📋  | **Chat history**       | Browse and resume past conversations on mobile                           |
| 🔒  | **Secure by default**  | HTTPS, CSP, password auth, cookie sessions, LAN auto-auth               |
| 🌐  | **Remote access**      | Cloudflare, Pinggy, ngrok tunnels with QR code — access from anywhere   |
| 🐳  | **Docker ready**       | One-liner container deployment                                           |
| ♻️  | **Modular codebase**   | Clean architecture with JSDoc typing (`config`, `state`, `utils`, `cdp`) |

---

## 📱 How It Works

```
┌─────────────┐    CDP (7800)    ┌──────────────┐    HTTPS/WS (4747)    ┌─────────────┐
│ Antigravity  │ ◄──────────────► │  Node Server  │ ◄──────────────────► │   Phone      │
│  (Desktop)   │    DOM snapshot   │  (server.js)  │    mirror + control  │  (Browser)   │
└─────────────┘                  └──────────────┘                      └─────────────┘
```

The server connects to Antigravity via the **Chrome DevTools Protocol (CDP)**, captures the chat DOM in real-time, and streams it to your phone over WebSocket. Actions on your phone (sending messages, switching models) are executed back on the desktop via CDP.

**Zero impact on your desktop** — the mirroring is read-only until you interact. No plugins, no extensions, no Antigravity modifications needed.

---

## 🪟 Multi-Window Management

Manage **multiple Antigravity instances** from a single phone:

- **Window Selector** — Tap 🖥️ to see all open Antigravity windows
- **Instant Switching** — Select any window, mirrors within 2 seconds
- **Smart Filtering** — Only shows real editor windows (hides Settings, Launchpad)
- **Launch Windows** — Spawn new Antigravity instances directly from your phone

---

## 🚀 Launch Modes

| Feature      | Git Clone             | NPM Global                          | Docker           |
| ------------ | --------------------- | ----------------------------------- | ---------------- |
| Basic server | `npm start`           | `omni-chat`                         | `docker run ...` |
| QR code      | `npm run start:local` | `omni-chat` (shows URL)             | —                |
| ngrok tunnel | `npm run start:web`   | `omni-chat` + `npx ngrok http 4747` | —                |
| SSL setup    | `npm run setup:ssl`   | Manual with `mkcert`                | Not needed       |

### Windows & WSL Integration

```bash
# In PowerShell (Run as Administrator)
cd scripts/windows-wsl-remote
./Start-OmniChat.ps1
```

> **Context Menu:** This script sets up a handy right-click "Open OmniChat & Antigravity" shortcut on Windows that seamlessly launches your project inside WSL. See [scripts/windows-wsl-remote/README.md](scripts/windows-wsl-remote/README.md) for full instructions.

<details>
<summary>📖 Full launch mode details</summary>

### Git Clone (full control)

```bash
npm start              # Start server directly
npm run start:local    # Start with QR code for Wi-Fi access
npm run start:web      # Start with ngrok tunnel for internet access
npm run setup:ssl      # Generate trusted HTTPS certificates
```

### ngrok (Remote Access)

```bash
# Terminal 1
omni-chat

# Terminal 2
npx ngrok http 4747
```

> **Full ngrok integration** (automatic tunnel + QR code) is available via `npm run start:web` with `NGROK_AUTHTOKEN` in `.env`.

### SSL Setup

```bash
npm run setup:ssl
```

Auto-installs [mkcert](https://github.com/FiloSottile/mkcert), creates a local CA, and generates trusted certificates → green padlock 🔒

</details>

---

## 🧰 Remote Workspace

The mobile workspace provides 7 specialized panels:

- **Files** for browsing and previewing project files with syntax highlighting
- **Terminal** for remote command execution with live output streaming
- **Git** for status, staging, commit and push with diff summaries
- **Assist** for supervisor-backed AI chat with contextual action buttons
- **Stats** for real-time session analytics (messages, approvals, errors)
- **Timeline** for persistent screenshot history with manual and auto-capture
- **Screen** for CDP-based live screencast streaming

This makes the phone UI useful for both passive monitoring and active intervention without leaving the browser.

---

## 🔑 Configuration

```bash
cp .env.example .env
```

| Variable                          | Default            | Description                                     |
| --------------------------------- | ------------------ | ----------------------------------------------- |
| `APP_PASSWORD`                    | `antigravity`      | Authentication password                         |
| `PORT`                            | `4747`             | Server port                                     |
| `CDP_PORTS`                       | `7800,7801,7802,7803` | CDP debug ports to scan (comma-separated)    |
| `COOKIE_SECRET`                   | _(auto-generated)_ | Secret for cookie signing                       |
| `AUTH_SALT`                       | _(auto-generated)_ | Additional salt for auth tokens                 |
| `WORKSPACE_ROOT`                  | repo root          | Root exposed in Files, Terminal and Git         |
| `AUTO_TUNNEL_PROVIDER`            | _(optional)_       | Auto-start tunnel (`cloudflare` or `pinggy`)    |
| `TUNNEL_PROVIDER`                 | `cloudflare`       | Preferred provider for launcher `--mode web`    |
| `CLOUDFLARE_TUNNEL_BIN`           | `cloudflared`      | Path to cloudflared binary                      |
| `PINGGY_TOKEN`                    | _(optional)_       | Pinggy API token for persistent subdomains      |
| `PINGGY_SSH_BIN`                  | `ssh`              | Path to SSH binary for Pinggy tunnels           |
| `OMNIROUTE_SUPERVISOR_ENABLED`    | `false`            | Enable the AI supervisor                        |
| `OMNIROUTE_SUPERVISOR_BASE_URL`   | `http://127.0.0.1:20128/v1` | OmniRoute API endpoint              |
| `OMNIROUTE_SUPERVISOR_API_KEY`    | `sk_omniroute`     | OmniRoute API key                               |
| `OMNIROUTE_SUPERVISOR_MODEL`      | `if/kimi-k2-thinking` | Supervisor model                             |
| `SUPERVISOR_SUGGEST_MODE`         | `false`            | Queue supervisor actions for human review       |
| `SUPERVISOR_MAX_QUEUE`            | `10`               | Maximum pending suggestions                     |
| `QUOTA_ENABLED`                   | `false`            | Enable background quota polling                 |
| `QUOTA_POLL_INTERVAL`             | `300000`           | Quota polling interval in ms                    |
| `SCREENSHOT_ENABLED`              | `false`            | Enable automatic screenshot timeline capture    |
| `SCREENSHOT_INTERVAL`             | `60000`            | Timeline capture interval in ms                 |
| `SCREENSHOT_MAX`                  | `100`              | Maximum screenshots persisted on disk           |
| `NGROK_AUTHTOKEN`                 | _(optional)_       | For remote access via ngrok                     |
| `TELEGRAM_BOT_TOKEN`              | _(optional)_       | Telegram bot token for push notifications       |
| `TELEGRAM_CHAT_ID`                | _(optional)_       | Telegram chat ID for notifications              |
| `TELEGRAM_RATE_LIMIT`             | `30`               | Max Telegram messages per minute                |
| `ENABLE_DEV_MOCKS`                | `false` (prod) / `true` (dev) | Enable developer mock routes (`/api/action/mock`, `/api/status/mock`) |

---

## 🛠️ Troubleshooting

| Issue               | Solution                                                     |
| ------------------- | ------------------------------------------------------------ |
| "CDP not found"     | Launch Antigravity with `--remote-debugging-port=7800`       |
| "EADDRINUSE"        | Change `PORT` in `.env`, or stop the process using that port |
| Phone can't connect | Ensure same Wi-Fi network and check firewall                 |
| "Syncing..." stuck  | Wait 2-3s for CDP contexts to populate after window switch   |

---

## 📁 Project Structure

```
├── src/
│   ├── server.js              # Main server (Express + WS + CDP actions)
│   ├── config.js              # Constants, env vars, feature flags, version
│   ├── env.js                 # dotenv bootstrap
│   ├── state.js               # Shared state + JSDoc type definitions
│   ├── supervisor.js          # AI supervisor (OmniRoute) + suggest queue
│   ├── quota-service.js       # Model quota polling
│   ├── session-stats.js       # In-memory session analytics
│   ├── screenshot-timeline.js # Persistent screenshot capture
│   ├── ui_inspector.js        # UI DOM inspection utilities
│   ├── cdp/
│   │   └── connection.js      # CDP discovery & connection
│   └── utils/
│       ├── network.js         # getLocalIP, isLocalRequest, getJson
│       ├── process.js         # killPortProcess, launchAntigravity
│       ├── hash.js            # djb2 hash for diff detection
│       ├── telegram.js        # Telegram bot integration
│       └── workspace.js       # File browser, terminal, Git, uploads
├── public/                    # Mobile interface (4 HTML pages, modular CSS/JS)
│   ├── js/components/         # Workspace panels (6 modules)
│   └── css/                   # Modular CSS (8 files, 5 themes)
├── launcher.js                # QR code + tunnel orchestration
├── scripts/                   # SSL, tunnel managers, context menu, WSL
├── test/                      # Smoke tests + Vitest unit tests (12 files, 92 tests)
├── Dockerfile                 # Docker support (node:22-alpine)
└── .github/workflows/         # CI + auto-release + Docker Hub
```

---

## 📊 Star History

<a href="https://star-history.com/#diegosouzapw/OmniAntigravityRemoteChat&Date">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/svg?repos=diegosouzapw/OmniAntigravityRemoteChat&type=Date&theme=dark" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/svg?repos=diegosouzapw/OmniAntigravityRemoteChat&type=Date" />
   <img alt="Star History Chart" src="https://api.star-history.com/svg?repos=diegosouzapw/OmniAntigravityRemoteChat&type=Date" />
 </picture>
</a>

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

---

## 🙏 Acknowledgments

Special thanks to **[Krishna Kanth B](https://github.com/krishnakanthb13)** — the original creator of the Windsurf mobile chat concept that inspired this project. OmniAntigravity builds upon that foundation with multi-window management, robust CDP handling, NPM/Docker packaging, and a premium mobile-first UI.

---

## 📄 License

GPL-3.0 — see [LICENSE](LICENSE) for details.

---

<div align="center">
  <sub>Built with ❤️ for developers who code from everywhere</sub>
  <br/>
  <sub><a href="https://github.com/diegosouzapw/OmniAntigravityRemoteChat">github.com/diegosouzapw/OmniAntigravityRemoteChat</a></sub>
</div>
