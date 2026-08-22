/** Reading the project name out of a devup config file — no vscode dependency,
 *  so it can be unit-tested against real files on disk.
 *
 *  The name decides the socket path (`~/.devup/sock-<name>.sock`), so getting
 *  it wrong means the extension talks to nothing and says only "no daemon is
 *  running". A regex for the first `name:` in the file was wrong in a way that
 *  looked right: with `services` declared before `name` — a legal reordering —
 *  it captured the first *service* name (issue #38). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Config file names, in the order they are consulted. JSON first: it parses
 *  exactly, where .ts/.js can only be scanned. */
export const CONFIG_FILES = ['devup.config.json', 'devup.config.ts', 'devup.config.js', 'devup.config.mjs'] as const;

/** The devup config file in `dir`, or null when there is none. */
export function findConfigFile(dir: string): string | null {
  for (const variant of CONFIG_FILES) {
    const p = join(dir, variant);
    if (existsSync(p)) return p;
  }
  return null;
}

/** The project name declared in `dir`'s config file, with the file it came
 *  from. Null when there is no config, or none of them declares a name. */
export function readProjectName(dir: string): { name: string; file: string } | null {
  for (const variant of CONFIG_FILES) {
    const file = join(dir, variant);
    if (!existsSync(file)) continue;
    let src: string;
    try { src = readFileSync(file, 'utf8'); } catch { continue; }
    const name = variant.endsWith('.json') ? parseJsonName(src) : parseProjectName(src);
    if (name) return { name, file };
  }
  return null;
}

function parseJsonName(src: string): string | null {
  try {
    const parsed = JSON.parse(src) as { name?: unknown };
    return typeof parsed?.name === 'string' && parsed.name.trim() ? parsed.name.trim() : null;
  } catch {
    return null;
  }
}

/** The top-level `name` of a .ts/.js config.
 *
 *  Anchored to the config object rather than matched anywhere in the file: we
 *  find the object literal passed to `defineConfig(…)` (or exported directly)
 *  and take the `name` key at its own top level, so a `name` belonging to a
 *  service, a health check or a comment cannot be mistaken for it. Modules are
 *  never loaded — a config file is arbitrary code, and running it to read one
 *  string is not a trade worth making. */
export function parseProjectName(src: string): string | null {
  for (const start of objectStarts(src)) {
    const name = topLevelName(src, start);
    if (name) return name;
  }
  return null;
}

/** Offsets of `{` characters that plausibly open the config object, best
 *  candidate first. */
function objectStarts(src: string): number[] {
  const out: number[] = [];
  const anchors = [
    /\bdefineConfig\s*(?:<[^>()]*>)?\s*\(/g,
    /\bexport\s+default\s*/g,
    /\bmodule\s*\.\s*exports\s*=\s*/g,
  ];
  for (const re of anchors) {
    for (const m of src.matchAll(re)) {
      const brace = nextBrace(src, m.index + m[0].length);
      if (brace >= 0) out.push(brace);
    }
  }
  return out;
}

/** Index of the next `{`, skipping whitespace, comments and an intervening
 *  `defineConfig(` — so `export default defineConfig({` is found by both the
 *  `defineConfig` anchor and the `export default` one. Returns -1 if the next
 *  meaningful character is something else. */
function nextBrace(src: string, from: number): number {
  let i = skipTrivia(src, from);
  // `export default defineConfig({…})` — step over the call itself.
  const call = /^[A-Za-z_$][\w$]*\s*(?:<[^>()]*>)?\s*\(/.exec(src.slice(i));
  if (call) i = skipTrivia(src, i + call[0].length);
  return src[i] === '{' ? i : -1;
}

function skipTrivia(src: string, i: number): number {
  for (;;) {
    while (i < src.length && /\s/.test(src[i]!)) i++;
    if (src.startsWith('//', i)) {
      const nl = src.indexOf('\n', i);
      if (nl < 0) return src.length;
      i = nl + 1;
      continue;
    }
    if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) return src.length;
      i = end + 2;
      continue;
    }
    return i;
  }
}

/** Scan the object literal opening at `start` and return the value of its own
 *  top-level `name` key. Strings, template literals and comments are skipped
 *  so their contents cannot be mistaken for structure. */
function topLevelName(src: string, start: number): string | null {
  let depth = 0;
  let i = start;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) { i = skipTrivia(src, i); continue; }
    // Depth 1 is the config object's own body: nested objects (a service, a
    // health check) are 2 or more, so their keys never reach this branch.
    // Tried before the string branch below, since the key may be quoted.
    if (depth === 1 && isKeyStart(src, i)) {
      const m = /^(?:name|['"]name['"])\s*:\s*(['"`])((?:[^\\]|\\.)*?)\1/.exec(src.slice(i));
      if (m) {
        const value = m[2]!.trim();
        if (value) return value;
      }
    }
    if (ch === '"' || ch === "'" || ch === '`') { i = skipString(src, i); continue; }
    if (ch === '{' || ch === '[' || ch === '(') { depth++; i++; continue; }
    if (ch === '}' || ch === ']' || ch === ')') {
      depth--;
      if (depth === 0) return null; // the object closed without a name
      i++;
      continue;
    }
    i++;
  }
  return null;
}

/** True when position `i` starts an identifier, rather than sitting inside
 *  one — `filename: 'x'` must not match on its trailing `name`. */
function isKeyStart(src: string, i: number): boolean {
  if (!/[A-Za-z_$'"]/.test(src[i]!)) return false;
  const prev = src[i - 1];
  return prev === undefined || !/[\w$]/.test(prev);
}

function skipString(src: string, i: number): number {
  const quote = src[i]!;
  i++;
  while (i < src.length) {
    const ch = src[i]!;
    if (ch === '\\') { i += 2; continue; }
    if (ch === quote) return i + 1;
    // A template literal's ${…} can contain anything, including quotes and
    // braces; step over it as a unit.
    if (quote === '`' && ch === '$' && src[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') depth--;
        else if (src[i] === '"' || src[i] === "'" || src[i] === '`') { i = skipString(src, i); continue; }
        i++;
      }
      continue;
    }
    i++;
  }
  return i;
}
