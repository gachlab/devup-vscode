# devup — VS Code extension

Control your [@gachlab/devup](https://github.com/gachlab/devup) dev stack from inside VS Code: status bar, services tree view (soon), restart/stop/logs (soon), live log streaming (soon).

Talks to a running devup process via its Unix-socket control plane — no separate daemon, no extra setup. If devup is running for your project, the extension picks it up automatically.

## Status

**0.1.0 — early scaffold.** Only the status bar item is wired up. Tree view, output channels, and commands are coming next. Not yet on the marketplace.

| Feature | Status |
|---|---|
| Status bar (aggregate `N/M up`) | ✅ |
| Services tree view in sidebar | 🔲 |
| Per-service output channels (live logs) | 🔲 |
| Restart / Stop / Open-in-browser commands | 🔲 |
| Start devup from VS Code when not running | ⏳ (button in "not running" prompt) |

## How it works

1. The extension activates when your workspace contains `devup.config.{ts,js,json}`.
2. It reads the project `name` from that file (JSON parse for `.json`, regex for `.ts`/`.js`).
3. It connects to `~/.devup/sock-<name>.sock` — the same socket that `devup` itself binds when running.
4. The status bar polls `status` every 3 s (configurable).

If devup isn't running, the status bar shows `devup: not running`. Clicking it offers to launch `devup up -d` in the integrated terminal.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `devup.projectName` | `""` | Override the project name. Use when the auto-detect picks the wrong thing. |
| `devup.socketPath` | `""` | Full override of the socket path. When set, `projectName` is ignored. |
| `devup.pollIntervalMs` | `3000` | Status bar poll interval, milliseconds. |

## Requirements

- VS Code ≥ 1.85
- [@gachlab/devup](https://www.npmjs.com/package/@gachlab/devup) ≥ 0.8.0 running locally (the extension talks to its control plane).
- Linux or macOS. Windows is not yet supported by the daemon, so the extension cannot connect there yet.

## Development

```bash
npm install
npm run build
```

Open this repo in VS Code and press F5 to launch a new Extension Development Host window for live testing.

## License

MIT — see [LICENSE](./LICENSE).
