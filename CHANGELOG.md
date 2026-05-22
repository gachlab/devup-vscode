# Changelog

All notable changes to the devup VS Code extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — Unreleased

Initial scaffold. Status bar + live log streaming.

### Added
- Status bar item shows aggregate health: `devup: N/M up`, with colour coding for crashed (red) / starting (yellow) / healthy.
- Activation on `devup.config.{ts,js,json}` presence in the workspace.
- Auto-discovery of the project name from `devup.config.*` (JSON parse for `.json`, regex match for `.ts`/`.js`).
- Settings: `devup.projectName` (override), `devup.socketPath` (full override), `devup.pollIntervalMs` (default 3000).
- Command `devup: Tail logs for a service…` — quick-pick a service, opens its OutputChannel with live `logs.follow` streaming (last 200 lines replayed first, then new lines as they arrive). Status-bar click defaults to this picker.
- Command `devup: Show status` — opens a notification with aggregate counts.
- Both commands offer to start `devup up -d` in the integrated terminal when the daemon isn't running.
