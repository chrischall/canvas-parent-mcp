import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerCredentialHealthcheckTool } from '@chrischall/mcp-utils/healthcheck';
import type { ResolvedAuth } from '../auth.js';
import { CanvasClient } from '../client.js';

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
 */
export function registerHealthcheckTools(
  server: McpServer,
  state: { resolved: ResolvedAuth | null; configError: Error | null },
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
      // Built here rather than passed in: with no credential the probe is
      // skipped entirely, so there is nothing to construct on that path.
      const client = new CanvasClient(state.resolved!.account, {
        refreshSession: state.resolved!.refresh,
      });
      return client.request('/api/v1/users/self/profile');
    },
  });
}
