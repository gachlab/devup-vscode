## Start the stack

Everything else needs a running daemon. devup spawns your services detached, so the extension talks to its control-plane socket rather than owning any process — which is why you can attach a debugger to a service and leave watch, health checks and restarts exactly as they were.

The sidebar tells you where you stand: the **devup** icon in the activity bar shows every service, its port, and whether it is up. If the daemon is not running, the view offers to start it.

Nothing here is specific to debugging — but a service you cannot see is a service you cannot attach to.
