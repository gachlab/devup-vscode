# Changelog

All notable changes to the devup VS Code extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] — 2026-05-22

UX improvements across tree view, detail panel, and notifications. Requires `@gachlab/devup` ≥ 0.11.1.

### Added
- **Crash reason in tree + detail panel** (#22) — last 5 crash log lines shown in service tooltip; collapsible "Last crash" section in the detail panel. Clears on successful restart.
- **Service config in detail panel** (#24) — collapsible "Config" section shows `cmd`, `cwd`, `port`, `type`, `phase`.
- **Open terminal in service cwd** (#21) — `devup: Open terminal in service cwd` command in tree context menu and detail panel. Opens an integrated terminal in the service's working directory.
- **CPU/mem color coding** (#25) — service icon turns yellow when CPU > 80% or mem > 500 MB; red when CPU > 95% or mem > 1 GB. Thresholds configurable via settings.
- **Hot reload notification** (#26) — notification when the daemon reloads config and services are added/removed. Suppressible via `devup.notifications.configReload`.
- **Log filter in detail panel** — text input above the log viewport filters lines live; shows match count.

### Requires
- `@gachlab/devup` ≥ 0.11.1 (adds `cmd`, `cwd`, `crashLog` to status RPC snapshot).

## [0.4.1] — 2026-05-22

### Fixed
- **Tree context menu commands broken** (#27) — all commands triggered from the tree view (Open detail, Restart, Stop, Open in browser) were receiving the full tree Node object as argument instead of a service name string, resulting in `[object Object]`. Added `extractSvcName()` helper that handles all argument shapes.

### Internal
- Extracted pure logic to vscode-free modules: `src/types.ts`, `src/svc-name.ts`, `src/tree-logic.ts`
- Added 27 unit tests covering `extractSvcName`, `buildPhaseGroups`, `buildServiceUrl`, `formatCpu`, `formatMem`
- CI and publish pipelines now run unit tests before build

## [0.4.0] — 2026-05-22

Stats integration and proxy-aware URLs. Requires `@gachlab/devup` ≥ 0.10.0.

### Added
- **Stats integration** (#8) — each service in the tree shows `· 2.3% · 184 MB` alongside its status. Status bar appends RAM usage to the aggregate line (e.g. `devup: 4/4 up · 45% · 6.2/16 GB`). Stats are polled every 3 s via the `stats` RPC. Degrades gracefully when the core is older than 0.10.0 (columns simply omitted).
- **Proxy-aware URLs** (#9) — `devup: Open in browser` now honours the active reverse proxy configuration. Opens `https://<sub>.<domain>` when Traefik/Caddy/nginx is active and the service has a route; falls back to `http://localhost:<port>` otherwise. Both the tree-view context menu and the service detail panel use the same URL builder.

### Requires
- `@gachlab/devup` ≥ 0.10.0 (adds `stats` RPC and `proxy` field in `status` response).

## [0.3.0] — 2026-05-22

Welcome view, configurable tree grouping, and profile filtering. Requires `@gachlab/devup` ≥ 0.10.1.

### Added
- **Welcome view** (#11) — when the daemon is not running, the sidebar shows a welcome card with a **Start daemon** button and a link to the devup docs. Disappears the moment the daemon connects.
- **Group by phase** (#13) — new `devup.treeView.groupBy` setting: `"type"` (APIs / Webs, default), `"phase"` (phase 0, phase 1, …), or `"none"` (flat list). Switching the setting re-groups the tree live without reloading.
- **Profile picker** (#12) — status-bar item shows the active profile (`profile: all` when none). Clicking it opens a QuickPick listing all profiles from the daemon's `info` RPC. Selecting a profile filters the tree to that profile's services. The active profile persists in workspace settings (`devup.profile`).

### Changed
- `ServiceSnapshot` now includes `phase: number` (from `status` RPC, added in devup 0.10.1).
- `StatusStore` fetches `info` RPC at connection time to load project name and profiles.
- Tree returns an empty list when disconnected so VS Code's `viewsWelcome` takes over.

### Requires
- `@gachlab/devup` ≥ 0.10.1 (adds `phase` to `status` response and exposes the `info` RPC).

## [0.2.1] — 2026-05-22

### Changed
- **Local devup resolution** (#16) — daemon commands now use `npx devup` by default, which searches `node_modules/.bin` before the global PATH. New `devup.executablePath` setting to override with a custom binary path.

## [0.2.0] — 2026-05-22

Visual depth + first-class daemon control. Three issues closed: #7, #10, #14.

### Added
- **Daemon management commands** (#14) — `devup: Start daemon` / `Stop daemon` / `Restart daemon` from the command palette. Tree-view title bar shows the right action based on whether the daemon is reachable: ▶ Start when down, ⟲ Restart + ⏹ Stop when up. All three shell out to the `devup` CLI in a reused integrated terminal (workspace cwd), so the behaviour is transparent and matches what you'd type by hand.
- **Crash badge on the activity bar icon** (#7) — count of services with `status === 'crashed'` appears as a red numeric badge on the devup activity-bar icon. Clears automatically when everything recovers. Live-updated via the StatusStore.
- **Service detail webview** (#10) — new `devup: Open service detail` command (inline `$(preview)` icon on each tree item, right-click menu, palette). Opens a webview panel beside the editor with status/health badges, port/pid/errors/restarts, action buttons (Restart, Stop, Tail logs, Open in browser), and a live recent-logs viewport (fed by `logs.follow`, 200-line tail then live, 500-line cap, auto-scroll). One panel per service; re-opening focuses the existing panel. Theme-aware via VS Code CSS variables.

### Changed
- Tree-item inline icons reordered: $(preview) detail, $(output) logs, $(refresh) restart.
- New context key `devup.daemonReachable` powers the conditional title-bar menus.

### Notes
- Cross-repo work (stats integration, proxy-aware URLs) moved to milestone 0.4.0 — blocked on `@gachlab/devup` 0.10.0.

## [0.1.0] — 2026-05-22

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
