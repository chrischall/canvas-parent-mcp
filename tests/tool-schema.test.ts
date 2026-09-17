import { describe, expect, it } from 'vitest';
import { createTestHarness } from '@chrischall/mcp-utils/test';
import { registerProfileTools } from '../src/tools/profile.js';
import type { CanvasClient } from '../src/client.js';

describe('SDK v2 tool schemas', () => {
  it('publishes the profile view input through tools/list', async () => {
    const client = { request: async () => ({}) } as unknown as CanvasClient;
    const harness = await createTestHarness((server) => registerProfileTools(server, client));
    const { tools } = await harness.client.listTools();
    const tool = tools.find((candidate) => candidate.name === 'canvas_get_profile');
    expect(tool?.inputSchema).toMatchObject({
      type: 'object',
      properties: {
        view: { type: 'string', enum: ['compact', 'full'] },
      },
    });
    await harness.close();
  });
});
