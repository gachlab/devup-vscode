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
