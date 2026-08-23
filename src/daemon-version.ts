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
  // `'unknown'` is the daemon's own sentinel for "I could not read my own
  // manifest". Rendering it as a version — "@gachlab/devup unknown" — reads
  // like a bug in the extension rather than an answer.
  return version && version !== 'unknown'
    ? `${feature} This one is @gachlab/devup ${version}; it needs ${minVersion} or newer.`
    : `${feature} It needs @gachlab/devup ${minVersion} or newer — this one predates 0.16.0, so it cannot say which it is.`;
}
