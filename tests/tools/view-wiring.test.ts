import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { CanvasClient } from '../../src/client.js';
import { registerProfileTools } from '../../src/tools/profile.js';
import { registerObserveeTools } from '../../src/tools/observees.js';
import { registerCourseTools } from '../../src/tools/courses.js';
import { registerAssignmentTools } from '../../src/tools/assignments.js';
import { registerSubmissionTools } from '../../src/tools/submissions.js';
import { registerGradeTools } from '../../src/tools/grades.js';
import { registerCalendarTools } from '../../src/tools/calendar.js';
import { registerPlannerTools } from '../../src/tools/planner.js';
import { registerAnnouncementTools } from '../../src/tools/announcements.js';
import { registerConversationTools } from '../../src/tools/conversations.js';
import { registerDiscussionTools } from '../../src/tools/discussions.js';
import { registerFileTools } from '../../src/tools/files.js';

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
const account = { mode: 'token' as const, name: 'cms', baseUrl: 'https://cms.instructure.com', token: 't' };

/**
 * A Canvas user object, in both avatar spellings. Every wired tool's payload
 * embeds one of these somewhere; that is the whole reason it is wired.
 */
const AVATARS = {
  avatar_url: 'https://cms.instructure.com/images/thumbnails/1/MVccGAaJXYRhHy4rIGaKBbKGeht3umUwFgXObNVu',
  author: { id: '8507', display_name: 'Sallie Davis', avatar_image_url: 'https://cms.instructure.com/images/thumbnails/2/abc' },
};
/** Canvas rich-content HTML, under the keys it uses for it. */
const HTML = '<p><span style="color: red;">Read <strong>chapter 4</strong></span></p>';
const MD = 'Read **chapter 4**';
const PAYLOAD = { id: '1', name: 'a thing', ...AVATARS, message: HTML, description: HTML, syllabus_body: HTML, body: HTML };

/**
 * Register every tool this server has, capturing each one's schema and handler.
 *
 * Both Canvas transports return the same fixture, so a tool's rung can be read
 * off its response whichever one it happens to call.
 */
function setupAll() {
  const client = new CanvasClient(account);
  vi.spyOn(client, 'request').mockResolvedValue(PAYLOAD as never);
  vi.spyOn(client, 'requestPaginated').mockResolvedValue([PAYLOAD] as never);
  vi.spyOn(client, 'download').mockResolvedValue({ bytes: 1 } as never);
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const handlers = new Map<string, Handler>();
  const schemas = new Map<string, Record<string, unknown> | undefined>();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, config: unknown, cb: unknown) => {
    const inputSchema = (config as { inputSchema?: z.ZodObject | Record<string, unknown> }).inputSchema;
    schemas.set(name, inputSchema instanceof z.ZodObject ? inputSchema.shape : inputSchema);
    handlers.set(name, cb as Handler);
    return undefined as never;
  });
  for (const register of [
    registerProfileTools, registerObserveeTools, registerCourseTools, registerAssignmentTools,
    registerSubmissionTools, registerGradeTools, registerCalendarTools, registerPlannerTools,
    registerAnnouncementTools, registerConversationTools, registerDiscussionTools, registerFileTools,
  ]) {
    register(server, client);
  }
  return { handlers, schemas };
}

afterEach(() => vi.restoreAllMocks());

/**
 * The tools whose Canvas payload embeds a user object (the only thing Canvas
 * hangs an avatar on) or teacher-written HTML.
 */
const WIRED: Array<[string, Record<string, unknown>]> = [
  ['canvas_get_profile', {}],
  ['canvas_list_observees', {}],
  ['canvas_get_course', { courseId: '1' }],
  ['canvas_get_submission', { courseId: '1', assignmentId: '2' }],
  ['canvas_list_recent_submissions', { courseId: '1' }],
  ['canvas_list_announcements', { contextCodes: ['course_1'] }],
  ['canvas_list_conversations', {}],
  ['canvas_get_conversation', { id: '1' }],
  ['canvas_list_discussion_topics', { courseId: '1' }],
  ['canvas_list_assignments', { courseId: '1' }],
  ['canvas_list_missing_submissions', {}],
  ['canvas_list_calendar_events', {}],
  ['canvas_list_upcoming_events', {}],
];

/**
 * The wired tools whose payload carries Canvas rich-content HTML, which their
 * compact rung reads as Markdown. The conversation tools are wired but NOT
 * here: an inbox message's `body` is plain text, and reading it as HTML would
 * collapse its newlines.
 */
const HTML_READS = [
  'canvas_get_course',
  'canvas_get_submission',
  'canvas_list_recent_submissions',
  'canvas_list_announcements',
  'canvas_list_discussion_topics',
  'canvas_list_assignments',
  'canvas_list_missing_submissions',
  'canvas_list_calendar_events',
  'canvas_list_upcoming_events',
];

/**
 * A different `view`: `full | brief`, not the avatar rung. The planner carries
 * no user object, so compact would change nothing; its `brief` is the
 * one-line-per-item form a context-group intent tool asks for (mcp-host spec
 * 2026-11-03 D6), and `full` — the default — is Canvas's payload verbatim.
 */
const BRIEF = ['canvas_list_planner_items'];

/**
 * Left unwired on purpose, and this list is the assertion.
 *
 * The first two return neither a user object nor teacher-written HTML — a live
 * `canvas_list_courses` over twelve courses carried no media field of any kind
 * — so a `view` there would be a knob that does not turn, which is worse than
 * no knob. The last two are the opposite case: their PRODUCT is the URL, and
 * stripping would empty the response rather than shrink it.
 */
const UNWIRED = [
  'canvas_list_courses',
  'canvas_list_enrollments',
  'canvas_list_course_files',
  'canvas_download_file',
];

describe('which tools take a view', () => {
  it.each(WIRED)('%s advertises view in its schema', (name) => {
    const { schemas } = setupAll();
    expect(schemas.get(name)).toHaveProperty('view');
  });

  it.each(UNWIRED)('%s does not advertise view', (name) => {
    const { schemas } = setupAll();
    expect(schemas.get(name) ?? {}).not.toHaveProperty('view');
  });

  it.each(BRIEF)('%s advertises the full|brief view, not the avatar rung', (name) => {
    const { schemas } = setupAll();
    const view = schemas.get(name)?.view as z.ZodType;
    expect(view.safeParse('brief').success).toBe(true);
    expect(view.safeParse('full').success).toBe(true);
    expect(view.safeParse('compact').success).toBe(false);
  });

  it('accounts for every registered tool, so a tool added later cannot skip this decision', () => {
    const { handlers } = setupAll();
    const named = new Set([...WIRED.map(([n]) => n), ...UNWIRED, ...BRIEF]);
    expect([...handlers.keys()].filter((n) => !named.has(n))).toEqual([]);
  });
});

describe('every wired tool answers compact by default and full on request', () => {
  it.each(WIRED)('%s', async (name, args) => {
    const { handlers } = setupAll();

    const byDefault = JSON.stringify(await handlers.get(name)!(args));
    expect(byDefault).not.toContain('avatar_url');
    expect(byDefault).not.toContain('avatar_image_url');
    // Not emptied — the record itself survives, only the pictures go.
    expect(byDefault).toContain('Sallie Davis');

    const full = JSON.stringify(await handlers.get(name)!({ ...args, view: 'full' }));
    expect(full).toContain('avatar_url');
    expect(full).toContain('avatar_image_url');
  });
});

describe('the HTML reads answer Markdown on compact and Canvas\'s HTML on full', () => {
  it.each(HTML_READS)('%s', async (name) => {
    const { handlers } = setupAll();
    const args = Object.fromEntries(WIRED)[name]!;

    const byDefault = JSON.parse((await handlers.get(name)!(args)).content[0].text);
    const record = Array.isArray(byDefault) ? byDefault[0] : byDefault;
    expect(record).toMatchObject({ message: MD, description: MD, syllabus_body: MD, body: MD });

    const full = JSON.parse((await handlers.get(name)!({ ...args, view: 'full' })).content[0].text);
    expect(Array.isArray(full) ? full[0] : full).toMatchObject({ message: HTML, description: HTML });
  });

  it.each(HTML_READS)('%s says so in its view description', (name) => {
    const { schemas } = setupAll();
    expect((schemas.get(name)?.view as z.ZodType).description).toMatch(/Markdown/);
  });

  it.each(WIRED.map(([n]) => n).filter((n) => !HTML_READS.includes(n)))('%s leaves bodies as Canvas sent them', async (name) => {
    const { handlers } = setupAll();
    const args = Object.fromEntries(WIRED)[name]!;
    expect((await handlers.get(name)!(args)).content[0].text).toContain('<strong>');
  });
});

describe('an unwired tool returns Canvas untouched', () => {
  it('canvas_list_course_files keeps every field, avatars included', async () => {
    // It takes no `view`, so there is no rung on which its `url` could be
    // dropped — which is the point of leaving it out.
    const { handlers } = setupAll();
    const out = JSON.stringify(await handlers.get('canvas_list_course_files')!({ courseId: '1' }));
    expect(out).toContain('avatar_url');
  });
});
