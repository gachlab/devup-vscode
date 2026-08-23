## Attach to one service

Right-click any service in the devup sidebar → **devup: Debug service (attach)**.

The service restarts under the Node inspector, which takes a few seconds, and the editor attaches. You will know it worked when the tree shows `· debug :39481` beside the service.

From there it is an ordinary debug session: breakpoints, stepping, the Debug Console as a REPL against the live process, source maps resolved from the service's own directory.

Two things worth knowing:

- **Only services that run `node`.** The daemon refuses anything else, and says so. A frontend served by `npx vite` or `ng serve` is debugged through the browser instead — see the last step.
- **A lazy service gets started.** If it was idle, asking to debug it brings it up, and it stays up until you turn debugging off.
