import type { McpServer } from '@modelcontextprotocol/server';
import { registerCredentialHealthcheckTool } from '@chrischall/mcp-utils/healthcheck';
import type { ResolvedAuth } from '../auth.js';
import type { CanvasClient } from '../client.js';

/**
 * Register `canvas_healthcheck` — reports which auth path resolved, then makes
 * one authenticated call to `/api/v1/users/self/profile`.
 *
 * REGISTERED UNCONDITIONALLY, unlike every other tool here. The
 * deferred-config-error pattern registers nothing when auth fails, so an
 * unconfigured server exposes zero tools and explains itself only on stderr —
 * which a hosted connector never sees. That makes "the connector has no tools"
 * indistinguishable from "the connector is broken". This one tool always
 * exists, so there is always something that can answer why.
 *
 * `/api/v1/users/self/profile` is the probe because it is the cheapest
 * endpoint requiring valid auth — its own tool description calls it the
 * "useful first call to confirm credentials".
 *
 * The probe goes through the server's own `client` (null when auth did not
 * resolve) rather than a fresh CanvasClient per call: a fresh client has its
 * own session manager, so with the session cache off every healthcheck did a
 * full form login or browser lift — enough repeats can trip Canvas login
 * throttling — and with it on, two managers raced on the same session.json.
 */
export function registerHealthcheckTools(
  server: McpServer,
  state: { resolved: ResolvedAuth | null; configError: Error | null; client: CanvasClient | null },
): void {
  registerCredentialHealthcheckTool({
    server,
    prefix: 'canvas',
    hostLabel: 'canvas',
    probePath: '/api/v1/users/self/profile',
    resolveCredential: async () => {
      if (!state.resolved) {
        // The stored error names every accepted auth path, which is exactly
        // the question being asked; surface it rather than a generic message.
        throw state.configError ?? new Error('Canvas auth is not configured.');
      }
      return {
        source: state.resolved.source,
        detail: {
          base_url: state.resolved.account.baseUrl,
          mode: state.resolved.account.mode,
        },
      };
    },
    probeFn: async () => {
      // Only reached once resolveCredential succeeded, and index.ts builds the
      // client whenever auth resolved; guard anyway rather than dereference null.
      if (!state.client) throw new Error('Canvas client is not initialised.');
      return state.client.request('/api/v1/users/self/profile');
    },
  });
}
