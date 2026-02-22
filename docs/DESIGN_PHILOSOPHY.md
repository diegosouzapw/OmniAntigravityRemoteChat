# DESIGN PHILOSOPHY — OmniAntigravity Remote Chat

## Problem Statement

Developing with powerful AI models (Claude, Gemini) in Antigravity involves long "thinking" times and prolonged code generation. Developers are "tethered" to their desks, waiting to review or provide the next instruction.

## The Solution: A Wireless Viewport

OmniAntigravity Remote Chat isn't a replacement for the desktop IDE — it's a **wireless extension**. It mirrors the desktop session to any device on the network, freeing you from the desk.

## Design Principles

### 1. Robustness Over Precision

Selecting elements in a dynamically changing IDE is brittle. This project uses **Text-Based Selection** and **Fuzzy Matching** — we find elements by their content, not their CSS class.

### 2. Zero-Impact Mirroring

The snapshot system clones the DOM before capturing, ensuring the mirroring process never interferes with cursor, scroll, or focus on the Desktop.

### 3. Visual Parity (The Dark Mode Bridge)

Instead of mirroring thousands of Antigravity CSS variables, we use **Aggressive CSS Inheritance**. Raw HTML is wrapped in a premium indigo/purple gradient palette with glassmorphism effects that feels natively mobile.

### 4. Multi-Window First (v0.4.0+)

Developers often run multiple Antigravity windows. The system discovers ALL CDP targets across ports 7800-7803, intelligently filters out internal pages (Settings, Launchpad), and lets users switch between real editor windows from their phone. Execution context evaluation loops are designed to try ALL iframe contexts before giving up, ensuring chat detection works even in complex window layouts.

### 5. Resilient Connectivity (v0.4.3+)

- **Exponential Backoff**: Reconnection attempts grow from 2s to 30s, then reset on success
- **WebSocket Heartbeat**: Ping/pong every 30s detects stale connections before they fail
- **Status Broadcasting**: Mobile clients see real-time connection state (not just "connected or not")
- **Graceful Degradation**: Phone shows helpful reconnection UI instead of a blank screen

### 6. Zero Dependencies Outside Node.js

The project runs on **pure Node.js** — no Python, no external tools. QR codes, ngrok tunnels, SSL generation, everything is handled in JavaScript.

### 7. Security-First Access

- **HTTPS by Default**: When SSL certificates exist, the server auto-enables HTTPS.
- **LAN Auto-Auth**: Local devices get automatic access for convenience.
- **Web Mode**: ngrok tunnel with password protection for remote access.

### 8. Mobile-First Navigation

Full-screen modals for history, settings, and window selection. Sidebar navigation doesn't work on phones — we use modal-layered overlays instead.

## Human-Centric Features

- **The "Bathroom" Use Case**: Check AI progress while away from desk
- **Thought Expansion**: Remote-click to peek into AI's internal reasoning
- **Bi-directional Sync**: Desktop model changes reflect on phone automatically
- **Window Switching**: Manage multiple Antigravity sessions from one phone

## Technical Trade-offs

| Decision                  | Rationale                                        |
| :------------------------ | :----------------------------------------------- |
| Port 7800 (not 9000)      | Avoids PHP-FPM/SonarQube conflicts               |
| Port 4747 (not 3000)      | Avoids Express/React dev server conflicts        |
| Self-signed certs         | Simpler setup, works offline, no domain needed   |
| Pure Node.js              | No Python, no OpenSSL dependency                 |
| Passcode auth (not OAuth) | Low friction for personal tool                   |
| Exponential backoff       | Prevents server spam during Antigravity restarts |
| Phone-as-Master scroll    | Prevents sync-fighting conflicts                 |
| 15s scroll lock           | Gives users time to interact with buttons        |
| Force-expand all sections | Collapsed content is unusable on small screens   |

> 📚 See [SECURITY.md](../SECURITY.md) for security details and [CODE_DOCUMENTATION.md](CODE_DOCUMENTATION.md) for API reference.
