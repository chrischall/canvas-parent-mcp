import { describe, it, expect, vi, afterEach } from 'vitest';
import { withCallSignal } from '@chrischall/mcp-utils';
import { requestSignal, REQUEST_TIMEOUT_MS } from '../src/signal.js';

afterEach(() => vi.restoreAllMocks());

describe('requestSignal', () => {
  it('times out after REQUEST_TIMEOUT_MS by default', () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const s = requestSignal();
    expect(timeout).toHaveBeenCalledWith(REQUEST_TIMEOUT_MS);
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(s.aborted).toBe(false);
  });

  it('takes a custom timeout', () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    requestSignal(5);
    expect(timeout).toHaveBeenCalledWith(5);
  });

  it("aborts when the running tool call is cancelled", () => {
    const call = new AbortController();
    const s = withCallSignal(call.signal, () => requestSignal());
    expect(s.aborted).toBe(false);
    call.abort(new Error('cancelled by client'));
    expect(s.aborted).toBe(true);
  });
});
