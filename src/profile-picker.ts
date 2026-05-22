import * as vscode from 'vscode';
import type { StatusStore } from './status-store.js';

/** Status-bar item that shows the active profile and opens a QuickPick to
 *  change it. Profile list is read from the daemon via the `info` RPC. */
export class ProfilePicker implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private readonly storeSub: vscode.Disposable;
  private readonly configSub: vscode.Disposable;

  constructor(private readonly store: StatusStore, context: vscode.ExtensionContext) {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
    this.item.command = 'devup.pickProfile';
    this.item.tooltip = 'devup: select active profile';

    this.storeSub = store.onDidChange(() => this.refresh());
    this.configSub = vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('devup.profile')) this.refresh();
    });

    context.subscriptions.push(
      vscode.commands.registerCommand('devup.pickProfile', () => this.pick()),
    );

    this.refresh();
  }

  private refresh(): void {
    const profiles = this.store.getInfo().profiles;
    const hasProfiles = Object.keys(profiles).length > 0;
    const connected = this.store.getState() === 'connected';

    if (!connected || !hasProfiles) {
      this.item.hide();
      return;
    }

    const active = vscode.workspace.getConfiguration('devup').get<string>('profile', '').trim();
    this.item.text = `$(layers) profile: ${active || 'all'}`;
    this.item.show();
  }

  private async pick(): Promise<void> {
    const profiles = this.store.getInfo().profiles;
    const profileNames = Object.keys(profiles);
    if (!profileNames.length) return;

    const active = vscode.workspace.getConfiguration('devup').get<string>('profile', '').trim();
    const items: vscode.QuickPickItem[] = [
      { label: 'all', description: 'Show all services', picked: !active },
      ...profileNames.map(name => ({
        label: name,
        description: profiles[name]!.join(', '),
        picked: name === active,
      })),
    ];

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a profile to filter the service tree',
    });
    if (!picked) return;

    const newProfile = picked.label === 'all' ? '' : picked.label;
    await vscode.workspace.getConfiguration('devup').update('profile', newProfile, vscode.ConfigurationTarget.Workspace);
  }

  dispose(): void {
    this.storeSub.dispose();
    this.configSub.dispose();
    this.item.dispose();
  }
}
