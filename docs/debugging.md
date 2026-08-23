# Debugging with devup

Debugging a service used to mean stopping it in devup, running it by hand outside, and giving up watch, health checks and restarts while you did. This attaches instead: devup keeps owning the process, and the editor connects to it.

If you would rather be walked through it inside the editor, run **devup: How do I debug my stack?** — same material, with buttons.

## The three ways in

| | Where | Good for |
|---|---|---|
| **devup: Debug service (attach)** | right-click a service in the sidebar | one service, right now |
| `devup: <service>` | the Run and Debug picker (F5) | the same, from the keyboard |
| **devup: Debug the stack** | Command Palette | frontend and APIs together |

All three end in the same place: the service running under the Node inspector, and an ordinary debug session attached to it — breakpoints, stepping, the Debug Console as a REPL against the live process, source maps resolved from the service's own directory.

## What can be debugged

**Services whose `cmd` is `node`.** The Node inspector is a Node feature; the daemon refuses anything else rather than handing `--inspect` to some other command as a script argument, where it would be silently ignored and you would sit waiting for a debugger that never listens.

That leaves frontends out — `npx vite`, `ng serve` and friends. Those are debugged **in the browser**, which is what `devup: Debug the stack` opens for you. A breakpoint in a frontend `.ts` binds through the browser session, not through Node.

## Requirements

`@gachlab/devup` **≥ 0.15.0**. Older daemons will attach, but the session does not survive normal work:

- **< 0.14.0**: no `debug` RPC at all — the command reports the version requirement.
- **< 0.15.0**: lazy mode stops a service you are paused in (it looks idle, because a service stopped on a breakpoint receives no traffic), and the inspector port goes stale on the first `node --watch` rebuild, so re-attaching lands on a dead port.

## Things that will surprise you otherwise

### The port is different every time

devup starts a debugged service with `--inspect=0`, so the operating system picks a free port — a fixed 9229 would collide the moment two services are debugged at once. The port is read back from Node's own startup line and published as `debugPort`.

Consequences worth knowing:

- There is no `launch.json` with a port in it, and you should not write one: it would be wrong by the second rebuild.
- When a watch rebuild ends your session, the extension waits for the new port and re-attaches on its own.
- If you *do* want a fixed port — for a launch configuration you maintain by hand — the daemon accepts one: `debug: 9229` in the service's config.

### The flag outlives your session

`--inspect` lives on the service inside the daemon, not in your editor. That is deliberate: a debugging session usually outlives the crash-and-restart that prompted it, and having the flag survive is the point.

But it also outlives the editor window. **devup: Stop debugging service** is how you put it back — closing the debug session is not the same thing.

### A lazy service gets started, and stays up

Asking to debug an idle lazy service starts it. And while it is being debugged it will not idle-stop: a service paused on a breakpoint receives no traffic by definition, and shutting it down for being quiet would end your session while you were reading code.

It returns to the normal lazy cycle when you turn debugging off.

### You cannot step from the frontend into the API

`devup: Debug the stack` gives you both ends paused in the same window, in one Call Stack, with one Debug Console you can switch between. It does not give you a single continuous stack across the HTTP call — no editor does that today.

The way you actually follow a request: a breakpoint in the frontend where it makes the call, another in the handler that serves it. Act in the browser, stop at the first, step over the call, and the second fires.

### In a remote window, the browser is local

`devup: Debug the stack` opens the browser on **your** machine, not on the remote host, and the editor tunnels the debug port back. `devup.debug.browser` chooses Chrome or Edge.

Related: the services' own ports are forwarded so your browser can reach them — and if one of those ports was already taken locally, the editor binds a different one. The extension warns when that happens, because a frontend that hardcodes `http://localhost:3000` will not reach a tunnel bound on 3001, and nothing else on screen would tell you.

## Debugging the startup path

By the time you attach, the service has already booted: config loaded, database connected, routes registered. To debug *that*, ask for it to stop on the first line:

```ts
{ name: 'app-api', cmd: 'node', args: ['index.js'], type: 'api', port: 3000, phase: 1,
  debug: { brk: true } }
```

or at runtime, `devup ctl debug app-api --brk`. The service will not open its own port until you attach and resume it — devup suspends the timeouts that would otherwise call that a failed start.

## When it does not work

| What you see | What it means |
|---|---|
| *"does not run node"* | The service's `cmd` is something else. Debug the browser instead, or invoke node directly. |
| *"needs @gachlab/devup 0.14.0 or newer"* | The daemon predates the `debug` RPC. It cannot tell you which release it is — only 0.16.0 and later report that — but **devup: Show connection details** names the daemon whenever it can. |
| *"did not come back up under the inspector"* | The restart failed. The daemon rolled the flag back so the service is not left unstartable — check its logs. |
| *"has not announced an inspector port"* | The process started but Node printed no inspector line. Usually a service that is not really Node, or one still starting. |
| The session ends on every save | Expected with watch — it should come back on its own. If it does not, the daemon may be older than 0.15.0. |
| The session attaches but **every breakpoint stays unbound** | Usually two spellings of the same path. Node resolves symlinks when it loads a module, so a workspace opened through one — `~/repos/x` where `~/repos` links to `/mnt/data/repos` — has the editor saying one path and the process reporting another. The extension rebases them when it can see the difference; if it persists, open the folder by its real path (`realpath .`). |
