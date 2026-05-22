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
| Resolves local `node_modules` devup before global install | 0.2.1 |

## How it works

1. The extension activates when your workspace contains `devup.config.{ts,js,json}`.
2. It resolves the project `name` from that file and connects to `~/.devup/sock-<name>.sock`.
3. It opens a persistent `status.follow` stream — service state updates arrive in real time with no polling.
4. When the daemon goes down, the extension shows a welcome view and automatically reconnects every 3 s.

All data (service status, health, phase, profiles) comes exclusively from the daemon's control-plane RPC — the extension never reads your config file directly.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `devup.projectName` | `""` | Override the project name used to locate the socket. |
| `devup.socketPath` | `""` | Full override of the socket path. When set, `projectName` is ignored. |
| `devup.executablePath` | `""` | Path to the `devup` binary. Empty = use `npx devup` (local `node_modules` first, then global). |
| `devup.treeView.groupBy` | `"type"` | How to group services: `"type"` (APIs / Webs), `"phase"` (phase 0, phase 1, …), or `"none"` (flat list). |
| `devup.profile` | `""` | Active profile filter. When set, only services in that profile are shown. Empty = all services. |

## Requirements

- VS Code ≥ 1.85
- [@gachlab/devup](https://www.npmjs.com/package/@gachlab/devup) **≥ 0.10.1** running locally (the extension uses the `info` and `stats` RPC methods added in that release).
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
