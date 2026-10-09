import { describe, it, expect, vi } from 'vitest';
import { createTestHarness, parseToolResult } from '@chrischall/mcp-utils/test';
import { registerHealthcheckTools } from '../src/tools/healthcheck.js';
import type { ResolvedAuth } from '../src/auth.js';
import { CanvasClient } from '../src/client.js';

interface Result {
  ok: boolean;
  credential: { source: string | null; resolved: boolean; detail?: Record<string, unknown> };
  error?: { kind: string; message: string };
}

type State = { resolved: ResolvedAuth | null; configError: Error | null; client?: CanvasClient | null };

async function call(state: State) {
  const h = await createTestHarness((server) =>
    registerHealthcheckTools(server, { client: null, ...state }));
  const names = (await h.listTools()).map((t) => t.name);
  const res = await h.client.callTool({ name: 'canvas_healthcheck', arguments: {} });
  await h.close?.();
  return { result: parseToolResult<Result>(res as never), names };
}

describe('canvas_healthcheck', () => {
  // The point of the tool: the deferred-config pattern registers ZERO tools
  // when auth fails and explains itself only on stderr, which a hosted
  // connector never sees. Without this, "no tools" and "broken" look identical.
  it('exists even when auth is unconfigured, and says why', async () => {
    const { result, names } = await call({
      resolved: null,
      configError: new Error('Canvas auth: no CANVAS_TOKEN, CANVAS_CLIENT_*/CANVAS_REFRESH_TOKEN, or CANVAS_USERNAME/CANVAS_PASSWORD set'),
    });
    expect(names).toContain('canvas_healthcheck');
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('no_credential');
    expect(result.error?.message).toMatch(/CANVAS_TOKEN/);
  });

  // The `??` fallback: `index.ts` always sets configError when resolution
  // fails, so this is defensive — but a healthcheck that threw `undefined`
  // would report nothing at all, which is the one outcome it must never have.
  it('still answers when unconfigured with no stored error', async () => {
    const { result } = await call({ resolved: null, configError: null });
    expect(result.ok).toBe(false);
    expect(result.error?.kind).toBe('no_credential');
    expect(result.error?.message).toMatch(/not configured/i);
  });

  it('reports which auth path resolved', async () => {
    const { result } = await call({
      resolved: {
        source: 'env',
        account: { baseUrl: 'https://school.instructure.com', mode: 'token', name: 'x' },
        refresh: undefined,
      } as unknown as ResolvedAuth,
      configError: null,
    });
    // The probe will fail (no network), but the credential block is what this
    // asserts: the source and base URL the real client would use.
    expect(result.credential).toMatchObject({ source: 'env', resolved: true });
    expect(result.credential.detail).toMatchObject({ base_url: 'https://school.instructure.com' });
  });

  it('never reports a token', async () => {
    const { result } = await call({
      resolved: {
        source: 'env',
        account: { baseUrl: 'https://school.instructure.com', mode: 'token', name: 'x', token: 'SECRET_TOKEN_VALUE_1234567890' },
        refresh: undefined,
      } as unknown as ResolvedAuth,
      configError: null,
    });
    expect(JSON.stringify(result)).not.toContain('SECRET_TOKEN_VALUE_1234567890');
  });

  // fleet-audit#377: the probe used to build a fresh CanvasClient (and session
  // manager) per call, so with the session cache off every healthcheck did a
  // full form login or browser lift. It must probe through the shared client.
  it('probes through the shared client instead of building a new one per call', async () => {
    const account = { baseUrl: 'https://school.instructure.com', mode: 'token', name: 'x', token: 't' } as const;
    const client = new CanvasClient(account);
    const request = vi.spyOn(client, 'request').mockResolvedValue({ id: 1 } as never);
    const state = {
      resolved: { source: 'env', account, refresh: undefined } as unknown as ResolvedAuth,
      configError: null,
      client,
    };
    const first = await call(state);
    const second = await call(state);
    expect(first.result.ok).toBe(true);
    expect(second.result.ok).toBe(true);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith('/api/v1/users/self/profile');
  });
});
