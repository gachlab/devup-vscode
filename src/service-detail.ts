import * as vscode from 'vscode';
import { openStream, type Subscription, type StreamFrame } from './socket-client.js';
import type { StatusStore, ServiceSnapshot } from './status-store.js';

/** One webview panel per service. Re-opens focus an existing panel instead
 *  of creating a duplicate. Each panel subscribes to logs.follow for its
 *  service and pushes log lines to the webview via postMessage. */
export class ServiceDetailPanels implements vscode.Disposable {
  private readonly panels = new Map<string, vscode.WebviewPanel>();
  private readonly subs = new Map<string, Subscription>();
  private readonly storeSub: vscode.Disposable;

  constructor(
    private readonly store: StatusStore,
    private readonly socketPath: string,
  ) {
    // When the store changes, push fresh service data to every open panel.
    this.storeSub = store.onDidChange(() => {
      for (const [name, panel] of this.panels) {
        const svc = store.getAll().find(s => s.name === name);
        if (svc) void panel.webview.postMessage({ type: 'svc', svc });
      }
    });
  }

  open(svcName: string): void {
    const existing = this.panels.get(svcName);
    if (existing) {
      existing.reveal(vscode.ViewColumn.Beside, true);
      return;
    }

    const svc = this.store.getAll().find(s => s.name === svcName);
    if (!svc) {
      void vscode.window.showWarningMessage(`devup: service "${svcName}" not found.`);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      `devup.service.${svcName}`,
      `devup: ${svcName}`,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true },
    );
    panel.webview.html = renderHtml(svc);

    // Handle incoming messages from the webview (button clicks).
    panel.webview.onDidReceiveMessage((msg: { type: string; payload?: unknown }) => {
      switch (msg.type) {
        case 'restart':       void vscode.commands.executeCommand('devup.restart', svcName); break;
        case 'stop':          void vscode.commands.executeCommand('devup.stop', svcName); break;
        case 'tailLogs':      void vscode.commands.executeCommand('devup.tailLogs', svcName); break;
        case 'openInBrowser': void vscode.commands.executeCommand('devup.openInBrowser', svcName); break;
      }
    });

    // Wire log streaming → webview.
    const sub = openStream(
      this.socketPath, 'logs.follow', { svc: svcName, tail: 30 },
      (frame: StreamFrame) => {
        if (frame.event === 'log' && typeof frame.data === 'string') {
          void panel.webview.postMessage({ type: 'log', line: frame.data });
        }
      },
      err => void panel.webview.postMessage({ type: 'log', line: `[devup] log stream error: ${err.message}` }),
    );
    this.subs.set(svcName, sub);

    panel.onDidDispose(() => {
      this.subs.get(svcName)?.close();
      this.subs.delete(svcName);
      this.panels.delete(svcName);
    });

    this.panels.set(svcName, panel);

    // Push current service state immediately so the panel doesn't sit empty.
    void panel.webview.postMessage({ type: 'svc', svc });
  }

  dispose(): void {
    this.storeSub.dispose();
    for (const sub of this.subs.values()) sub.close();
    this.subs.clear();
    for (const p of this.panels.values()) p.dispose();
    this.panels.clear();
  }
}

function renderHtml(svc: ServiceSnapshot): string {
  // Initial server-rendered HTML; live updates come via postMessage.
  const nonce = randomNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px; margin: 0; }
  h1 { margin: 0 0 4px; font-size: 1.4em; font-weight: 600; }
  .sub { color: var(--vscode-descriptionForeground); margin-bottom: 16px; font-size: 0.9em; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.8em; font-weight: 600; margin-right: 6px; }
  .badge.up      { background: var(--vscode-testing-iconPassed); color: white; }
  .badge.down    { background: var(--vscode-testing-iconFailed); color: white; }
  .badge.wait    { background: var(--vscode-testing-iconQueued); color: white; }
  .badge.idle    { background: var(--vscode-descriptionForeground); color: white; }
  .badge.crashed { background: var(--vscode-errorForeground); color: white; }
  .grid { display: grid; grid-template-columns: 100px 1fr; gap: 4px 12px; margin: 16px 0; font-size: 0.92em; }
  .grid dt { color: var(--vscode-descriptionForeground); }
  .grid dd { margin: 0; }
  .actions { display: flex; gap: 6px; flex-wrap: wrap; margin: 16px 0; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px; padding: 4px 12px; font-size: 0.9em; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
  hr { border: none; border-top: 1px solid var(--vscode-panel-border); margin: 20px 0; }
  h2 { font-size: 1em; font-weight: 600; margin: 0 0 8px; color: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: 0.05em; }
  #logs { background: var(--vscode-textCodeBlock-background, var(--vscode-editor-background)); border: 1px solid var(--vscode-panel-border); border-radius: 3px; padding: 8px 10px; height: 320px; overflow-y: auto; font-family: var(--vscode-editor-font-family); font-size: 0.85em; white-space: pre-wrap; word-break: break-all; }
</style>
</head>
<body>
  <h1 id="name">${escapeHtml(svc.name)}</h1>
  <div class="sub">${escapeHtml(svc.type)} · :${svc.port}</div>

  <div id="status-row">
    <span class="badge ${cssClass(svc.status)}" id="status-badge">${escapeHtml(svc.status)}</span>
    <span class="badge ${cssClass(svc.health)}" id="health-badge">${escapeHtml(svc.health)}</span>
  </div>

  <dl class="grid">
    <dt>Port</dt><dd id="port">${svc.port}</dd>
    <dt>Type</dt><dd id="type">${escapeHtml(svc.type)}</dd>
    <dt>PID</dt><dd id="pid">${svc.pid ?? '—'}</dd>
    <dt>Errors</dt><dd id="errors">${svc.errors}</dd>
    <dt>Restarts</dt><dd id="restarts">${svc.restarts}</dd>
  </dl>

  <div class="actions">
    <button id="btn-restart">Restart</button>
    <button id="btn-stop" class="secondary">Stop</button>
    <button id="btn-tail" class="secondary">Tail logs</button>
    ${svc.type === 'web' ? '<button id="btn-open" class="secondary">Open in browser</button>' : ''}
  </div>

  <hr>
  <h2>Recent logs</h2>
  <div id="logs"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('btn-restart').addEventListener('click', () => vscode.postMessage({ type: 'restart' }));
    document.getElementById('btn-stop').addEventListener('click',    () => vscode.postMessage({ type: 'stop' }));
    document.getElementById('btn-tail').addEventListener('click',    () => vscode.postMessage({ type: 'tailLogs' }));
    const openBtn = document.getElementById('btn-open');
    if (openBtn) openBtn.addEventListener('click', () => vscode.postMessage({ type: 'openInBrowser' }));

    const logsEl = document.getElementById('logs');
    const statusBadge = document.getElementById('status-badge');
    const healthBadge = document.getElementById('health-badge');

    function setBadgeClass(el, value) {
      el.classList.remove('up', 'down', 'wait', 'idle', 'crashed');
      el.classList.add(value);
      el.textContent = value;
    }

    window.addEventListener('message', e => {
      const m = e.data;
      if (m.type === 'log') {
        const wasAtBottom = logsEl.scrollTop + logsEl.clientHeight >= logsEl.scrollHeight - 4;
        const line = document.createElement('div');
        line.textContent = m.line;
        logsEl.appendChild(line);
        // Cap at 500 lines so the panel stays snappy.
        while (logsEl.childElementCount > 500) logsEl.removeChild(logsEl.firstChild);
        if (wasAtBottom) logsEl.scrollTop = logsEl.scrollHeight;
      } else if (m.type === 'svc') {
        const s = m.svc;
        setBadgeClass(statusBadge, s.status);
        setBadgeClass(healthBadge, s.health);
        document.getElementById('pid').textContent      = s.pid ?? '—';
        document.getElementById('errors').textContent   = s.errors;
        document.getElementById('restarts').textContent = s.restarts;
      }
    });
  </script>
</body>
</html>`;
}

function cssClass(v: string): string {
  return ['up', 'down', 'wait', 'idle', 'crashed'].includes(v) ? v : 'idle';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

function randomNonce(): string {
  let out = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
