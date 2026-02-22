# OmniAntigravity Remote Chat

> 📱 Premium mobile remote control for Antigravity AI sessions — mirror, chat, and manage your AI workflows from your phone.

## How It Works

Your phone connects to a local Node.js server that mirrors your Antigravity desktop chat via the **Chrome DevTools Protocol (CDP)**. You can read responses, send messages, switch models, and manage sessions — all from your mobile browser.

```
┌─────────────┐    CDP (7800)    ┌──────────────┐    HTTP/WS (4747)    ┌─────────────┐
│ Antigravity  │ ◄──────────────► │  Node Server  │ ◄─────────────────► │   Phone      │
│  (Desktop)   │    snapshot      │  (server.js)  │    mirror + control │  (Browser)   │
└─────────────┘                  └──────────────┘                     └─────────────┘
```

---

## Step-by-Step Setup

### Step 1 — Install Node.js

Make sure you have **Node.js 16+** installed:

```bash
node --version    # Should show v16.x or higher
npm --version     # Should show a version number
```

### Step 2 — Clone the Repository

```bash
git clone https://github.com/diegosouzapw/OmniAntigravityRemoteChat.git
cd OmniAntigravityRemoteChat
```

### Step 3 — Install Dependencies

```bash
npm install
```

### Step 4 — Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set your password:

```env
APP_PASSWORD=your-secure-password
PORT=4747
```

### Step 5 — Launch Antigravity in Debug Mode

Antigravity must be started with the `--remote-debugging-port` flag so the server can connect to it:

```bash
antigravity . --remote-debugging-port=7800
```

**Quick shortcut — add this alias to your `~/.bashrc`:**

```bash
alias agd='antigravity . --remote-debugging-port=7800'
```

Then just run `agd` to launch in debug mode.

### Step 6 — Start the Server

Choose one of the following:

```bash
# Option A: Direct server (simplest)
node server.js

# Option B: With QR code for easy phone access (Wi-Fi)
npm run start:local

# Option C: With ngrok tunnel (access from anywhere)
npm run start:web
```

### Step 7 — Connect from Your Phone

1. Make sure your phone is on the **same Wi-Fi network** as your computer
2. Open the URL shown in the terminal (e.g., `http://192.168.0.xxx:4747`)
3. Enter your password
4. Start chatting! 🎉

---

## Port Reference

| Port     | Purpose                    |            Configurable            |
| -------- | -------------------------- | :--------------------------------: |
| **7800** | Antigravity CDP debug port | Via `--remote-debugging-port` flag |
| **4747** | OmniAntigravity web server |        Via `PORT` in `.env`        |

> These ports were chosen to avoid conflicts with common services (3000=Express/React, 5000=Flask, 8080=Alt HTTP, 9000=PHP-FPM).

---

## Features

- 📱 **Mobile Remote Control** — Send messages, switch modes/models from your phone
- 🔄 **Real-time Sync** — Chat mirrors from desktop to phone automatically
- 🪟 **Multi-Window** — Switch between multiple Antigravity instances
- 🔁 **Auto-Reconnect** — Exponential backoff with toast notifications
- 🔒 **Security** — Password auth, HTTPS support, cookie sessions
- 📟 **QR Code** — Scan to connect instantly from phone
- 🌐 **ngrok Support** — Access from anywhere via web tunnel

---

## npm Scripts

```bash
npm start          # Start server directly
npm run start:local   # Launch with QR code (Wi-Fi mode)
npm run start:web     # Launch with ngrok (internet mode)
npm test           # Run validation test suite
```

---

## Validation Tests

Run the test suite to verify everything is configured correctly:

```bash
npm test
```

This checks:

- ✅ Node.js version and npm availability
- ✅ All dependencies installed
- ✅ Server files syntax validation
- ✅ Port availability
- ✅ CDP connectivity (Antigravity debug port)
- ✅ HTTP endpoints (/, /snapshot, /cdp-targets, /app-state)
- ✅ WebSocket connection

---

## Project Structure

```
├── server.js          # Main server (Express + WebSocket + CDP)
├── launcher.js        # Node.js launcher (QR, ngrok, env)
├── test.js            # Validation test suite
├── public/
│   ├── index.html     # Mobile chat interface
│   ├── login.html     # Login page (web access mode)
│   ├── css/style.css  # Premium dark UI styles
│   └── js/app.js      # Client-side logic
├── .env.example       # Environment template
├── package.json       # Dependencies and scripts
└── start_ag_phone_connect.sh      # Shell launcher (local)
```

---

## Troubleshooting

| Issue               | Solution                                                        |
| ------------------- | --------------------------------------------------------------- |
| "CDP not found"     | Launch Antigravity with `agd` or `--remote-debugging-port=7800` |
| "EADDRINUSE"        | Change `PORT` in `.env`, or stop the process using that port    |
| Phone can't connect | Ensure same Wi-Fi network and check firewall                    |
| "Unauthorized"      | Clear browser cookies and re-enter password                     |

---

## License

MIT
