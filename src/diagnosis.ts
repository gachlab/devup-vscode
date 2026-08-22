/** Why the daemon cannot be reached — no vscode dependency, so it can be
 *  unit-tested.
 *
 *  "No devup daemon is running for this project" covered four different
 *  situations, three of which need a different action from the user, and the
 *  extension already knew which one it was in: `DiscoveryResult` carries the
 *  project name, the socket path and how the path was decided (issue #46). */
/** Values double as the `devup.diagnosis` context key, which is what the
 *  welcome view branches on — hence camelCase rather than hyphens, which a
 *  `when` clause would read as subtraction. Keeping the view's four cases and
 *  this function's four cases the same value means they cannot drift. */
export type Diagnosis =
  | 'connected'
  /** No devup.config.* anywhere in the workspace — nothing to resolve. */
  | 'noConfig'
  /** A config exists but no name came out of it, so the socket path is a guess
   *  from the folder name and will almost never match a running daemon. */
  | 'guessedName'
  /** The path is right as far as we can tell, and nothing is listening. */
  | 'socketMissing'
  /** The socket file is there and the daemon did not answer — wedged, still
   *  starting, or left behind by a crash. */
  | 'noAnswer';

export interface DiagnosisInput {
  connected: boolean;
  /** The config file the name was read from, null when there is none. */
  configFile: string | null;
  /** How the socket path was decided. */
  source: 'socketPath setting' | 'projectName setting' | 'config file' | 'fallback';
  socketExists: boolean;
}

export function diagnose(input: DiagnosisInput): Diagnosis {
  if (input.connected) return 'connected';
  // An explicit setting is the user's own answer to "which daemon?" — a
  // missing config file is not a problem in that case, and saying so would
  // send them to fix something they deliberately bypassed.
  const overridden = input.source === 'socketPath setting' || input.source === 'projectName setting';
  if (!overridden) {
    if (!input.configFile) return 'noConfig';
    if (input.source === 'fallback') return 'guessedName';
  }
  return input.socketExists ? 'noAnswer' : 'socketMissing';
}

export interface DiagnosisDetail {
  projectName: string;
  socketPath: string;
  source: DiagnosisInput['source'];
  configFile: string | null;
  socketExists: boolean;
}

/** The text behind "Show connection details" — everything the extension used
 *  to keep to itself. */
export function describeDiagnosis(d: Diagnosis, detail: DiagnosisDetail): string {
  const lines = [
    `Project name: ${detail.projectName || '(none)'} — ${sourceLabel(detail.source)}`,
    `Socket: ${detail.socketPath}`,
    `         ${detail.socketExists ? 'exists' : 'not found'}`,
    `Config file: ${detail.configFile ?? 'none found in this workspace'}`,
    '',
    EXPLANATION[d],
  ];
  return lines.join('\n');
}

const EXPLANATION: Record<Diagnosis, string> = {
  connected: 'The daemon is connected.',
  noConfig: 'No devup.config.{ts,js,mjs,json} was found, so there is no project name to resolve a socket from. Open a folder that has one, or set devup.socketPath.',
  guessedName: 'The project name could not be read from the config file, so it fell back to the workspace folder name. That will only match a daemon by coincidence — set devup.projectName to the name in your config.',
  socketMissing: 'Nothing is listening at that path, which is what it looks like when the daemon is not running. Start it with devup up -d.',
  noAnswer: 'The socket file exists but the daemon did not answer. It may still be starting, may be wedged, or the file may be left over from a crash — restarting the daemon clears all three.',
};

function sourceLabel(source: DiagnosisInput['source']): string {
  switch (source) {
    case 'socketPath setting':  return 'from the devup.socketPath setting';
    case 'projectName setting': return 'from the devup.projectName setting';
    case 'config file':         return 'read from the config file';
    case 'fallback':            return 'guessed from the workspace folder name';
  }
}
