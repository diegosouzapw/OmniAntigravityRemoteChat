# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-02-22

### Added

- 📁 Project reorganized into `src/`, `scripts/`, `docs/` structure
- 🧪 Validation test suite (`npm test`) with 25 checks
- 📖 Step-by-step README with setup guide and troubleshooting
- 🤖 AGENTS.md for AI coding assistants
- 📋 CHANGELOG.md, CODE_OF_CONDUCT.md
- 📝 GitHub issue and PR templates (`.github/`)

### Changed

- 🔧 CDP ports: 9000 → 7800 (avoids PHP-FPM/SonarQube conflicts)
- 🔧 Server port default: 3000 → 4747 (avoids Express/React conflicts)
- 🗑️ Removed Python dependency entirely (`launcher.py` → `launcher.js`)

## [2.0.0] - 2026-02-22

### Added

- ✨ **Phase 1**: Rebranded to OmniAntigravity Remote Chat
- 🎨 **Phase 2**: Premium mobile UI — gradient brand palette, pulse animations, glassmorphism, spring-animated modals
- 🪟 **Phase 3**: Multi-window CDP support — switch between Antigravity instances
- 🚀 **Phase 4**: Node.js launcher with QR code and ngrok support
- 🔁 **Phase 5**: Robust auto-reconnect with exponential backoff, WebSocket heartbeat, mobile status toasts

### Fixed

- 🐛 Critical CDP port mismatch: was scanning 5000-5003 instead of 9000-9003

## [1.0.0] - 2026-02-21

### Added

- Initial release forked from `antigravity_phone_chat`
- CDP-based chat mirroring
- Mobile web interface with dark theme
- Password authentication
- WebSocket real-time sync
- Shell launchers for local and web access
