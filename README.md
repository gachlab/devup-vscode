# devup — VS Code extension

[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/gachlab.devup-vscode?label=marketplace&color=007ACC)](https://marketplace.visualstudio.com/items?itemName=gachlab.devup-vscode)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/gachlab.devup-vscode)](https://marketplace.visualstudio.com/items?itemName=gachlab.devup-vscode)

Control your [@gachlab/devup](https://github.com/gachlab/devup) dev stack from inside VS Code: sidebar tree, status bar, live logs, service detail panels, daemon lifecycle commands, and profile filtering.

Talks to a running devup daemon via its Unix-socket control plane — no separate process, no extra setup. If devup is running for your project, the extension picks it up automatically and reconnects whenever it comes back.

## Features

| Feature | Since |
|---|---|
| Status bar — aggregate `N/M up` with health colour | 0.1.0 |
| Services tree view — grouped by type (APIs / Webs) | 0.1.0 |
| Per-service output channels with live log streaming | 0.1.0 |
| Restart / Stop / Open-in-browser per service | 0.1.0 |
| Live updates via `status.follow` — no polling | 0.1.0 |
| Crash badge on the activity-bar icon | 0.2.0 |
| Service detail webview — live logs, status/health badges, action buttons | 0.2.0 |
| Daemon lifecycle commands from the sidebar (start / stop / restart) | 0.2.0 |
| Welcome view with Start button when daemon is not running | 0.3.0 |
| Group services by boot phase (`devup.treeView.groupBy`) | 0.3.0 |
| Flat list mode (no grouping) | 0.3.0 |
| Profile picker — filter tree to a config profile | 0.3.0 |
| Crash reason in tree tooltip + detail panel "Last crash" section | 0.5.0 |
| Service config (cmd, cwd, port) in detail panel | 0.5.0 |
| Open terminal in service cwd — tree context menu + detail panel button | 0.5.0 |
| CPU/mem color coding — yellow/red icons at configurable thresholds | 0.5.0 |
| Hot reload notification when services are added/removed | 0.5.0 |
| Log filter in detail panel — live search with match count | 0.5.0 |
| Stats per service (CPU% · mem) in tree + system totals in status bar | 0.4.0 |
| Proxy-aware URLs in "Open in browser" (Traefik / Caddy / nginx) | 0.4.0 |
| Follows a project rename — discovery re-runs on config and setting changes | 0.8.0 |
| Welcome view explains *why* the daemon is unreachable, with the action to fix it | 0.8.0 |
| Services dropped by a hot reload leave the sidebar (needs devup ≥ 0.14.0) | 0.8.0 |
| Proxy shown in the tree — provider, domain, TLS — with each service's route | 0.8.0 |
| Copy service URL, proxy route included | 0.8.0 |
| Open a service's log file, and reveal the logs folder | 0.8.0 |
| Forwarded ports marked in the tree, with a prompt to close them when the daemon goes | 0.8.0 |
| Attach a debugger to a service, without taking it out of devup (needs devup ≥ 0.14.0) | 0.8.0 |
| F5 and the Run and Debug dropdown, one entry per service — no launch.json | 0.9.0 |
| Re-attaches on its own when a watch restart moves the inspector port | 0.9.0 |
| Resolves local `node_modules` devup before global install | 0.2.1 |

## How it works

1. The extension activates when your workspace contains `devup.config.{ts,js,json}` — the same three names, in the same order, that the devup CLI itself loads.
2. It resolves the project `name` from that file — the top-level one, wherever it sits in the object — and connects to `~/.devup/sock-<name>.sock`. In a multi-root workspace it uses the folder that actually has a config. If the name cannot be read, the sidebar says so and offers to set `devup.projectName`, rather than reporting a generic "not running".
3. It opens a persistent `status.follow` stream — service state updates arrive in real time with no polling.
4. When the daemon goes down, the extension shows a welcome view and reconnects on its own — after 3 s, then doubling to at most 30 s while it stays down. `devup: Refresh services` retries immediately if you do not want to wait for the next attempt.

All data (service status, health, phase, profiles) comes exclusively from the daemon's control-plane RPC. The config file is read for one thing only — the project name that resolves the socket path — and it is scanned, never loaded as a module. It is also watched: renaming a project moves its socket, and the extension follows it without a window reload.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `devup.projectName` | `""` | Override the project name used to locate the socket. |
| `devup.socketPath` | `""` | Full override of the socket path. When set, `projectName` is ignored. |
| `devup.executablePath` | `""` | Path to the `devup` binary. Empty = use `npx devup` (local `node_modules` first, then global). |
| `devup.treeView.groupBy` | `"type"` | How to group services: `"type"` (APIs / Webs), `"phase"` (phase 0, phase 1, …), or `"none"` (flat list). |
| `devup.profile` | `""` | Active profile filter. When set, only services in that profile are shown. Empty = all services. |
| `devup.logDir` | `""` | Root of devup's log directory, when the daemon runs with `--log-dir`. Empty = `~/.devup/logs`. The daemon does not publish this, so it has to be repeated here for "Open log file" to find anything. |

## Requirements

- VS Code ≥ 1.85
- [@gachlab/devup](https://www.npmjs.com/package/@gachlab/devup) **≥ 0.10.1** running locally (uses `info`, `stats`, and `proxy` RPC methods). **≥ 0.12.0** for correct ports on lazy services, and **≥ 0.14.0** for host CPU in the status bar, for services to leave the sidebar when a hot reload drops them, and for `devup: Debug service`. Older daemons keep working, minus those.
- Linux or macOS. Windows is not yet supported by the devup daemon.

## Install

### From the VS Code Marketplace (recommended)

Search **devup** in the Extensions panel, or install directly:

```
ext install gachlab.devup-vscode
```

Or open: [marketplace.visualstudio.com/items?itemName=gachlab.devup-vscode](https://marketplace.visualstudio.com/items?itemName=gachlab.devup-vscode)

### From GitHub releases

Each tagged [release](https://github.com/gachlab/devup-vscode/releases) also ships a `.vsix`. Download it, then: `Cmd/Ctrl+Shift+P` → **Extensions: Install from VSIX…** → pick the file.

### Build from source

```bash
git clone git@github.com:gachlab/devup-vscode.git
cd devup-vscode && npm install
npx @vscode/vsce package --no-dependencies --skip-license
# → produces devup-vscode-0.3.0.vsix
```

## Development

```bash
npm install
npm run build      # one-off build
npm run watch      # rebuild on save
npm run typecheck  # type-check without emitting
```

Open this repo in VS Code and press **F5** to launch an Extension Development Host window.

## License

MIT — see [LICENSE](./LICENSE).
