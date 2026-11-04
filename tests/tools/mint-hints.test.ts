import { describe, it, expect, vi, afterEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/server';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import type { CanvasClient } from '../../src/client.js';
import { registerHealthcheckTools } from '../../src/tools/healthcheck.js';
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

/**
 * Context-group hints (`_meta.mint`, mcp-host spec 2026-11-03 D4), read off the
 * config each registrar hands `registerTool` — the place the hints are
 * authored — and, separately, off `tools/list`, which is what a host sees.
 */
const REGISTRARS = [
  registerProfileTools, registerObserveeTools, registerCourseTools, registerAssignmentTools,
  registerSubmissionTools, registerGradeTools, registerCalendarTools, registerPlannerTools,
  registerAnnouncementTools, registerConversationTools, registerDiscussionTools, registerFileTools,
];

const DOMAINS = ['school', 'home', 'work', 'family', 'health', 'money', 'travel', 'food'];
const INTENTS = ['whats-new', 'whats-due', 'whats-on', 'lookup', 'turn-on-off', 'send', 'change', 'other'];
const KEYS = ['domain', 'intent', 'canonical', 'subject', 'when', 'aliases'];

function registeredConfigs(): Map<string, { _meta?: Record<string, unknown>; inputSchema?: unknown }> {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  const configs = new Map<string, { _meta?: Record<string, unknown>; inputSchema?: unknown }>();
  vi.spyOn(server, 'registerTool').mockImplementation((name: string, config: unknown) => {
    configs.set(name, config as { _meta?: Record<string, unknown> });
    return undefined as never;
  });
  const client = {} as CanvasClient;
  for (const register of REGISTRARS) register(server, client);
  return configs;
}

afterEach(() => vi.restoreAllMocks());

/** The intent every tool declares — this table is the assertion. */
const EXPECTED_INTENT: Record<string, string> = {
  canvas_get_profile: 'lookup',
  canvas_list_observees: 'lookup',
  canvas_list_courses: 'lookup',
  canvas_get_course: 'lookup',
  canvas_list_assignments: 'lookup',
  canvas_list_missing_submissions: 'whats-due',
  canvas_get_submission: 'lookup',
  canvas_list_recent_submissions: 'lookup',
  canvas_list_enrollments: 'lookup',
  canvas_list_calendar_events: 'whats-on',
  canvas_list_upcoming_events: 'whats-on',
  canvas_list_planner_items: 'whats-due',
  canvas_list_announcements: 'whats-new',
  canvas_list_conversations: 'lookup',
  canvas_get_conversation: 'lookup',
  canvas_list_discussion_topics: 'lookup',
  canvas_list_course_files: 'lookup',
  canvas_download_file: 'other',
};

describe('_meta.mint on every registered tool', () => {
  it('names every tool registerTool was handed, so a new tool cannot skip the decision', () => {
    expect([...registeredConfigs().keys()].sort()).toEqual(Object.keys(EXPECTED_INTENT).sort());
  });

  it.each(Object.entries(EXPECTED_INTENT))('%s declares domain school and intent %s', (name, intent) => {
    const mint = registeredConfigs().get(name)?._meta?.mint as Record<string, unknown>;
    expect(mint).toBeDefined();
    expect(mint.domain).toBe('school');
    expect(mint.intent).toBe(intent);
  });

  it('every hint is shaped per the host contract', () => {
    for (const [name, config] of registeredConfigs()) {
      const mint = config._meta?.mint as Record<string, unknown>;
      expect(Object.keys(mint).filter((k) => !KEYS.includes(k)), name).toEqual([]);
      expect(DOMAINS, name).toContain(mint.domain);
      expect(INTENTS, name).toContain(mint.intent);
      if ('canonical' in mint) expect(mint.canonical, name).toBe(true);
      if ('subject' in mint) expect(typeof mint.subject, name).toBe('string');
      if ('when' in mint) {
        const when = mint.when as Record<string, unknown>;
        expect(Object.keys(when).sort(), name).toEqual(['end', 'start']);
        expect(typeof when.start, name).toBe('string');
        expect(typeof when.end, name).toBe('string');
      }
      if ('aliases' in mint) {
        const aliases = mint.aliases as string[];
        expect(aliases.length, name).toBeLessThanOrEqual(8);
        for (const a of aliases) {
          expect(a.length, name).toBeLessThanOrEqual(40);
          expect(a, name).toBe(a.toLowerCase());
        }
      }
    }
  });

  it('marks exactly two tools canonical: the planner for whats-due, announcements for whats-new', () => {
    const canonical = [...registeredConfigs()]
      .filter(([, c]) => (c._meta?.mint as Record<string, unknown>).canonical === true)
      .map(([n, c]) => [n, (c._meta?.mint as Record<string, unknown>).intent]);
    expect(canonical.sort()).toEqual([
      ['canvas_list_announcements', 'whats-new'],
      ['canvas_list_planner_items', 'whats-due'],
    ]);
  });

  it('the planner names its subject and range arguments, and they exist in its schema', () => {
    const config = registeredConfigs().get('canvas_list_planner_items')!;
    expect(config._meta?.mint).toEqual({
      domain: 'school',
      intent: 'whats-due',
      canonical: true,
      subject: 'observeeId',
      when: { start: 'startDate', end: 'endDate' },
      aliases: ['homework', 'assignments', 'due', 'kids', 'school'],
    });
    const shape = (config.inputSchema as { shape: Record<string, unknown> }).shape;
    expect(shape).toHaveProperty('observeeId');
    expect(shape).toHaveProperty('startDate');
    expect(shape).toHaveProperty('endDate');
  });

  it('announcements carry their aliases', () => {
    expect(registeredConfigs().get('canvas_list_announcements')?._meta?.mint).toEqual({
      domain: 'school',
      intent: 'whats-new',
      canonical: true,
      aliases: ['teacher', 'announcements', 'news'],
    });
  });
});

describe('_meta.mint on tools/list', () => {
  it('reaches the wire for every tool except the mcp-utils healthcheck', async () => {
    const client = {} as CanvasClient;
    const h = await createTestHarness((server) => {
      registerHealthcheckTools(server, { resolved: null, configError: null, client: null });
      for (const register of REGISTRARS) register(server, client);
    });
    const { tools } = await h.client.listTools();
    await h.close?.();
    const unhinted = tools.filter((t) => !(t._meta as Record<string, unknown> | undefined)?.mint).map((t) => t.name);
    // canvas_healthcheck is registered by mcp-utils and joins no group: a tool
    // with no hint is in the host's `all` connector only (spec D4).
    expect(unhinted).toEqual(['canvas_healthcheck']);
    const planner = tools.find((t) => t.name === 'canvas_list_planner_items');
    expect((planner?._meta as Record<string, unknown>).mint).toMatchObject({ canonical: true, intent: 'whats-due' });
  });
});
