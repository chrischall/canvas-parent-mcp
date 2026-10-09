import { withAmbientCancellation } from '@chrischall/mcp-utils';

/** Per-request ceiling for Canvas API, login and token calls. */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The signal every outbound Canvas fetch carries: a timeout of its own,
 * combined with the running tool call's cancellation (when there is one), so
 * a stalled Canvas connection fails instead of hanging the tool and a call
 * the client cancelled stops talking to Canvas (fleet-audit#989).
 *
 * Build a fresh one per fetch: a timeout signal starts counting when created,
 * so one shared across a login + replay would charge the replay for the login.
 */
export function requestSignal(timeoutMs: number = REQUEST_TIMEOUT_MS): AbortSignal {
  // withAmbientCancellation only returns undefined when given undefined.
  return withAmbientCancellation(AbortSignal.timeout(timeoutMs))!;
}
