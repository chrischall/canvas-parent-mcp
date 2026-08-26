// Suite-wide guard: no test may touch the developer's real session cache.
//
// `createSessionCache` resolves its path from MCP_DATA_DIR/HOME, so any test
// building a session- or oauth-mode Account would read and write
// ~/.canvas-parent-mcp/session.json — non-hermetic, order-dependent, and able to
// leave a real file behind. That is not hypothetical: it happened here, and in
// ofw-mcp, before this guard existed.
//
// Two independent guards, deliberately belt-and-braces:
//   1. The cache is OFF by default, so the ordinary suite never constructs one.
//   2. The path is pinned into a temp dir anyway, so a test that turns the cache
//      ON to exercise it still cannot reach $HOME.
import { beforeEach, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CACHE_DIR = mkdtempSync(join(tmpdir(), 'canvas-test-cache-'));

beforeEach(() => {
  process.env.CANVAS_SESSION_CACHE = 'false';
  process.env.CANVAS_SESSION_FILE = join(CACHE_DIR, 'session.json');
});

afterAll(() => {
  rmSync(CACHE_DIR, { recursive: true, force: true });
});
