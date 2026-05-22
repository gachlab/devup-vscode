import * as vscode from 'vscode';
import type { StatusStore, ServiceSnapshot } from './status-store.js';
import { formatCpu, formatMem } from './url-builder.js';
import { buildPhaseGroups } from './tree-logic.js';
export { buildPhaseGroups };

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
    return serviceItem(node.svc, this.store);
  }

  dispose(): void {
    this.storeSub.dispose();
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

function serviceItem(svc: ServiceSnapshot, store: StatusStore): vscode.TreeItem {
  const item = new vscode.TreeItem(svc.name, vscode.TreeItemCollapsibleState.None);
  const stats = store.getServiceStats(svc.name);
  const statsStr = stats ? `  · ${formatCpu(stats.cpu)} · ${formatMem(stats.memMB)}` : '';
  item.description = `:${svc.port}  ${svc.status}/${svc.health}${statsStr}`;
  item.iconPath = stats ? resourceIcon(svc, stats) : healthIcon(svc);
  item.contextValue = `service-${svc.type}`;
  item.command = { command: 'devup.tailLogs', title: 'Tail logs', arguments: [svc.name] };
  item.tooltip = buildTooltip(svc, stats);
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

function buildTooltip(svc: ServiceSnapshot, stats: import('./status-store.js').ServiceStats | null): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.appendMarkdown(`**${svc.name}**\n\n`);
  md.appendMarkdown(`- port: ${svc.port}\n`);
  md.appendMarkdown(`- type: ${svc.type} · phase: ${svc.phase}\n`);
  md.appendMarkdown(`- status: ${svc.status} · health: ${svc.health}\n`);
  if (stats) md.appendMarkdown(`- cpu: ${formatCpu(stats.cpu)} · mem: ${formatMem(stats.memMB)}\n`);
  if (svc.pid != null) md.appendMarkdown(`- pid: ${svc.pid}\n`);
  if (svc.errors)    md.appendMarkdown(`- errors: ${svc.errors}\n`);
  if (svc.restarts)  md.appendMarkdown(`- restarts: ${svc.restarts}\n`);
  if (svc.crashLog?.length) {
    md.appendMarkdown(`\n**Last crash:**\n\`\`\`\n${svc.crashLog.slice(-5).join('\n')}\n\`\`\``);
  }
  return md;
}
