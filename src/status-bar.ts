import * as vscode from 'vscode';
import { sendRpc, RpcCallError } from './socket-client.js';
import type { DiscoveryResult } from './discovery.js';

interface ServiceSnapshot {
  name: string;
  status: string;
  health: string;
}
interface StatusResponse {
  services: ServiceSnapshot[];
}

type Aggregate =
  | { kind: 'unreachable'; reason: string }
  | { kind: 'ok'; up: number; total: number; anyCrashed: boolean; anyStarting: boolean };

/** Aggregate status into a single bar item. Polls every `pollIntervalMs` (config). */
export class DevupStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly discovery: DiscoveryResult) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'devup.tailLogs';
    this.item.text = 'devup: connecting…';
    this.item.tooltip = `devup project: ${discovery.projectName} (${discovery.source})\n\nClick: tail logs for a service`;
    this.item.show();
  }

  start(): void {
    void this.refresh();
    const intervalMs = vscode.workspace.getConfiguration('devup').get<number>('pollIntervalMs') ?? 3000;
    this.timer = setInterval(() => void this.refresh(), Math.max(500, intervalMs));
  }

  async refresh(): Promise<Aggregate> {
    const agg = await this.fetch();
    this.render(agg);
    return agg;
  }

  private async fetch(): Promise<Aggregate> {
    try {
      const result = (await sendRpc(this.discovery.socketPath, 'status', {}, { timeoutMs: 2000 })) as StatusResponse;
      const services = result?.services ?? [];
      const up = services.filter(s => s.health === 'up').length;
      const anyCrashed = services.some(s => s.status === 'crashed');
      const anyStarting = services.some(s => s.status === 'starting' || s.health === 'wait');
      return { kind: 'ok', up, total: services.length, anyCrashed, anyStarting };
    } catch (e) {
      const reason = e instanceof RpcCallError ? e.message : String(e);
      return { kind: 'unreachable', reason };
    }
  }

  private render(agg: Aggregate): void {
    if (agg.kind === 'unreachable') {
      this.item.text = '$(circle-slash) devup: not running';
      this.item.tooltip = `devup project: ${this.discovery.projectName}\nSocket: ${this.discovery.socketPath}\n${agg.reason}\n\nStart it with: devup up -d`;
      this.item.backgroundColor = undefined;
      return;
    }
    const { up, total, anyCrashed, anyStarting } = agg;
    if (anyCrashed) {
      this.item.text = `$(error) devup: ${up}/${total} up`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (anyStarting) {
      this.item.text = `$(sync~spin) devup: ${up}/${total} up`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.item.text = `$(check) devup: ${up}/${total} up`;
      this.item.backgroundColor = undefined;
    }
    this.item.tooltip = `devup project: ${this.discovery.projectName}\nSocket: ${this.discovery.socketPath}\n${up} of ${total} services healthy`;
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.item.dispose();
  }
}
