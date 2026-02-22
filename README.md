<div align="center">

# 📱 OmniAntigravity Remote Chat

**Control your Antigravity AI sessions from your phone.**

![Version](https://img.shields.io/badge/version-0.4.6-6366f1) ![Node](https://img.shields.io/badge/node-16%2B-10b981) ![CI](https://github.com/diegosouzapw/OmniAntigravityRemoteChat/actions/workflows/ci.yml/badge.svg) ![License](https://img.shields.io/badge/license-GPL--3.0-blue)

[![npm](https://img.shields.io/npm/v/omni-antigravity-remote-chat?color=cc3534&logo=npm)](https://www.npmjs.com/package/omni-antigravity-remote-chat) [![npm downloads](https://img.shields.io/npm/dm/omni-antigravity-remote-chat?color=blue&logo=npm)](https://www.npmjs.com/package/omni-antigravity-remote-chat)

_Mirror your desktop AI chat on your phone in real-time. Send messages, switch models, manage multiple windows — all from your mobile browser._

</div>

---

## ✨ Why OmniAntigravity?

| Benefit                     | Description                                                       |
| --------------------------- | ----------------------------------------------------------------- |
| 🛋️ **Code from the couch**  | Read and reply to your AI chat without sitting at your desk       |
| 🪟 **Multi-window support** | Switch between multiple Antigravity instances from one phone      |
| 🔄 **Real-time mirror**     | Chat updates appear instantly on your phone via WebSocket         |
| 📋 **Chat history**         | Browse and resume past conversations from the mobile UI           |
| 🔒 **Secure**               | Password-protected with HTTPS, cookie sessions, and LAN auto-auth |
| 🌐 **Access anywhere**      | Use via Wi-Fi (local) or ngrok (internet) with QR code scanning   |
| ⚡ **One command install**  | `npx omni-antigravity-remote-chat` — no cloning needed            |

---

## 🚀 Quick Start

### Option A — NPM (Recommended)

```bash
# Install globally
npm install -g omni-antigravity-remote-chat

# Run anywhere
omni-chat
```

> 📦 [View on npmjs.com](https://www.npmjs.com/package/omni-antigravity-remote-chat)

### Option B — npx (No Install)

```bash
npx omni-antigravity-remote-chat
```

### Option C — Clone Repository

```bash
git clone https://github.com/diegosouzapw/OmniAntigravityRemoteChat.git
cd OmniAntigravityRemoteChat
npm install
npm start
```

### Prerequisites

1. **Node.js 16+** — `node --version`
2. **Antigravity** launched in debug mode:

```bash
antigravity . --remote-debugging-port=7800
```

> **Tip:** Add `alias agd='antigravity . --remote-debugging-port=7800'` to your `~/.bashrc` for a quick shortcut.

---

## 📱 How It Works

```
┌─────────────┐    CDP (7800)    ┌──────────────┐    HTTPS/WS (4747)    ┌─────────────┐
│ Antigravity  │ ◄──────────────► │  Node Server  │ ◄──────────────────► │   Phone      │
│  (Desktop)   │    snapshot      │  (server.js)  │    mirror + control  │  (Browser)   │
└─────────────┘                  └──────────────┘                      └─────────────┘
```

The server connects to Antigravity via the **Chrome DevTools Protocol (CDP)**, captures the chat DOM in real-time, and streams it to your phone over WebSocket. You can interact with the chat, switch modes/models, browse history, and manage multiple windows — all from your mobile browser.

---

## 🪟 Multi-Window Management

One of OmniAntigravity's standout features is the ability to manage **multiple Antigravity instances** from a single phone:

- **Window Selector** — Tap the 🖥️ Window button to see all open Antigravity windows
- **Instant Switching** — Select any window and the chat mirrors it within 2 seconds
- **Smart Filtering** — Only shows real editor windows (hides internal pages like Settings)
- **Launch New Windows** — Spawn new Antigravity instances directly from your phone

---

## 🔑 Configuration

```bash
cp .env.example .env
```

| Variable       | Default      | Description             |
| -------------- | ------------ | ----------------------- |
| `APP_PASSWORD` | _(required)_ | Authentication password |
| `PORT`         | `4747`       | Server port             |

### Port Reference

| Port     | Purpose                    |          Configurable          |
| -------- | -------------------------- | :----------------------------: |
| **7800** | Antigravity CDP debug port | `--remote-debugging-port` flag |
| **4747** | OmniAntigravity web server |        `PORT` in `.env`        |

> These ports were chosen to avoid conflicts with common services (3000, 5000, 8080, 9000).

---

## 🔒 HTTPS Setup

Get trusted HTTPS with **zero browser warnings** in one command:

```bash
npm run setup:ssl
```

This automatically installs [mkcert](https://github.com/FiloSottile/mkcert), creates a local CA, and generates trusted certificates. The server auto-detects them on next start → green padlock 🔒

<details>
<summary>📱 Mobile Certificate (Optional)</summary>

**Android:** Copy `rootCA.pem` to phone → Settings → Security → Install certificate

**iOS:** Transfer `rootCA.pem` → Settings → Profile Downloaded → Install → Certificate Trust Settings → Enable

</details>

---

## 🎨 Features

### Core

- 📱 **Mobile Remote Control** — Send messages, switch modes/models from your phone
- 🔄 **Real-time Sync** — Chat mirrors from desktop to phone automatically
- 📑 **All Sections Expanded** — No collapsing, everything visible at once
- 🛡️ **Smart Scroll Lock** — 15s protection so buttons don't jump away from your finger

### Multi-Window (v0.4.0+)

- 🪟 **Window Selector** — Switch between multiple Antigravity instances
- 🚀 **Launch Windows** — Spawn new Antigravity instances from your phone
- 🔄 **Robust Switching** — Retry logic with progress indicator during target change

### Chat Management

- 📋 **Chat History** — Browse and resume past conversations
- ➕ **New Conversations** — Start fresh chats from mobile
- ⏹️ **Stop Generation** — Halt AI responses immediately

### Infrastructure

- 🔁 **Auto-Reconnect** — Exponential backoff (2s→30s) with toast notifications
- 🔒 **Security** — Password auth, HTTPS, cookie sessions, LAN auto-auth
- 📟 **QR Code** — Scan to connect instantly from phone
- 🌐 **ngrok Support** — Access from anywhere via web tunnel

---

## 📦 npm Scripts

```bash
npm start             # Start server directly
npm run start:local   # Launch with QR code (Wi-Fi mode)
npm run start:web     # Launch with ngrok (internet mode)
npm run setup:ssl     # Generate trusted HTTPS certificates
npm test              # Run validation test suite (25 checks)
```

---

## ✅ Validation Tests

```bash
npm test
```

Checks Node.js version, dependencies, syntax, port availability, CDP connectivity, HTTP endpoints, and WebSocket connection.

---

## 📁 Project Structure

```
├── src/
│   ├── server.js          # Main server (Express + WebSocket + CDP)
│   └── ui_inspector.js    # UI inspection utilities
├── public/
│   ├── index.html         # Mobile chat interface
│   ├── login.html         # Login page
│   ├── css/style.css      # Premium dark UI styles
│   └── js/app.js          # Client-side logic
├── scripts/
│   ├── start.sh / .bat    # Local launcher
│   ├── start_web.sh / .bat # Web (ngrok) launcher
│   ├── generate_ssl.js    # SSL certificate generator
│   └── setup-ssl.js       # Automated mkcert setup
├── docs/
│   ├── CODE_DOCUMENTATION.md  # Technical reference
│   ├── DESIGN_PHILOSOPHY.md   # Architecture rationale
│   └── RELEASE_NOTES.md       # Version history
├── launcher.js            # Node.js launcher (QR, ngrok)
├── test.js                # Validation test suite
├── package.json           # Dependencies and scripts
└── .env.example           # Environment template
```

---

## 🛠️ Troubleshooting

| Issue               | Solution                                                        |
| ------------------- | --------------------------------------------------------------- |
| "CDP not found"     | Launch Antigravity with `agd` or `--remote-debugging-port=7800` |
| "EADDRINUSE"        | Change `PORT` in `.env`, or stop the process using that port    |
| Phone can't connect | Ensure same Wi-Fi network and check firewall                    |
| "Unauthorized"      | Clear browser cookies and re-enter password                     |
| Empty chat history  | Ensure a chat is open in Antigravity, then refresh              |
| "Syncing..." stuck  | Wait 2-3s for CDP contexts to populate after window switch      |

---

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

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

## 🙏 Acknowledgments

Special thanks to **[Krishna Kanth B](https://github.com/krishnakanthb13)** — the original creator of the Windsurf mobile chat concept that inspired this project. OmniAntigravity Remote Chat builds upon that foundation with a complete rewrite, multi-window management, robust CDP context handling, NPM packaging, and a premium mobile-first UI.

---

## 📄 License

GPL-3.0 — see [LICENSE](LICENSE) for details.

---

<div align="center">
  <sub>Built with ❤️ for developers who code from everywhere</sub>
  <br/>
  <sub><a href="https://github.com/diegosouzapw/OmniAntigravityRemoteChat">github.com/diegosouzapw/OmniAntigravityRemoteChat</a></sub>
</div>
