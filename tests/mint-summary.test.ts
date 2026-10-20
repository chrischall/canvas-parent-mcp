// Invariant: mint.yaml's catalog `summary` fits the mcp-host 200-char limit and
// describes sign-in truthfully.
//
// Why this exists: the summary twice claimed that password sign-in "needs a
// browser". It does not — src/session-login.ts signs in over plain HTTP (GET
// /login/canvas, scrape authenticity_token, POST the credentials, keep the
// cookies). Only the fetchproxy / browser-bridge fallback needs a browser. It
// also referenced hosting tiers, which mcp-host retired on 2026-09-11.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const yaml = readFileSync(join(ROOT, 'mint.yaml'), 'utf8');

// `summary: >-` folded block: the indented lines that follow, joined by spaces.
function readSummary(src: string): string {
  const m = /^summary: >-\n((?:[ ]{2,}.*\n)+)/m.exec(src);
  if (!m) throw new Error('mint.yaml has no `summary: >-` block');
  return m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' ');
}

describe('mint.yaml summary', () => {
  const summary = readSummary(yaml);

  it('fits the 200-character catalog limit', () => {
    expect(summary.length).toBeGreaterThan(0);
    expect(summary.length).toBeLessThanOrEqual(200);
  });

  it('does not say password sign-in needs a browser', () => {
    expect(summary).not.toMatch(/password[^.;]*need[s]? a (signed-in )?browser/i);
  });

  it('attributes the browser requirement to the bridge fallback only', () => {
    expect(summary).toMatch(/bridge[^.;]*needs? a signed-in browser/i);
  });

  it('does not mention retired hosting tiers', () => {
    expect(summary).not.toMatch(/\btiers?\b/i);
  });
});
