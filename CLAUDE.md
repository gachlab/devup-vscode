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

## 3. `asExternalUri` has two rules, both easy to break

- **Do not pair it with `openExternal`.** The API docs: *"uris passed through
  `openExternal` are automatically resolved and you should not call
  `asExternalUri` on them."* Doing both resolves twice and tunnels to a port
  nothing listens on.
- **Do not cache the result.** *"the resolved uri may become invalid… a user
  may close a port forwarding tunnel."* Re-assert instead. There is no stable
  API to close or observe a tunnel, so the editor's Ports view is the only
  source of truth for what is open.

## 4. The store fires every few seconds regardless

`StatusStore` emits on every `stats` poll whether anything changed or not.
Anything subscribing to `onDidChange` must compare against its own previous
value, or it will do its work every 3 seconds forever. See issue #40.

## 5. Discovery runs once, at activation

`discover()` is called a single time and nothing watches `devup.config.*`.
Renaming a project moves its socket and the extension goes quiet until the
window is reloaded. The project name is also parsed with a regex that takes
the **first** `name:` in the file — put `services` before `name` and it latches
onto a service. See issue #38.

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
