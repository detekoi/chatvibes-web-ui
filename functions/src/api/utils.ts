import { Response } from "express";

/**
 * A failure the client can act on, carrying a stable code as well as prose.
 *
 * `error` stays exactly as it was, so any client that reads it keeps working;
 * `code` and `params` are what a localized client uses instead. Without them the
 * only thing crossing the wire is an English sentence, which the dashboard
 * echoes straight into a toast — so localizing the frontend alone would leave
 * every failure message in English.
 *
 * `params` carries the values the message interpolates, so the client can render
 * its own translation rather than parsing them back out of the prose. That is
 * what replaces string-matching a URL to decide how to present an error.
 */
export function apiError(
  res: Response,
  status: number,
  code: string,
  error: string,
  params?: Record<string, unknown>,
  extra?: Record<string, unknown>,
) {
  res.status(status).json({
    success: false as const,
    code,
    error,
    ...(params !== undefined && { params }),
    // Top-level fields the client already reads — `needsReauth`, `details`,
    // `ignored`. They are spread rather than nested so migrating a response to
    // this helper changes what it carries only by adding `code`.
    ...extra,
  });
}

