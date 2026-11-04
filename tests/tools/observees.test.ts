import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { CanvasClient } from '../../src/client.js';
import { registerObserveeTools, loadObserveeDirectory } from '../../src/tools/observees.js';

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { mode: 'token' as const, name: 'cms', baseUrl: 'https://cms.instructure.com', token: 't' };

function setup(returnValue: unknown[]) {
  const client = new CanvasClient(account);
  vi.spyOn(client, 'requestPaginated').mockResolvedValue(returnValue as never);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, Handler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as Handler);
    return undefined as never;
  });
  registerObserveeTools(server, client);
  return { client, handlers };
}

afterEach(() => vi.restoreAllMocks());

describe('canvas_list_observees', () => {
  it('calls /api/v1/users/self/observees and returns the array', async () => {
    const observees = [{ id: 1, name: 'Kid A' }];
    const { client, handlers } = setup(observees);
    const result = await handlers.get('canvas_list_observees')!({});
    expect(client.requestPaginated).toHaveBeenCalledWith(expect.stringContaining('/api/v1/users/self/observees'));
    expect(JSON.parse(result.content[0].text)).toEqual(observees);
  });

  it('returns [] when there are no observees', async () => {
    const { handlers } = setup([]);
    const result = await handlers.get('canvas_list_observees')!({});
    expect(JSON.parse(result.content[0].text)).toEqual([]);
  });
});

describe('loadObserveeDirectory', () => {
  function clientReturning(impl: () => Promise<unknown>) {
    const client = new CanvasClient(account);
    const spy = vi.spyOn(client, 'requestPaginated').mockImplementation(impl as never);
    return { client, spy };
  }

  it('lists the observees once and labels each by display name', async () => {
    const { client, spy } = clientReturning(async () => [
      { id: '101', name: 'Ada Lovelace', short_name: 'Ada' },
      { id: '102', name: 'Grace Hopper' },
    ]);
    const dir = await loadObserveeDirectory(client);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('/api/v1/users/self/observees');
    expect(dir?.labels).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });

  it('falls back to short_name, then the id, when Canvas sends no name', async () => {
    const { client } = clientReturning(async () => [{ id: '7', short_name: 'Bo' }, { id: '8' }]);
    expect((await loadObserveeDirectory(client))?.labels).toEqual(['Bo', '8']);
  });

  it('disambiguates two observees with one name by their ids', async () => {
    const { client } = clientReturning(async () => [{ id: '1', name: 'Sam' }, { id: '2', name: 'Sam' }]);
    const dir = await loadObserveeDirectory(client);
    expect(dir?.labels).toEqual(['Sam (1)', 'Sam (2)']);
    expect(dir?.resolve('sam (2)')).toBe('2');
  });

  it('resolves a label (any case) or an id to the id, and refuses anything else naming the known labels', async () => {
    const { client } = clientReturning(async () => [{ id: 101, name: 'Ada Lovelace' }]);
    const dir = (await loadObserveeDirectory(client))!;
    expect(dir.resolve('Ada Lovelace')).toBe('101');
    expect(dir.resolve('  ada lovelace ')).toBe('101');
    expect(dir.resolve('101')).toBe('101');
    expect(() => dir.resolve('Adda')).toThrow(/Unknown observee "Adda"\. Known: Ada Lovelace\./);
  });

  it('passes a Canvas user reference it does not know through unchanged: self, an id linked after start, a sis_user_id: id', async () => {
    const { client } = clientReturning(async () => [{ id: 101, name: 'Ada Lovelace' }]);
    const dir = (await loadObserveeDirectory(client))!;
    expect(dir.resolve('self')).toBe('self');
    expect(dir.resolve(' 4242 ')).toBe('4242');
    expect(dir.resolve('sis_user_id:abc-1')).toBe('sis_user_id:abc-1');
    expect(dir.resolve('lti_user_id:7f3')).toBe('lti_user_id:7f3');
  });

  it('answers null when the account observes nobody (an empty enum is invalid JSON Schema)', async () => {
    const { client } = clientReturning(async () => []);
    expect(await loadObserveeDirectory(client)).toBeNull();
  });

  it('answers null when the listing fails', async () => {
    const { client } = clientReturning(async () => { throw new Error('Canvas 401'); });
    expect(await loadObserveeDirectory(client)).toBeNull();
  });

  it('answers null when the listing is not an array of users', async () => {
    const { client } = clientReturning(async () => [null, { name: 'no id' }]);
    expect(await loadObserveeDirectory(client)).toBeNull();
    const { client: bare } = clientReturning(async () => ({ id: '1', name: 'not a list' }));
    expect(await loadObserveeDirectory(bare)).toBeNull();
  });

  it('answers null at the deadline rather than holding the server start', async () => {
    vi.useFakeTimers();
    try {
      const { client } = clientReturning(() => new Promise(() => {}));
      const pending = loadObserveeDirectory(client, 50);
      await vi.advanceTimersByTimeAsync(50);
      expect(await pending).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
