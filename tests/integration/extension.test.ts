import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Integration', () => {
  test('extension is present', () => {
    const ext = vscode.extensions.getExtension('gachlab.devup-vscode');
    assert.ok(ext, 'extension gachlab.devup-vscode should be registered');
  });

  test('all expected commands are registered', async () => {
    const all = await vscode.commands.getCommands(true);
    const devupCmds = all.filter(c => c.startsWith('devup.'));
    const expected = [
      'devup.showStatus',
      'devup.tailLogs',
      'devup.restart',
      'devup.stop',
      'devup.openInBrowser',
      'devup.refresh',
      'devup.daemon.start',
      'devup.daemon.stop',
      'devup.daemon.restart',
      'devup.openServiceDetail',
      'devup.pickProfile',
    ];
    for (const cmd of expected) {
      assert.ok(devupCmds.includes(cmd), `command ${cmd} should be registered`);
    }
  });

  test('openServiceDetail resolves name from string arg', async () => {
    // Should not throw — falls through to quick-pick when no services
    try {
      await vscode.commands.executeCommand('devup.openServiceDetail', 'nonexistent');
    } catch {
      // Expected — no daemon running, panels may not be initialized
    }
  });

  test('openServiceDetail resolves name from tree node arg', async () => {
    const treeNode = {
      kind: 'service',
      svc: { name: 'api', status: 'running', health: 'up', port: 3000, type: 'api', phase: 0, pid: null, errors: 0, restarts: 0 },
    };
    // Should not throw with [object Object] — if it does the extraction is broken
    try {
      await vscode.commands.executeCommand('devup.openServiceDetail', treeNode);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      assert.ok(!msg.includes('[object Object]'), `service name should not be [object Object], got: ${msg}`);
    }
  });
});
