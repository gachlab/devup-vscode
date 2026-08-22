/** Discovery: figure out which devup project we should talk to and resolve
 *  its control-plane socket path.
 *
 *  Resolution order:
 *  1. `devup.socketPath` setting → use as-is.
 *  2. `devup.projectName` setting → ~/.devup/sock-<sanitised>.sock.
 *  3. Auto-detect: read the project name out of `devup.config.{json,ts,js,mjs}`
 *     in the chosen workspace folder.
 *  4. Fall back to the folder name, which will almost never match a running
 *     daemon — `diagnose()` says so rather than leaving the user guessing.
 *
 *  Nothing here loads the config as a module: a config file is arbitrary code,
 *  and running it to read one string is not a trade worth making. See
 *  `config-file.ts` for how the name is found instead. */
import * as vscode from 'vscode';
import { findConfigFile, readProjectName } from './config-file.js';
import { defaultSocketPath } from './socket-path.js';

export { defaultSocketPath, sanitize } from './socket-path.js';

export interface DiscoveryResult {
  /** Path to the unix socket we should connect to (whether it exists or not). */
  socketPath: string;
  /** The project name we resolved (for display). */
  projectName: string;
  /** How we figured it out — useful for error messages. */
  source: 'socketPath setting' | 'projectName setting' | 'config file' | 'fallback';
  /** The workspace folder discovery looked in. */
  folder: vscode.WorkspaceFolder;
  /** The config file found in that folder, or null when there is none. */
  configFile: string | null;
}

/** The workspace folder to talk about.
 *
 *  `workspaceFolders[0]` was not good enough: the activation event
 *  (`workspaceContains:devup.config.ts`) fires on a match in *any* folder, so
 *  in a multi-root workspace with devup in the second one the extension woke
 *  up and then looked in the first. Prefer a folder that actually has a
 *  config; fall back to the first so the welcome view still has something to
 *  report. */
export function pickFolder(folders: readonly vscode.WorkspaceFolder[]): vscode.WorkspaceFolder | null {
  for (const folder of folders) {
    if (findConfigFile(folder.uri.fsPath)) return folder;
  }
  return folders[0] ?? null;
}

/** Discover the socket path for the given folder. */
export function discover(folder: vscode.WorkspaceFolder): DiscoveryResult {
  const cfg = vscode.workspace.getConfiguration('devup', folder);
  const configFile = findConfigFile(folder.uri.fsPath);
  const base = { folder, configFile };

  const overrideSocket = cfg.get<string>('socketPath')?.trim();
  if (overrideSocket) {
    return { ...base, socketPath: overrideSocket, projectName: '(socket override)', source: 'socketPath setting' };
  }

  const overrideName = cfg.get<string>('projectName')?.trim();
  if (overrideName) {
    return { ...base, socketPath: defaultSocketPath(overrideName), projectName: overrideName, source: 'projectName setting' };
  }

  const detected = readProjectName(folder.uri.fsPath);
  if (detected) {
    return { ...base, configFile: detected.file, socketPath: defaultSocketPath(detected.name), projectName: detected.name, source: 'config file' };
  }

  // Fallback: workspace folder name. Won't match any running daemon unless the
  // user happens to name their project the same as the folder, so the welcome
  // view says as much instead of reporting a generic "not running".
  return { ...base, socketPath: defaultSocketPath(folder.name), projectName: folder.name, source: 'fallback' };
}

/** Discovery for the current workspace, or null when no folder is open. */
export function discoverWorkspace(): DiscoveryResult | null {
  const folder = pickFolder(vscode.workspace.workspaceFolders ?? []);
  return folder ? discover(folder) : null;
}
