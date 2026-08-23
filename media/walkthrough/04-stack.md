## Follow a request from the frontend into the API

**devup: Debug the stack (browser + services)** — from the Command Palette.

It asks two things: which frontend to open, and which services to attach to. Then it attaches the services *first* — so their breakpoints are bound before the page loads and starts calling them — and opens the frontend in a debugged browser.

In a remote window the browser opens on **your** machine, not on the remote host, and the editor tunnels the debug port back. Closing it ends the whole thing; your services keep running.

To trace one request: a breakpoint in the frontend where it makes the call, another in the handler that serves it. Act in the browser, stop at the first, step over the call, and the second one fires.

**What this cannot do:** step *into* the server from the frontend. The two ends are separate debug sessions that pause independently — the Call Stack switches between them. No editor does this across an HTTP boundary today.
