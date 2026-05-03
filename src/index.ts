#!/usr/bin/env node
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

try {
  const { config } = await import('dotenv');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // quiet:true suppresses dotenv's startup banner — required because MCP uses
  // stdout for JSON-RPC and any extra output corrupts the stream.
  config({ path: join(__dirname, '..', '.env'), override: false, quiet: true });
} catch {
  // dotenv not available — rely on process.env
}

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadAccount } from './config.js';
import { CanvasClient } from './client.js';
import { registerProfileTools } from './tools/profile.js';
import { registerObserveeTools } from './tools/observees.js';
import { registerCourseTools } from './tools/courses.js';
import { registerAssignmentTools } from './tools/assignments.js';
import { registerSubmissionTools } from './tools/submissions.js';
import { registerGradeTools } from './tools/grades.js';
import { registerCalendarTools } from './tools/calendar.js';
import { registerPlannerTools } from './tools/planner.js';
import { registerAnnouncementTools } from './tools/announcements.js';
import { registerConversationTools } from './tools/conversations.js';
import { registerDiscussionTools } from './tools/discussions.js';
import { registerFileTools } from './tools/files.js';

const account = loadAccount();
const client = new CanvasClient(account);
const server = new McpServer({ name: 'canvas', version: '1.0.1' });

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

console.error(`[canvas-parent-mcp] Canvas: ${account.name} (${account.baseUrl}) [${account.mode}]`);
console.error('[canvas-parent-mcp] Developed and maintained by AI (Claude). Use at your own discretion.');

const transport = new StdioServerTransport();
await server.connect(transport);
