/** Applying a `status.follow` frame to the service map — no vscode dependency,
 *  so it can be unit-tested.
 *
 *  The stream carries two kinds of frame and the extension only ever handled
 *  one. `status` frames are *incremental* after the first: the daemon sends
 *  `[serializeState(name, state)]` per change, so a handler that only ever
 *  sets keys can only ever grow the map. A service dropped by a config reload
 *  stayed in the tree, in the status-bar totals and in every quick-pick until
 *  the connection dropped and `connect()` cleared the map (issue #39).
 *
 *  Removals arrive as `{ event: 'removed', data: [name] }`, added in
 *  @gachlab/devup 0.14.0 (gachlab/devup#82). The daemon guards its status bus
 *  against emitting for a service it has already removed, so a late state
 *  change cannot resurrect one. */
import type { ServiceSnapshot } from './types.js';

export interface StreamFrameLike {
  event: string;
  data: unknown;
}

export interface FrameEffect {
  /** False when the frame was not one we understand — nothing changed and the
   *  store should not fire. */
  applied: boolean;
  added: string[];
  removed: string[];
}

/** A fresh object each time rather than a shared constant: the arrays are part
 *  of the public shape, and one caller that sorts or pushes into them would
 *  corrupt every later ignored frame — surfacing as phantom names in a
 *  "config reloaded" notification, with nothing at the call site to explain
 *  it. */
function ignored(): FrameEffect {
  return { applied: false, added: [], removed: [] };
}

export function applyStreamFrame(services: Map<string, ServiceSnapshot>, frame: StreamFrameLike): FrameEffect {
  if (!Array.isArray(frame.data)) return ignored();

  if (frame.event === 'status') {
    const added: string[] = [];
    for (const entry of frame.data) {
      // The protocol is a hand-written copy that nothing validates (CLAUDE.md
      // rule 2). An entry without a usable name would otherwise be filed under
      // `undefined` and rendered as a service.
      if (!isSnapshot(entry)) continue;
      if (!services.has(entry.name)) added.push(entry.name);
      services.set(entry.name, entry);
    }
    return { applied: true, added, removed: [] };
  }

  if (frame.event === 'removed') {
    const removed: string[] = [];
    for (const name of frame.data) {
      if (typeof name !== 'string') continue;
      if (services.delete(name)) removed.push(name);
    }
    // Applied even when nothing matched: the frame was understood, and a
    // removal for a service we never had is not an error.
    return { applied: true, added: [], removed };
  }

  return ignored();
}

function isSnapshot(value: unknown): value is ServiceSnapshot {
  return !!value
    && typeof value === 'object'
    && typeof (value as { name?: unknown }).name === 'string'
    && (value as { name: string }).name.length > 0;
}
