import * as vscode from 'vscode';
import type { DiscoveryResult } from './discovery.js';
import type { StatusStore } from './status-store.js';

/** Aggregate status bar item — derives its content from the StatusStore.
 *  No longer polls; updates live as `status.follow` frames flow in. */
export class DevupStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly storeSub: vscode.Disposable;

  constructor(private readonly discovery: DiscoveryResult, private readonly store: StatusStore) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = 'devup.tailLogs';
    this.item.text = 'devup: connecting…';
    this.item.tooltip = `devup project: ${discovery.projectName} (${discovery.source})\nClick: tail logs for a service`;
    this.item.show();

    this.storeSub = store.onDidChange(() => this.render());
    this.render();
  }

  private render(): void {
    const state = this.store.getState();
    if (state !== 'connected') {
      this.item.text = '$(circle-slash) devup: not running';
      this.item.tooltip = `devup project: ${this.discovery.projectName}\nSocket: ${this.discovery.socketPath}\n${state === 'connecting' ? 'Connecting…' : 'Daemon is not reachable.'}\n\nStart it with: devup up -d`;
      this.item.backgroundColor = undefined;
      return;
    }
    const services = this.store.getAll();
    const total = services.length;
    const up = services.filter(s => s.health === 'up').length;
    const anyCrashed = services.some(s => s.status === 'crashed');
    const anyStarting = services.some(s => s.status === 'starting' || s.health === 'wait');

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
    this.item.tooltip = `devup project: ${this.discovery.projectName}\nSocket: ${this.discovery.socketPath}\n${up} of ${total} services healthy\n\nClick: tail logs for a service`;
  }

  dispose(): void {
    this.storeSub.dispose();
    this.item.dispose();
  }
}
