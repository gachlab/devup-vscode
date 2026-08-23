## Turn it off when you are done

**devup: Stop debugging service**.

This matters more than it looks. The `--inspect` flag does not belong to your editor session — it lives on the service inside the daemon. So it survives the crash and restart that usually prompt a debugging session, which is what you want mid-hunt, and it also outlives the editor, which is not.

While it is on, a lazy service stays up rather than returning to idle. That is intended: a service you are paused in should not be shut down under you for being quiet. Turning debugging off puts it back in the normal cycle.

Ending the debug session is not the same as turning debugging off. If you closed the session and the service is still running under the inspector, this command is what puts it back.
