import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { CanvasClient } from '../../src/client.js';
import { registerPlannerTools, briefLine } from '../../src/tools/planner.js';
import { loadObserveeDirectory, type ObserveeDirectory } from '../../src/tools/observees.js';

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { mode: 'token' as const, name: 'cms', baseUrl: 'https://cms.instructure.com', token: 't' };

function setup(items: unknown[] = [], observees?: ObserveeDirectory | null) {
  const client = new CanvasClient(account);
  const pagSpy = vi.spyOn(client, 'requestPaginated').mockResolvedValue(items as never);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, Handler>();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, _c: unknown, cb: unknown) => {
    handlers.set(name, cb as Handler);
    return undefined as never;
  });
  registerPlannerTools(server, client, observees);
  return { handlers, pagSpy };
}

async function directory(observees: unknown[]): Promise<ObserveeDirectory | null> {
  const client = new CanvasClient(account);
  vi.spyOn(client, 'requestPaginated').mockResolvedValue(observees as never);
  return loadObserveeDirectory(client);
}

async function publishedObserveeId(observees: ObserveeDirectory | null): Promise<Record<string, unknown>> {
  const client = {} as CanvasClient;
  const h = await createTestHarness((server) => registerPlannerTools(server, client, observees));
  const { tools } = await h.client.listTools();
  await h.close?.();
  const schema = tools.find((t) => t.name === 'canvas_list_planner_items')!.inputSchema as {
    properties: Record<string, Record<string, unknown>>;
  };
  return schema.properties.observeeId;
}

afterEach(() => vi.restoreAllMocks());

describe('canvas_list_planner_items', () => {
  it('uses /api/v1/planner/items with no observeeId', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_planner_items')!({});
    expect(pagSpy.mock.calls[0][0]).toBe('/api/v1/planner/items');
  });

  it('uses /api/v1/users/{id}/planner/items when observeeId set', async () => {
    const { handlers, pagSpy } = setup();
    await handlers.get('canvas_list_planner_items')!({
      observeeId: '99', startDate: '2026-01-01', endDate: '2026-01-31',
      contextCodes: ['course_1'], filter: 'new_activity',
    });
    const url = pagSpy.mock.calls[0][0] as string;
    expect(url).toContain('/api/v1/users/99/planner/items');
    expect(url).toContain('start_date=2026-01-01');
    expect(url).toContain('end_date=2026-01-31');
    expect(url).toContain('context_codes%5B%5D=course_1');
    expect(url).toContain('filter=new_activity');
  });

  it('returns the Canvas payload verbatim by default', async () => {
    const items = [{ plannable: { title: 'Essay' }, extra: 1 }];
    const { handlers } = setup(items);
    const result = await handlers.get('canvas_list_planner_items')!({});
    expect(JSON.parse(result.content[0].text)).toEqual(items);
  });
});

describe('observeeId as a label enum', () => {
  it('publishes the observee labels as an enum when the listing succeeded', async () => {
    const dir = await directory([{ id: '101', name: 'Ada Lovelace' }, { id: '102', name: 'Grace Hopper' }]);
    const prop = await publishedObserveeId(dir);
    expect(prop.type).toBe('string');
    expect(prop.enum).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });

  it('keeps the property with no enum keyword when the listing failed', async () => {
    const prop = await publishedObserveeId(null);
    expect(prop.type).toBe('string');
    expect(prop).not.toHaveProperty('enum');
  });

  it('maps a label to the observee id', async () => {
    const dir = await directory([{ id: '101', name: 'Ada Lovelace' }]);
    const { handlers, pagSpy } = setup([], dir);
    await handlers.get('canvas_list_planner_items')!({ observeeId: 'Ada Lovelace' });
    expect(pagSpy.mock.calls[0][0]).toBe('/api/v1/users/101/planner/items');
  });

  it('still accepts the raw id', async () => {
    const dir = await directory([{ id: '101', name: 'Ada Lovelace' }]);
    const { handlers, pagSpy } = setup([], dir);
    await handlers.get('canvas_list_planner_items')!({ observeeId: '101' });
    expect(pagSpy.mock.calls[0][0]).toBe('/api/v1/users/101/planner/items');
  });

  it('refuses an unknown label, naming the known ones, and calls nothing', async () => {
    const dir = await directory([{ id: '101', name: 'Ada Lovelace' }, { id: '102', name: 'Grace Hopper' }]);
    const { handlers, pagSpy } = setup([], dir);
    await expect(handlers.get('canvas_list_planner_items')!({ observeeId: 'Alan' }))
      .rejects.toThrow('Unknown observee "Alan". Known: Ada Lovelace, Grace Hopper.');
    expect(pagSpy).not.toHaveBeenCalled();
  });

  it('passes self, and an id the start-time listing did not have, straight to Canvas', async () => {
    const dir = await directory([{ id: 101, name: 'Ada Lovelace' }]);
    for (const ref of ['self', '4242', 'sis_user_id:abc']) {
      const { handlers, pagSpy } = setup([], dir);
      await handlers.get('canvas_list_planner_items')!({ observeeId: ref });
      expect(pagSpy).toHaveBeenCalledWith(`/api/v1/users/${encodeURIComponent(ref)}/planner/items`);
    }
  });

  it('passes an id through unchanged when no observee list was available', async () => {
    const { handlers, pagSpy } = setup([], null);
    await handlers.get('canvas_list_planner_items')!({ observeeId: 'Ada' });
    expect(pagSpy.mock.calls[0][0]).toBe('/api/v1/users/Ada/planner/items');
  });
});

describe('view: brief', () => {
  const ITEMS = [
    { plannable_type: 'assignment', plannable: { title: 'Essay', due_at: '2026-11-05T23:59:00Z' },
      submissions: { submitted: true, missing: false } },
    { plannable_type: 'quiz', plannable: { title: 'Quiz 3', due_at: '2026-11-06T15:00:00Z' },
      submissions: { submitted: false, missing: false } },
    { plannable_type: 'assignment', plannable: { title: 'Lab report', due_at: '2026-11-01T23:59:00Z' },
      submissions: { submitted: false, missing: true } },
    { plannable_type: 'planner_note', plannable: { title: 'Bring cones' }, plannable_date: '2026-11-07T00:00:00Z',
      submissions: false },
    { plannable_type: 'wiki_page', plannable: { title: 'Reading' }, submissions: false },
  ];

  it('returns one line per item: title — due <date> — <status>', async () => {
    const { handlers } = setup(ITEMS);
    const result = await handlers.get('canvas_list_planner_items')!({ view: 'brief' });
    expect(result.content[0].text.split('\n')).toEqual([
      'Essay — due 2026-11-05T23:59:00Z — submitted',
      'Quiz 3 — due 2026-11-06T15:00:00Z — not submitted',
      'Lab report — due 2026-11-01T23:59:00Z — missing',
      'Bring cones — due 2026-11-07T00:00:00Z',
      'Reading — due no date',
    ]);
  });

  it('answers an empty planner with an empty text', async () => {
    const { handlers } = setup([]);
    const result = await handlers.get('canvas_list_planner_items')!({ view: 'brief' });
    expect(result.content[0].text).toBe('');
  });

  it('view: full is the default payload', async () => {
    const { handlers } = setup(ITEMS);
    const result = await handlers.get('canvas_list_planner_items')!({ view: 'full' });
    expect(JSON.parse(result.content[0].text)).toEqual(ITEMS);
  });

  it('keeps a line within 120 characters by shortening the title', () => {
    const line = briefLine({ plannable: { title: 'x'.repeat(200), due_at: '2026-11-05T23:59:00Z' },
      submissions: { submitted: false, missing: true } });
    expect(line.length).toBeLessThanOrEqual(120);
    expect(line).toMatch(/^x+… — due 2026-11-05T23:59:00Z — missing$/);
  });

  it('survives an item with no plannable at all', () => {
    expect(briefLine({ title: 'Loose' })).toBe('Loose — due no date');
    expect(briefLine(null)).toBe('(untitled) — due no date');
  });
});
