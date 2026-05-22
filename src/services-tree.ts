import * as vscode from 'vscode';
import type { StatusStore, ServiceSnapshot } from './status-store.js';

type Node =
  | { kind: 'group'; label: string; services: ServiceSnapshot[] }
  | { kind: 'service'; svc: ServiceSnapshot }
  | { kind: 'empty'; message: string };

/** Tree-view provider for the `devup` view container. Supports three grouping
 *  modes (type / phase / none) and optional profile filtering. Backed by the
 *  StatusStore so updates arrive live via `status.follow`, no polling. */
export class ServicesTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private readonly storeSub: vscode.Disposable;
  private readonly configSub: vscode.Disposable;

  constructor(private readonly store: StatusStore) {
    this.storeSub = store.onDidChange(() => this._onDidChangeTreeData.fire());
    this.configSub = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('devup.treeView.groupBy') || e.affectsConfiguration('devup.profile')) {
        this._onDidChangeTreeData.fire();
      }
    });
  }

  getTreeItem(node: Node): vscode.TreeItem {
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
    return serviceItem(node.svc);
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
      if (!services.length) return [{ kind: 'empty', message: 'No services registered' }];

      if (groupBy === 'none') {
        return services.slice().sort(byName).map(svc => ({ kind: 'service', svc }));
      }
      if (groupBy === 'phase') {
        return buildPhaseGroups(services);
      }
      // default: 'type'
      const apis = services.filter(s => s.type === 'api').sort(byName);
      const webs = services.filter(s => s.type === 'web').sort(byName);
      const groups: Node[] = [];
      if (apis.length) groups.push({ kind: 'group', label: 'APIs', services: apis });
      if (webs.length) groups.push({ kind: 'group', label: 'Webs', services: webs });
      return groups;
    }
    if (parent.kind === 'group') {
      return parent.services.map(svc => ({ kind: 'service', svc }));
    }
    return [];
  }

  dispose(): void {
    this.storeSub.dispose();
    this.configSub.dispose();
    this._onDidChangeTreeData.dispose();
  }
}

function buildPhaseGroups(services: ServiceSnapshot[]): Node[] {
  const byPhase = new Map<number, ServiceSnapshot[]>();
  for (const svc of services) {
    const ph = svc.phase ?? 0;
    if (!byPhase.has(ph)) byPhase.set(ph, []);
    byPhase.get(ph)!.push(svc);
  }
  return [...byPhase.keys()].sort((a, b) => a - b).map(ph => ({
    kind: 'group' as const,
    label: `phase ${ph}`,
    services: byPhase.get(ph)!.sort(byName),
  }));
}

function groupIcon(label: string): vscode.ThemeIcon {
  if (label === 'APIs') return new vscode.ThemeIcon('server');
  if (label === 'Webs') return new vscode.ThemeIcon('browser');
  return new vscode.ThemeIcon('layers');
}

function byName(a: ServiceSnapshot, b: ServiceSnapshot): number {
  return a.name.localeCompare(b.name);
}

function serviceItem(svc: ServiceSnapshot): vscode.TreeItem {
  const item = new vscode.TreeItem(svc.name, vscode.TreeItemCollapsibleState.None);
  item.description = `:${svc.port}  ${svc.status}/${svc.health}`;
  item.iconPath = healthIcon(svc);
  item.contextValue = `service-${svc.type}`; // 'service-api' / 'service-web' → menu filter
  // Default click → tail logs for this service.
  item.command = {
    command: 'devup.tailLogs',
    title: 'Tail logs',
    arguments: [svc.name],
  };
  item.tooltip = buildTooltip(svc);
  return item;
}

function healthIcon(svc: ServiceSnapshot): vscode.ThemeIcon {
  if (svc.status === 'crashed') return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
  if (svc.status === 'idle')    return new vscode.ThemeIcon('circle-outline');
  if (svc.health === 'up')      return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
  if (svc.health === 'wait')    return new vscode.ThemeIcon('sync~spin');
  return new vscode.ThemeIcon('circle-large-outline');
}

function buildTooltip(svc: ServiceSnapshot): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${svc.name}**\n\n`);
  md.appendMarkdown(`- port: ${svc.port}\n`);
  md.appendMarkdown(`- type: ${svc.type}\n`);
  md.appendMarkdown(`- status: ${svc.status} · health: ${svc.health}\n`);
  if (svc.pid != null) md.appendMarkdown(`- pid: ${svc.pid}\n`);
  if (svc.errors)    md.appendMarkdown(`- errors: ${svc.errors}\n`);
  if (svc.restarts)  md.appendMarkdown(`- restarts: ${svc.restarts}\n`);
  return md;
}
