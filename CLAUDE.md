# Working on the devup VS Code extension

Recurring hazards, each one found the hard way. Check them before opening a PR,
and check them again when reviewing one.

## 1. `ServiceSnapshot.port` is not the port to connect to

For a lazy service devup runs the process on `port + 10000` and keeps its
on-demand proxy on the configured port, which arrives as `originalPort`
(`@gachlab/devup` ≥ 0.12.0). **Always go through `canonicalPort()`** for
anything a user or a browser reaches: forwarding, `openInBrowser`, and every
place the UI prints a port.

0.6.0 shipped forwarding `13002` instead of `3002`. Only the `alwaysOn`
services worked, which made it look like a partial outage rather than a bug.

Never derive it by subtracting the offset — lazy mode is opt-in, so in a
non-lazy stack every port is already real.

## 2. The protocol is a hand-written copy

`src/types.ts` and `src/socket-client.ts` mirror devup's control plane
deliberately, so the extension stays independent of the package. Nothing
checks the two agree (gachlab/devup#87). devup's `serializeState()` is the
source of truth — read it, not the docs, which have been wrong.

Three more mirrors, all of which have drifted at least once:

- `src/socket-path.ts` ↔ devup's `defaultSocketPath`. The extension used to
  strip leading underscores, so `@gachlab/web` resolved to
  `sock-gachlab_web.sock` while the daemon listened on `sock-_gachlab_web.sock`.
- `CONFIG_FILES` in `src/config-file.ts` ↔ devup's `CONFIG_NAMES`
  (`src/config/loader.ts`) — **same names, same order**. Both take the first
  that exists, so a repo with a `.ts` and a `.json` runs under one name and
  gets looked for under the other if the orders disagree. `.mjs` is not in the
  list because devup does not load it.
- `activationEvents` in `package.json` ↔ that same list.

Every one of these fails the same way: the sidebar insists nothing is running
while the daemon is up.

## 3. `asExternalUri` has two rules, both easy to break

- **Do not pair it with `openExternal`.** The API docs: *"uris passed through
  `openExternal` are automatically resolved and you should not call
  `asExternalUri` on them."* Doing both resolves twice and tunnels to a port
  nothing listens on.
- **Do not cache the result.** *"the resolved uri may become invalid… a user
  may close a port forwarding tunnel."* Re-assert instead. There is no stable
  API to close or observe a tunnel, so the editor's Ports view is the only
  source of truth for what is open.

## 4. Comparing the daemon's stats field by field is not a comparison

`StatusStore` used to emit on every `stats` poll whether anything had changed
or not, so every subscriber recomputed every 3 seconds forever (issue #40).
It now emits only when something moved — but the obvious implementation of
that does nothing at all: the daemon recomputes `freeMemMB` from `os.freemem()`
on each poll, and on a live machine those whole megabytes differ *every time*,
while the `11.7 GB` rendered from them does not. The same is true per
service: RSS arrives in tenths of a megabyte and the tree prints whole ones.

Stats are therefore compared by what can actually change on screen —
`systemStatsKey` for the status bar, `serviceStatsKey` for the tree — and
anything new that displays them belongs in one of those keys. Which also means
the *displayed* precision sets the redraw rate, so keep it no finer than the
number deserves: host CPU prints as a whole percent because it comes from the
load average, where a tenth of a percent moves on every kernel update, and the
load average itself is not printed at all for the same reason.

One exception, and the reason `serviceStatsKey` is not simply the rendered
text: service memory is compared at the whole megabyte even above a gigabyte,
where the tree prints tenths of a gigabyte. The warning icons test the raw
value against a threshold, and a 102 MB bucket would let a service sitting at
1510 MB keep the wrong icon indefinitely against a 1500 MB threshold.

Subscribers that do real work per event — `PortForwarder` re-asserting 25
tunnels — should still keep their own fingerprint. The store is quiet, not
silent.

## 5. The socket path is late-bound, and the project name is parsed, not grepped

Discovery re-runs on a watcher over `devup.config.*`, on the two overriding
settings, and when workspace folders change, because renaming a project moves
its socket — that used to leave the extension quiet until the window was
reloaded (issue #38). So **nothing may capture `socketPath` at construction**:
`StatusStore` owns it and re-connects through `setSocketPath()`, and everyone
else takes a `() => string`. Anything that holds a stream has to expose a
`retarget()` for the change.

The name is read with a small scanner anchored to the config object
(`config-file.ts`), not a regex: `/name\s*:/` takes the **first** match in the
file, so a config that declares `services` before `name` — a legal reordering
— latched onto the first service. The scanner skips strings and comments and
only accepts a key at the object's own top level. Never load the config as a
module to read it; it is arbitrary code.

The folder is the first one that has a config, not `workspaceFolders[0]`: the
activation event fires on a match in *any* folder.

## 6. Installing an extension does not reload the extension host

On a remote host this bit three separate diagnoses in one session:

- extensions on the **remote** side never auto-update from the Marketplace;
- installing marks the old version `.obsolete` and keeps running it;
- only *Developer: Reload Window* actually swaps the code.

Before concluding a fix does not work over Remote-SSH, check which version is
actually loaded.

## 7. Verify every new test by mutation

Break the fix, run the test, confirm it **fails**, restore. A sorting test here
passed with the comparator removed, because every port in the fixture had four
digits and lexicographic order happened to match.

## 8. Settings that open a network path are `machine`-scoped

`devup.portForwarding` uses `scope: machine` so a repo-committed
`.vscode/settings.json` cannot turn tunnelling on for a collaborator.
`machine-overridable` is **not** the stricter option — it is the one a
workspace *can* override.
