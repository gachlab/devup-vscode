import type { ServiceSnapshot } from './types.js';

export interface GroupNode {
  kind: 'group';
  label: string;
  services: ServiceSnapshot[];
}

export function buildPhaseGroups(services: ServiceSnapshot[]): GroupNode[] {
  const byPhase = new Map<number, ServiceSnapshot[]>();
  for (const svc of services) {
    const ph = svc.phase ?? 0;
    if (!byPhase.has(ph)) byPhase.set(ph, []);
    byPhase.get(ph)!.push(svc);
  }
  return [...byPhase.keys()].sort((a, b) => a - b).map(ph => ({
    kind: 'group' as const,
    label: `phase ${ph}`,
    services: byPhase.get(ph)!.slice().sort((a, b) => a.name.localeCompare(b.name)),
  }));
}
