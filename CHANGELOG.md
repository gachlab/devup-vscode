# Changelog

All notable changes to the devup VS Code extension are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **The status bar showed memory twice and called one of them CPU** (#37). The `$(pulse)` figure was `100 - free/total`, a *memory* percentage, printed immediately before the same memory in GB — so `$(pulse) 38.7% · 12 GB/31 GB` was one quantity shown twice, with the first labelled wrong. There was no host CPU figure in the protocol at all until devup 0.14.0 added `cpuPercent` (load average as a share of cores); the status bar now shows that — in whole percent, since it is derived from the 1-minute load average and a tenth of a percent there moves on every kernel update without telling anyone anything — and memory in absolute terms only. Where the daemon reports no CPU — an older daemon, or Windows, where `os.loadavg()` is hardcoded to zeroes — the segment is memory alone rather than a plausible-looking stand-in.
- **The whole UI recomputed every 3 seconds whether or not anything moved** (#40). The `stats` poll fired a change event on every tick, so the tree, status bar, badge, context key and every open detail panel re-rendered continuously — the reason `PortForwarder` had to keep its own fingerprint to filter the noise. The store now compares against the previous poll and stays quiet when nothing moved — for the system figures, by what the status bar would render, since the daemon recomputes host free memory from `os.freemem()` on every poll and that whole-megabyte number changes every time on a live machine, while the `31 GB` built from it does not. Comparing the raw fields would have left the event firing every 3 s exactly as before. The poll is *not* paused when the tree is hidden, as the issue also suggested: the status bar consumes the same stats and is always on screen.
- **Reconnecting to a daemon that is not running retried every 3 s forever** (#41), roughly 1,200 socket opens an hour against a path that does not exist. The delay now doubles from 3 s to a 30 s ceiling, and resets once a connection has demonstrably worked — on the first frame of the status stream, not on the one-shot probe, since a daemon whose stream fails immediately would otherwise pin the retry at a flat 3 s. A daemon that comes back while the delay is at the ceiling is therefore noticed within 30 s; **`devup: Refresh services` now retries immediately** instead of doing nothing, and is back as a button in the view title; starting or restarting the daemon from the extension also retries while the stack boots, rather than leaving the sidebar saying "not running" for half a minute after it is up.

### Internal
- New vscode-free modules `src/stats-cache.ts` (stats comparison) and `src/backoff.ts`, plus `formatSystemStats` / `formatSystemTooltip` / `systemStatsKey` in `src/url-builder.ts` — 38 new unit tests, each verified by mutation.

## [0.7.0] — 2026-08-21

A minor rather than a patch: the default changes behaviour for anyone who never touched the setting, and Marketplace auto-update would apply it unasked.

### Fixed
- **Forwarded the wrong port for every lazy service** — 0.6.0 tunnelled the port from the status snapshot, believing it to be the configured one. It is not: devup runs a lazy service on `port + 10000` and keeps its own on-demand proxy on the configured port, and the snapshot reported only the rewritten value. So `authorization-api` was forwarded as `13002` instead of `3002` — reaching the service directly, bypassing the proxy that starts it, and missing the port the frontend calls. Only always-on services were unaffected, which is why `app-web` and `configurations-api` appeared to work.
- **`devup: Open in browser` opened the rewritten port too**, for the same reason and with the same consequence.
- **The sidebar, tooltip, quick-picks and detail panel showed the rewritten port**, so a port copied out of the UI was one that neither works nor is forwarded. They now show the port you can use; the tooltip and detail panel also name the internal one, which is what logs and debugger attachment use. The detail panel's port now updates live instead of keeping whatever was rendered when it opened.

### Changed
- **`devup.portForwarding` now defaults to `all`** rather than `web`. A frontend whose API calls do not resolve is not a working app, and `web` alone produced exactly that: pages that load and then fail against every backend. `web` remains for anyone who only wants the frontends reachable.

  Worth knowing with `all`: devup's lazy proxy starts a service on a **bare TCP connection**, before any bytes arrive. So anything that merely connects to a forwarded API port — a browser preconnect, a local scanner — boots that service and resets its idle timer. Use `web`, or exclude specific ports via `remote.portsAttributes` → `onAutoForward: "ignore"`, if that matters more than reachability.

### Requires
- **`@gachlab/devup` ≥ 0.12.0**, which adds `originalPort` to the status snapshot. Note that 0.11.2 does *not* carry it. Deriving the configured port client-side is not safe — lazy mode is opt-in, so in a non-lazy stack every reported port is already real and a service configured on `18080` would be mangled into `8080`. Only the daemon knows which services it rewrote. Against an older daemon the extension keeps 0.6.0 behaviour rather than guessing.

## [0.6.0] — 2026-08-21

### Added
- **Automatic port forwarding in remote windows** — when the window is attached to a remote host (Remote-SSH, Dev Containers, WSL, Codespaces), devup service ports are tunnelled back to you and show up in the Ports view. VS Code auto-forwards only the ports it observes being opened, and the daemon spawns its services detached, so none were ever detected. Controlled by `devup.portForwarding` (`web` — default, `all`, `off`). Idle in local windows.

  Reaching a service: the **Ports view is the source of truth** for the address. It is usually `http://localhost:<port>`, with two exceptions —
  - **The local port can differ.** If the port is already bound on your machine — likely if you also run the stack locally — the editor remaps it.
  - **Codespaces and Remote Tunnels publish to a hosted URL** rather than binding a local port, since there is no local machine to bind on.

  Opting out: `off` stops new forwards, and individual ports can be excluded with `remote.portsAttributes` → `onAutoForward: "ignore"` (exact ports and `low-high` ranges). The setting is `machine`-scoped, so a repo-committed `.vscode/settings.json` cannot decide to open network paths onto a collaborator's machine.

  Not covered: with devup's reverse proxy active, `devup: Open in browser` targets `<sub>.<domain>`, which resolves on the remote host and not on yours. The underlying service ports are still forwarded, so reach them through the Ports view address.

### Internal
- New vscode-free module `src/forward-logic.ts` (`selectForwardPorts`, `parseForwardMode`, `isPortIgnored`) with 14 unit tests.

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
