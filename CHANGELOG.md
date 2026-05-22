# Changelog

All notable changes to the devup VS Code extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — Unreleased

First releasable MVP. Discovery + status bar + sidebar tree view + per-service log streaming + context-menu commands.

### Added
- **Sidebar tree view** (`gachlab/devup-vscode#3`). New devup view container in the activity bar; tree groups by service type (APIs / Webs) with per-service health icon (✓ / spinner / ✖ / ○), port, and `status/health` description. Tooltip shows pid, errors, restarts. Default click → open the service's live log channel.
- **Per-service log streaming** (`#2`). `devup: Tail logs for a service…` command. Quick-pick from the daemon's status, opens a dedicated OutputChannel fed by `logs.follow` (200-line tail replay then live).
- **Context-menu commands** (`#4`). On any service in the tree:
  - **Tail logs** (also inline icon) — same as default click.
  - **Restart** (also inline icon) — sends `restart` RPC.
  - **Stop** — sends `stop` RPC.
  - **Open in browser** — web services only; opens `http://localhost:<port>`. (Proxy-aware URL handling deferred.)
- **Status bar item** (`#1`) shows aggregate health `devup: N/M up`, colour-coded (red for crashed, yellow for starting, green for all-up). Click → tail-logs picker.
- **Live `status.follow` subscription** instead of polling. The status bar and tree view both consume a single `StatusStore` backed by the streaming control-plane RPC, so updates land within milliseconds of the daemon's state changing. Auto-reconnects every 3 s when the daemon goes down and comes back up.
- **Auto-discovery** of the project name from `devup.config.{ts,js,json}`. Settings: `devup.projectName` and `devup.socketPath` overrides.
- **Daemon-not-running prompt**: when the user invokes a command and the daemon is unreachable, offer to launch `devup up -d` in the integrated terminal.

### Requires
- `@gachlab/devup` ≥ 0.9.2 running locally (streaming control plane is needed for the tree view's live updates).
