import * as vscode from 'vscode';
import { openStream, type Subscription, type StreamFrame } from './socket-client.js';

/** One VS Code OutputChannel per devup service, fed by `logs.follow` over the
 *  control plane. Channels are created lazily on first request and reused
 *  thereafter; subscriptions are tied to channel lifetime so closing a tab
 *  in the Output panel doesn't leak the socket. */
export class LogChannels implements vscode.Disposable {
  private readonly channels = new Map<string, vscode.OutputChannel>();
  private readonly subs = new Map<string, Subscription>();

  constructor(private readonly socketPath: string) {}

  /** Open (or focus) the channel for `svcName` and ensure a live subscription
   *  is attached. Safe to call repeatedly — no-op if already streaming. */
  tail(svcName: string): void {
    let channel = this.channels.get(svcName);
    if (!channel) {
      channel = vscode.window.createOutputChannel(`devup: ${svcName}`);
      this.channels.set(svcName, channel);
    }
    channel.show(true); // preserve focus on the editor

    if (this.subs.has(svcName)) return;

    const sub = openStream(
      this.socketPath, 'logs.follow', { svc: svcName, tail: 200 },
      (frame: StreamFrame) => {
        if (frame.event === 'log' && typeof frame.data === 'string') {
          channel!.appendLine(frame.data);
        }
      },
      err => {
        channel!.appendLine(`[devup] log stream error: ${err.message}`);
        this.subs.delete(svcName);
      },
      () => {
        channel!.appendLine('[devup] log stream closed');
        this.subs.delete(svcName);
      },
    );
    this.subs.set(svcName, sub);
  }

  /** Stop streaming and drop the channel for a single service. */
  closeOne(svcName: string): void {
    this.subs.get(svcName)?.close();
    this.subs.delete(svcName);
    this.channels.get(svcName)?.dispose();
    this.channels.delete(svcName);
  }

  dispose(): void {
    for (const sub of this.subs.values()) sub.close();
    this.subs.clear();
    for (const ch of this.channels.values()) ch.dispose();
    this.channels.clear();
  }
}
