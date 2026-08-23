/** Pure logic for remote port forwarding — no vscode dependency. */

import type { ServiceSnapshot } from './types.js';

export type ForwardMode = 'off' | 'web' | 'all';

/** Normalise the raw setting value; anything unexpected falls back to 'all'. */
export function parseForwardMode(raw: unknown): ForwardMode {
  return raw === 'off' || raw === 'web' ? raw : 'all';
}

/** The port a client must actually reach.
 *
 *  The status snapshot reports a lazy service's *rewritten* port: devup replaces
 *  `port` with `port + 10000`, runs the service there, and keeps its on-demand
 *  proxy on the configured port. Reaching the rewritten one goes straight to the
 *  service, bypassing the proxy that starts it, and is not the port anything is
 *  configured to call.
 *
 *  `originalPort` (@gachlab/devup >= 0.12.0) is the configured port, and equals
 *  `port` for always-on services. Undoing the offset ourselves is NOT a viable
 *  fallback: lazy mode is opt-in, so in a non-lazy stack every reported port is
 *  already real and a service configured on 18080 would be mangled into 8080.
 *  Only the daemon knows which services it rewrote, so an older daemon simply
 *  gets the old behaviour. */
export function canonicalPort(svc: Pick<ServiceSnapshot, 'port' | 'originalPort'>): number {
  const { originalPort, port } = svc;
  return isUsablePort(originalPort) ? originalPort : port;
}

function isUsablePort(port: unknown): port is number {
  return Number.isInteger(port) && (port as number) > 0 && (port as number) <= 65535;
}

/** Ports that should be tunnelled back to the local machine, deduped and sorted. */
export function selectForwardPorts(services: readonly ServiceSnapshot[], mode: ForwardMode): number[] {
  if (mode === 'off') return [];
  const wanted = new Set<number>();
  for (const s of services) {
    if (mode === 'web' && s.type !== 'web') continue;
    // Validate what we are about to forward, not what the snapshot happened to
    // carry: canonicalPort may return originalPort, which needs checking too.
    const port = canonicalPort(s);
    if (!isUsablePort(port)) continue;
    wanted.add(port);
  }
  return [...wanted].sort((a, b) => a - b);
}

/** True when the user told the editor to leave this port alone, via a
 *  `remote.portsAttributes` entry with `onAutoForward: "ignore"`.
 *
 *  Exact port keys and `low-high` ranges are honoured. Regex keys are not:
 *  they match a process command line, which an explicitly requested tunnel
 *  does not have. */
export function isPortIgnored(port: number, attributes: unknown): boolean {
  if (!attributes || typeof attributes !== 'object') return false;
  for (const [key, value] of Object.entries(attributes as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    if ((value as Record<string, unknown>)['onAutoForward'] !== 'ignore') continue;
    if (matchesPortKey(key, port)) return true;
  }
  return false;
}

function matchesPortKey(key: string, port: number): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) === port;
  const range = /^(\d+)\s*-\s*(\d+)$/.exec(trimmed);
  if (!range) return false;
  return port >= Number(range[1]) && port <= Number(range[2]);
}

/** What a change in the daemon's connection state means for forwarding.
 *
 *  Extracted because the version of this living inside `PortForwarder` got the
 *  distinction between a *level* and a *transition* wrong: it resumed whenever
 *  the state *was* connected, and the store fires every few seconds, so a
 *  pause requested while the daemon was up survived about three seconds before
 *  every port the user had just closed was re-asserted. */
export type ForwardReaction = 'resume' | 'warn' | 'none';

export interface ForwardReactionInput {
  previous: string | null;
  next: string;
  /** Forwarding was paused by `devup: Close forwarded ports…`. */
  paused: boolean;
  /** The user asked for this restart, so the drop is expected. */
  restartExpected: boolean;
  /** Only a remote window has tunnels at all. */
  remote: boolean;
  /** Whether anything was ever forwarded to warn about. */
  hasRequested: boolean;
}

export function reactToState(input: ForwardReactionInput): ForwardReaction {
  const { previous, next } = input;
  // A transition into connected, not the fact of being connected.
  if (next === 'connected') return previous !== 'connected' && input.paused ? 'resume' : 'none';
  if (previous !== 'connected') return 'none';
  // `unreachable` specifically: a retarget passes through `connecting`, and a
  // start or restart the user asked for is not news.
  if (next !== 'unreachable' || input.restartExpected) return 'none';
  return input.remote && input.hasRequested ? 'warn' : 'none';
}

/** What the editor actually did with a forwarded port, when it is not what we
 *  asked for — or null when the address works as the app expects.
 *
 *  `asExternalUri` returns the resolved uri and `PortForwarder` drops it on
 *  purpose: the docs warn that a resolved uri goes stale the moment the user
 *  closes the tunnel, so caching one is a bug. Reading it once on the way past
 *  is not caching — and it carries the one thing worth knowing, which is
 *  whether the port survived.
 *
 *  It matters because an app that hardcodes `http://localhost:3000` — the
 *  normal shape of a frontend calling its API — reaches nothing when the
 *  editor had to bind 3001 instead, and nothing on screen explains why. */
export function describeRemap(requestedPort: number, resolved: { authority: string; scheme: string }): string | null {
  const [host, portText] = splitAuthority(resolved.authority);
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  const port = Number(portText);

  if (isLocal && (!portText || port === requestedPort)) return null;
  if (isLocal) {
    return `is reachable at localhost:${port}, not localhost:${requestedPort}`;
  }
  // Codespaces and Remote Tunnels publish to a hosted address instead of
  // binding a local port at all.
  return `is published at ${resolved.scheme}://${resolved.authority}, not on a local port`;
}

function splitAuthority(authority: string): [string, string] {
  // IPv6 authorities are `[::1]:3000`.
  const match = /^(\[[^\]]*\]|[^:]*)(?::(\d+))?$/.exec(authority);
  return [match?.[1] ?? authority, match?.[2] ?? ''];
}
