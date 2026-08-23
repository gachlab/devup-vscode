/** Turning "this daemon is too old" into something a person can act on.
 *
 *  Pure, so it can be tested without vscode — see `tests/unit`.
 *
 *  Until `info` carried a version (@gachlab/devup 0.16.0) the extension had no
 *  way to name the daemon it was talking to, so every "needs X or newer" was
 *  half an answer and every diagnosis started by working out what was actually
 *  running. A daemon old enough to lack the field is, conveniently, old enough
 *  that saying so is itself informative. */
export function tooOldMessage(feature: string, minVersion: string, version?: string): string {
  return version
    ? `${feature} This one is @gachlab/devup ${version}; it needs ${minVersion} or newer.`
    : `${feature} It needs @gachlab/devup ${minVersion} or newer — this one predates 0.16.0, so it cannot say which it is.`;
}

/** Whether a daemon advertises an RPC.
 *
 *  `methods` arrived in 0.16.0. An older daemon does not list anything, and
 *  the honest answer is "no idea" rather than "no" — refusing to try would
 *  break the extension against every daemon released so far. `undefined` means
 *  go ahead and find out the old way, from the error. */
export function daemonHasMethod(method: string, methods?: string[]): boolean | undefined {
  if (!methods) return undefined;
  return methods.includes(method);
}
