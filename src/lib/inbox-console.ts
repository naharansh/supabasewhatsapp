/**
 * Browser-console helpers for the inbox so network/data issues surface
 * as clearly greppable, structured logs (prefix `[inbox]`) instead of
 * generic uncaught exceptions.
 *
 * All helpers are intentionally simple wrappers over console.* so they
 * are safe to ship and can be filtered in the DevTools console by
 * typing `[inbox]`.
 */

/** Log a failed fetch including the endpoint, HTTP status, and reason. */
export function logDataFetchError(
  endpoint: string,
  status: number | null,
  reason: unknown,
  context?: Record<string, unknown>,
): void {
  console.error("[inbox] data fetch failed", {
    endpoint,
    status,
    reason: reason instanceof Error ? reason.message : reason,
    ...context,
  });
}

/** Log a JSON parse failure after a fetch. */
export function logJsonParseError(
  endpoint: string,
  error: unknown,
  context?: Record<string, unknown>,
): void {
  console.error("[inbox] response parse failed", {
    endpoint,
    reason: error instanceof Error ? error.message : error,
    ...context,
  });
}

/** Log a successful load with the row count (useful for "No conversations"). */
export function logDataLoad(
  endpoint: string,
  rowCount: number,
  context?: Record<string, unknown>,
): void {
  console.info("[inbox] data loaded", {
    endpoint,
    rowCount,
    ...context,
  });
}

/** Safe JSON parse — logs and returns null on failure instead of throwing. */
export async function safeJson<T = unknown>(
  res: Response,
  endpoint: string,
  context?: Record<string, unknown>,
): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch (err) {
    logJsonParseError(endpoint, err, context);
    return null;
  }
}