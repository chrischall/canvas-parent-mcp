import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import type { CanvasClient } from '../src/client.js';
import { registerHealthcheckTools } from '../src/tools/healthcheck.js';
import { registerProfileTools } from '../src/tools/profile.js';
import { registerObserveeTools } from '../src/tools/observees.js';
import { registerCourseTools } from '../src/tools/courses.js';
import { registerAssignmentTools } from '../src/tools/assignments.js';
import { registerSubmissionTools } from '../src/tools/submissions.js';
import { registerGradeTools } from '../src/tools/grades.js';
import { registerCalendarTools } from '../src/tools/calendar.js';
import { registerPlannerTools } from '../src/tools/planner.js';
import { registerAnnouncementTools } from '../src/tools/announcements.js';
import { registerConversationTools } from '../src/tools/conversations.js';
import { registerDiscussionTools } from '../src/tools/discussions.js';
import { registerFileTools } from '../src/tools/files.js';

/**
 * Fleet annotation invariants, read off `tools/list` (what clients see) rather
 * than a hand-kept list. `destructiveHint` DEFAULTS TO TRUE whenever
 * readOnlyHint is not true, so a write that forgets to declare it publishes as
 * destructive and nothing fails — a considered `true` and a forgotten one look
 * identical. Same for `openWorldHint`, which defaults to true.
 *
 * Every registrar index.ts runs is listed here; the count assertion guards
 * against one being dropped from this file.
 */
async function servedTools() {
  const client = {} as CanvasClient; // registration never touches the client
  const h = await createTestHarness((server) => {
    registerHealthcheckTools(server, { resolved: null, configError: null, client: null });
    registerProfileTools(server, client);
    registerObserveeTools(server, client);
    registerCourseTools(server, client);
    registerAssignmentTools(server, client);
    registerSubmissionTools(server, client);
    registerGradeTools(server, client);
    registerCalendarTools(server, client);
    registerPlannerTools(server, client);
    registerAnnouncementTools(server, client);
    registerConversationTools(server, client);
    registerDiscussionTools(server, client);
    registerFileTools(server, client);
  });
  const { tools } = await h.client.listTools();
  await h.close?.();
  return tools;
}

describe('tool annotations', () => {
  it('covers the full served surface', async () => {
    expect(await servedTools()).toHaveLength(19);
  });

  it('sets an explicit boolean readOnlyHint on every tool', async () => {
    const missing = (await servedTools())
      .filter((t) => typeof t.annotations?.readOnlyHint !== 'boolean')
      .map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it('sets an explicit boolean destructiveHint on every write', async () => {
    const undeclared = (await servedTools())
      .filter((t) => t.annotations?.readOnlyHint !== true && typeof t.annotations?.destructiveHint !== 'boolean')
      .map((t) => t.name);
    expect(undeclared).toEqual([]);
  });

  it('never lets a read claim to be destructive', async () => {
    const contradictory = (await servedTools())
      .filter((t) => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint === true)
      .map((t) => t.name);
    expect(contradictory).toEqual([]);
  });

  it('marks every tool open-world (each one talks to the Canvas instance)', async () => {
    const notOpen = (await servedTools())
      .filter((t) => t.annotations?.openWorldHint !== true)
      .map((t) => t.name);
    expect(notOpen).toEqual([]);
  });

  it('keeps canvas_download_file the only write, and destructive', async () => {
    // It writes to local disk and, with overwrite: true, replaces an existing
    // file — nothing in this tool set can restore what it replaced.
    const writes = (await servedTools()).filter((t) => t.annotations?.readOnlyHint !== true);
    expect(writes.map((t) => [t.name, t.annotations?.destructiveHint])).toEqual([
      ['canvas_download_file', true],
    ]);
  });

  it('lists exactly the served tools in manifest.json', async () => {
    const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8')) as {
      tools: { name: string }[];
    };
    const served = (await servedTools()).map((t) => t.name).sort();
    expect(manifest.tools.map((t) => t.name).sort()).toEqual(served);
  });
});
