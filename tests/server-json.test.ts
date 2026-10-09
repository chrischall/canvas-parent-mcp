// Invariant: every CANVAS_* env var the server reads is declared in
// server.json's environmentVariables — the MCP-registry manifest hosts and
// mcp-host read to learn which knobs a registration may set. CANVAS_OUTPUT_DIR
// shipped documented everywhere but here (fleet-audit#990).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Read but deliberately undocumented: the OAuth access-token seed is internal. */
const INTERNAL = new Set(['CANVAS_ACCESS_TOKEN']);

function srcFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? srcFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

describe('server.json', () => {
  it('declares every CANVAS_* env var the server reads', () => {
    const read = new Set<string>();
    for (const f of srcFiles(join(ROOT, 'src'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/'(CANVAS_[A-Z_]+)'/g)) read.add(m[1]);
    }
    const manifest = JSON.parse(readFileSync(join(ROOT, 'server.json'), 'utf8')) as {
      packages: { environmentVariables: { name: string }[] }[];
    };
    const declared = new Set(manifest.packages[0].environmentVariables.map((v) => v.name));
    const missing = [...read].filter((n) => !INTERNAL.has(n) && !declared.has(n)).sort();
    expect(missing).toEqual([]);
  });
});
