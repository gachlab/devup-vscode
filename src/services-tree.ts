import * as vscode from 'vscode';
import type { StatusStore, ServiceSnapshot } from './status-store.js';
import { buildServiceUrl, describeProxy, formatCpu, formatMem, proxyRouteFor } from './url-builder.js';
import type { PortForwarder } from './port-forward.js';
import { buildPhaseGroups } from './tree-logic.js';
import { canonicalPort } from './forward-logic.js';
export { buildPhaseGroups };

type Node =
  | { kind: 'group'; label: string; services: ServiceSnapshot[] }
  | { kind: 'service'; svc: ServiceSnapshot }
  | { kind: 'proxy'; label: string }
  | { kind: 'empty'; message: string };

/** Tree-view provider for the `devup` view container. Supports three grouping
 *  modes (type / phase / none) and optional profile filtering. Backed by the
 *  StatusStore so updates arrive live via `status.follow`, no polling. */
export class ServicesTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly storeSub: vscode.Disposable;
  private readonly configSub: vscode.Disposable;

  private readonly forwardSub: vscode.Disposable | null;

  constructor(private readonly store: StatusStore, private readonly forwarder?: PortForwarder) {
    this.storeSub = store.onDidChange(() => this._onDidChangeTreeData.fire());
    this.forwardSub = forwarder?.onDidChangeForwarded(() => this._onDidChangeTreeData.fire()) ?? null;
    this.configSub = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('devup.treeView.groupBy') || e.affectsConfiguration('devup.profile')) {
        this._onDidChangeTreeData.fire();
      }
    });
  }

  getChildren(parent?: Node): Node[] {
    if (!parent) {
      if (this.store.getState() !== 'connected') return [];
      const cfg = vscode.workspace.getConfiguration('devup');
      const groupBy = cfg.get<string>('treeView.groupBy', 'type');
      const activeProfile = cfg.get<string>('profile', '').trim();

      let services = this.store.getAll();
      if (activeProfile) {
        const profileServices = this.store.getInfo().profiles[activeProfile] ?? [];
        services = services.filter(s => profileServices.includes(s.name));
      }
      // The proxy is in the store already and was never shown, though with it
      // on, a service is reachable at <sub>.<domain> and the tree still says
      // `:3002` (issue #44).
      const proxyLabel = describeProxy(this.store.getProxy());
      const header: Node[] = proxyLabel ? [{ kind: 'proxy', label: proxyLabel }] : [];

      if (!services.length) return [...header, { kind: 'empty', message: 'No services registered' }];

      if (groupBy === 'none') {
        return [...header, ...services.slice().sort(byName).map(svc => ({ kind: 'service' as const, svc }))];
      }
      if (groupBy === 'phase') {
        return [...header, ...buildPhaseGroups(services)];
      }
      // default: 'type'
      const apis = services.filter(s => s.type === 'api').sort(byName);
      const webs = services.filter(s => s.type === 'web').sort(byName);
      const groups: Node[] = [...header];
      if (apis.length) groups.push({ kind: 'group', label: 'APIs', services: apis });
      if (webs.length) groups.push({ kind: 'group', label: 'Webs', services: webs });
      return groups;
    }
    if (parent.kind === 'group') {
      return parent.services.map(svc => ({ kind: 'service', svc }));
    }
    return [];
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind === 'proxy') {
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('globe');
      item.contextValue = 'proxy';
      item.tooltip = 'devup reverse proxy. Services with a route are reachable at their subdomain; the rest only on their port.';
      return item;
    }
    if (node.kind === 'empty') {
      const item = new vscode.TreeItem(node.message, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('info');
      return item;
    }
    if (node.kind === 'group') {
      const item = new vscode.TreeItem(
        `${node.label} (${node.services.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = groupIcon(node.label);
      item.contextValue = 'group';
      return item;
    }
    return serviceItem(node.svc, this.store, this.forwarder);
  }

  dispose(): void {
    this.storeSub.dispose();
    this.forwardSub?.dispose();
    this.configSub.dispose();
    this._onDidChangeTreeData.dispose();
  }
}


function groupIcon(label: string): vscode.ThemeIcon {
  if (label === 'APIs') return new vscode.ThemeIcon('server');
  if (label === 'Webs') return new vscode.ThemeIcon('browser');
  return new vscode.ThemeIcon('layers');
}

function byName(a: ServiceSnapshot, b: ServiceSnapshot): number {
  return a.name.localeCompare(b.name);
}

function serviceItem(svc: ServiceSnapshot, store: StatusStore, forwarder?: PortForwarder): vscode.TreeItem {
  const item = new vscode.TreeItem(svc.name, vscode.TreeItemCollapsibleState.None);
  const stats = store.getServiceStats(svc.name);
  const statsStr = stats ? `  · ${formatCpu(stats.cpu)} · ${formatMem(stats.memMB)}` : '';
  // Plain text: TreeItem.description is documented as "a human-readable
  // string", and codicon substitution is only defined for status-bar and
  // language-status text — `$(radio-tower)` would render literally here.
  const forwarded = forwarder?.isForwarded(canonicalPort(svc))
    ? (forwarder.isPaused() ? '  · forwarding paused' : '  · forwarded')
    : '';
  const debugging = typeof svc.debugPort === 'number' ? `  · debug :${svc.debugPort}` : '';
  item.description = `:${canonicalPort(svc)}  ${svc.status}/${svc.health}${statsStr}${forwarded}${debugging}`;
  item.iconPath = stats ? resourceIcon(svc, stats) : healthIcon(svc);
  // A prefix rather than a suffix, so the menu clauses can anchor on it
  // without a lookahead — and so every existing unanchored `/service-/` clause
  // keeps matching a service that happens to be under the inspector.
  item.contextValue = `${debugging ? 'debug-' : ''}service-${svc.type}`;
  item.command = { command: 'devup.tailLogs', title: 'Tail logs', arguments: [svc.name] };
  item.tooltip = buildTooltip(svc, stats, store, !!forwarded);
  return item;
}

function resourceIcon(svc: ServiceSnapshot, stats: import('./status-store.js').ServiceStats): vscode.ThemeIcon {
  const cfg = vscode.workspace.getConfiguration('devup.stats');
  const cpuWarn = cfg.get<number>('cpuWarnThreshold', 80);
  const memWarn = cfg.get<number>('memWarnThresholdMB', 500);
  const cpuHigh = cfg.get<number>('cpuHighThreshold', 95);
  const memHigh = cfg.get<number>('memHighThresholdMB', 1024);

  if (stats.cpu >= cpuHigh || stats.memMB >= memHigh) {
    return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.red'));
  }
  if (stats.cpu >= cpuWarn || stats.memMB >= memWarn) {
    return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
  }
  return healthIcon(svc);
}

function healthIcon(svc: ServiceSnapshot): vscode.ThemeIcon {
  if (svc.status === 'crashed') return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
  if (svc.status === 'idle')    return new vscode.ThemeIcon('circle-outline');
  if (svc.health === 'up')      return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
  if (svc.health === 'wait')    return new vscode.ThemeIcon('sync~spin');
  return new vscode.ThemeIcon('circle-large-outline');
}

function buildTooltip(
  svc: ServiceSnapshot,
  stats: import('./status-store.js').ServiceStats | null,
  store: StatusStore,
  forwarded: boolean,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${svc.name}**\n\n`);
  md.appendMarkdown(`- port: ${canonicalPort(svc)}\n`);
  // Surface the lazy rewrite rather than hiding it: useful when attaching a
  // debugger or reading logs, where the service's own port is what shows up.
  if (canonicalPort(svc) !== svc.port) md.appendMarkdown(`- internal port: ${svc.port}\n`);
  md.appendMarkdown(`- type: ${svc.type} · phase: ${svc.phase}\n`);
  md.appendMarkdown(`- status: ${svc.status} · health: ${svc.health}\n`);
  if (stats) md.appendMarkdown(`- cpu: ${formatCpu(stats.cpu)} · mem: ${formatMem(stats.memMB)}\n`);
  if (typeof svc.debugPort === 'number') {
    md.appendMarkdown(`- inspector: 127.0.0.1:${svc.debugPort} — the port changes on every restart\n`);
  }
  if (svc.pid != null) md.appendMarkdown(`- pid: ${svc.pid}\n`);
  if (svc.errors)    md.appendMarkdown(`- errors: ${svc.errors}\n`);
  // Both, when they disagree. `restarts` is the auto-restart *budget* and a
  // manual restart resets it, so a service showing "restarts: 0" can have
  // crashed a dozen times — which is the number someone reading this actually
  // wants. `crashes` arrives from @gachlab/devup 0.16.0.
  if (svc.restarts)  md.appendMarkdown(`- restarts: ${svc.restarts}\n`);
  if (svc.crashes)   md.appendMarkdown(`- crashes: ${svc.crashes} since the daemon started\n`);
  // "crashed" alone reads as dead. Saying a retry is queued is the difference
  // between closing the editor and waiting eight seconds.
  if (svc.restartPendingIn != null) {
    md.appendMarkdown(`- restarting in ${Math.max(1, Math.round(svc.restartPendingIn / 1000))}s\n`);
  }
  const proxy = store.getProxy();
  if (proxy?.active) {
    const route = proxyRouteFor(svc.name, proxy);
    // "no route" is worth saying: without it, a service the proxy does not
    // know about looks exactly like one it does.
    md.appendMarkdown(route ? `- proxy route: ${route}\n` : '- proxy route: none — reachable on its port only\n');
  }
  if (forwarded) {
    md.appendMarkdown('- port forwarding requested — the Ports view has the address\n');
  }
  md.appendMarkdown(`- url: ${buildServiceUrl(svc.name, canonicalPort(svc), proxy)}\n`);
  if (svc.crashLog?.length) {
    md.appendMarkdown(`\n**Last crash:**\n\`\`\`\n${svc.crashLog.slice(-5).join('\n')}\n\`\`\``);
  }
  return md;
}
