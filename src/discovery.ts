/** Discovery: figure out which devup project we should talk to and resolve
 *  its control-plane socket path.
 *
 *  Resolution order:
 *  1. `devup.socketPath` setting → use as-is.
 *  2. `devup.projectName` setting → ~/.devup/sock-<sanitised>.sock.
 *  3. Auto-detect: read `devup.config.{json,ts,js}` from the workspace root,
 *     extract `name`, build the socket path.
 *
 *  Auto-detect is best-effort — for .ts/.js we use a regex to find the name
 *  literal (no module loading), which is good enough for the common case
 *  (`defineConfig({ name: 'X', ... })`). Users with exotic configs can set
 *  `devup.projectName` or `devup.socketPath` directly. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import * as vscode from 'vscode';

const SAFE = /[^a-zA-Z0-9._-]+/g;
export function sanitize(name: string): string {
  return name.replace(SAFE, '_').replace(/^_+|_+$/g, '') || 'devup';
}

export function defaultSocketPath(projectName: string): string {
  return join(homedir(), '.devup', `sock-${sanitize(projectName)}.sock`);
}

export interface DiscoveryResult {
  /** Path to the unix socket we should connect to (whether it exists or not). */
  socketPath: string;
  /** The project name we resolved (for display). */
  projectName: string;
  /** How we figured it out — useful for error messages. */
  source: 'socketPath setting' | 'projectName setting' | 'config file' | 'fallback';
}

/** Discover the socket path for the current workspace. Returns null if there's
 *  no workspace folder open at all. */
export function discover(folder: vscode.WorkspaceFolder): DiscoveryResult | null {
  const cfg = vscode.workspace.getConfiguration('devup', folder);

  const overrideSocket = cfg.get<string>('socketPath')?.trim();
  if (overrideSocket) {
    return { socketPath: overrideSocket, projectName: '(socket override)', source: 'socketPath setting' };
  }

  const overrideName = cfg.get<string>('projectName')?.trim();
  if (overrideName) {
    return { socketPath: defaultSocketPath(overrideName), projectName: overrideName, source: 'projectName setting' };
  }

  const detected = readNameFromConfig(folder.uri.fsPath);
  if (detected) {
    return { socketPath: defaultSocketPath(detected), projectName: detected, source: 'config file' };
  }

  // Fallback: workspace folder name. Won't match any running daemon unless the
  // user happens to name their project the same as the folder, but at least we
  // produce a sensible socket path for the "not running" branch.
  const fallback = folder.name;
  return { socketPath: defaultSocketPath(fallback), projectName: fallback, source: 'fallback' };
}

function readNameFromConfig(workspacePath: string): string | null {
  const jsonPath = join(workspacePath, 'devup.config.json');
  if (existsSync(jsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'));
      if (typeof parsed?.name === 'string' && parsed.name.trim()) return parsed.name.trim();
    } catch { /* fall through to .ts/.js */ }
  }
  for (const variant of ['devup.config.ts', 'devup.config.js', 'devup.config.mjs']) {
    const p = join(workspacePath, variant);
    if (!existsSync(p)) continue;
    try {
      const src = readFileSync(p, 'utf8');
      // Regex match `name: 'X'` or `name: "X"` (most common: inside defineConfig({ ... })).
      const m = /\bname\s*:\s*['"`]([^'"`]+)['"`]/.exec(src);
      if (m && m[1]) return m[1];
    } catch { /* try the next variant */ }
  }
  return null;
}
