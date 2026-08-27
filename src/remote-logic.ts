/** Pure decisions about services devup serves from a remote environment.
 *
 *  Separate from the tree and the commands because that is the only way this
 *  repo can test any of it: `vscode` is not available under `test:unit`, so
 *  anything worth asserting has to live outside a module that imports it. */
import type { ServiceSnapshot, RemoteInfo, StartResult } from './types.js';

/** Narrowed rather than a boolean, so a caller that checks gets the value. */
export function remoteOf(svc: Pick<ServiceSnapshot, 'remote'>): RemoteInfo | null {
  return svc.remote ?? null;
}

/** The tree item's description — the dim text after the name.
 *
 *  It says the environment rather than the status, because `running` is true
 *  and useless here: what matters about this row is that the process is not on
 *  this machine and that a request typed against its port leaves it. */
export function remoteDescription(remote: RemoteInfo): string {
  return remote.readOnly ? `→ ${remote.envName} (read-only)` : `→ ${remote.envName}`;
}

/** Tooltip lines for a remote service, in the order they earn their place.
 *
 *  The write warning comes first because it is the one with consequences:
 *  `readOnly` is false by default, so most of these accept writes into a
 *  system other people are looking at. */
export function remoteTooltipLines(remote: RemoteInfo): string[] {
  const lines: string[] = [];
  lines.push(remote.readOnly
    ? `served from **${remote.envName}** (read-only — writes are refused)`
    : `served from **${remote.envName}** — ⚠ writes from here reach it`);
  lines.push(`target: ${remote.target}`);
  lines.push('no local process — nothing to attach a debugger to, and no CPU or memory to sample');
  return lines;
}

/** What the `errors` count means for this service.
 *
 *  The same number, and a different thing to do about it: on a local service
 *  it counts stderr lines and points at the service; on a remote one it counts
 *  requests that never reached the environment and points at the network, or
 *  at the environment being down. A 500 that came *back* is not counted. */
export function errorsLabel(svc: Pick<ServiceSnapshot, 'remote'>): string {
  return remoteOf(svc) ? 'unreachable requests' : 'errors';
}

export interface AttachVerdict {
  ok: boolean;
  /** Why not, phrased for a person about to click. */
  reason?: string;
}

/** Whether a debugger can be attached at all.
 *
 *  A remote service has `pid: null` and always will: the inspector runs inside
 *  the process, and the process is somewhere else. Offering the entry and
 *  doing nothing is the failure this replaces — the reason is the useful part,
 *  because it says what to do instead. */
export function canAttachDebugger(svc: Pick<ServiceSnapshot, 'remote' | 'name'>): AttachVerdict {
  const remote = remoteOf(svc);
  if (!remote) return { ok: true };
  return {
    ok: false,
    reason: `served from ${remote.envName} — there is no process here to attach to. Bring it local first.`,
  };
}

/** What to tell someone who asked for a restart or a start.
 *
 *  `skippedRemote` arrives with `ok: true`, so a client that only looks at
 *  `ok` says "restarted" about something that never happened. Older daemons
 *  (contract < 4) do not send the field; the snapshot's own `remote` is the
 *  fallback, and it has been there since contract 3. */
export function actionOutcome(
  verb: 'restart' | 'start',
  svcName: string,
  result: StartResult | undefined,
  snapshot?: Pick<ServiceSnapshot, 'remote'>,
): { kind: 'done' | 'skipped' | 'failed'; message: string } {
  const env = result?.skippedRemote ?? (snapshot ? remoteOf(snapshot)?.envName : undefined);
  if (env) {
    return {
      kind: 'skipped',
      message: `devup: "${svcName}" is served from ${env} — nothing to ${verb} here.`,
    };
  }
  if (result && result.ok === false) {
    return { kind: 'failed', message: `devup: "${svcName}" did not come up.` };
  }
  if (result?.skippedIdle) {
    return { kind: 'skipped', message: `devup: "${svcName}" was idle (lazy) and was left asleep.` };
  }
  return { kind: 'done', message: `devup: ${verb} sent to "${svcName}"` };
}

/** Whether the daemon can be asked to move services between local and an
 *  environment. `contract` is what to check, not the release number — see the
 *  note on `ProjectInfo.contract`. */
export function supportsRemoteSwitch(contract: number | undefined): boolean {
  return typeof contract === 'number' && contract >= 3;
}

/** Whether `start` / `restart` results carry `skippedRemote`. Below this, the
 *  snapshot's `remote` field is the only signal — which is why `actionOutcome`
 *  takes the snapshot too. */
export function reportsSkippedRemote(contract: number | undefined): boolean {
  return typeof contract === 'number' && contract >= 4;
}

/** The `status/health` segment of a tree item's description.
 *
 *  For a remote service the status is always `running`, which is true and
 *  useless — every one of them reads the same. The environment goes there
 *  instead, and `health` stays, because for a remote service it answers a
 *  question that genuinely varies: whether the environment is reachable. */
export function serviceStatusText(
  svc: Pick<ServiceSnapshot, 'status' | 'health' | 'remote'>,
): string {
  const remote = remoteOf(svc);
  if (!remote) return `${svc.status}/${svc.health}`;
  return `${remoteDescription(remote)}/${svc.health}`;
}

/** The tree item's `contextValue`, which is what `package.json` menu clauses
 *  match on.
 *
 *  Prefixes rather than suffixes, so a clause can anchor without a lookahead —
 *  and so the existing unanchored `/service-/` clauses keep matching. The
 *  `remote-` prefix is what lets the menus drop "restart" and "attach" for a
 *  service that has no process, and offer "bring local" instead. */
export function serviceContextValue(
  svc: Pick<ServiceSnapshot, 'type' | 'remote' | 'debugPort'>,
): string {
  const debugging = typeof svc.debugPort === 'number' ? 'debug-' : '';
  const remote = remoteOf(svc) ? 'remote-' : '';
  return `${debugging}${remote}service-${svc.type}`;
}

/** The line under a service's name in the debug picker.
 *
 *  A remote service is kept in the list rather than filtered out, and carries
 *  its reason here. Removing it would leave someone looking for a service that
 *  is plainly in the sidebar and wondering where it went; the reason says both
 *  why it is not available and what to do about it. */
export function debugPickDescription(
  svc: Pick<ServiceSnapshot, 'remote' | 'debugPort' | 'cmd' | 'type' | 'name'>,
): string {
  const verdict = canAttachDebugger(svc);
  if (!verdict.ok) return verdict.reason!;
  if (typeof svc.debugPort === 'number') return `inspector on :${svc.debugPort}`;
  return svc.cmd ?? svc.type;
}
