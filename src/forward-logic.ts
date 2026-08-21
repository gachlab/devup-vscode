/** Pure logic for remote port forwarding — no vscode dependency. */

import type { ServiceSnapshot } from './types.js';

export type ForwardMode = 'off' | 'web' | 'all';

/** Normalise the raw setting value; anything unexpected falls back to 'web'. */
export function parseForwardMode(raw: unknown): ForwardMode {
  return raw === 'off' || raw === 'all' ? raw : 'web';
}

/** Ports that should be tunnelled back to the local machine, deduped and sorted.
 *
 *  Uses each service's configured port rather than its lazy-mode override: devup
 *  keeps listening on the configured port and proxies to the override, so that is
 *  the one a browser must reach. */
export function selectForwardPorts(services: readonly ServiceSnapshot[], mode: ForwardMode): number[] {
  if (mode === 'off') return [];
  const wanted = new Set<number>();
  for (const s of services) {
    if (mode === 'web' && s.type !== 'web') continue;
    if (!Number.isInteger(s.port) || s.port <= 0 || s.port > 65535) continue;
    wanted.add(s.port);
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
