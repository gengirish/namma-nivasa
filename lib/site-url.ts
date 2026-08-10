/**
 * The public origin, and the guard that stops us composing links nobody can open.
 *
 * `NEXT_PUBLIC_APP_URL` falls back to `http://localhost:3000`, which is right for rendering and
 * wrong for anything that leaves the machine: a link in an outbound message is the whole of its
 * value, and a dead one is indistinguishable from a live one until the recipient taps it.
 * Deliberately not gated on `NODE_ENV` — the machine that would make that mistake is in
 * development; the recipient is not.
 */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  return "http://localhost:3000";
}

/** Why this base must not be sent outward, or null when it is fine. */
export function unusableBaseUrl(base: string): string | null {
  let host: string;
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    return `NEXT_PUBLIC_APP_URL is not a valid URL (${base})`;
  }
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) {
    return `refusing to send links pointing at ${base} — set NEXT_PUBLIC_APP_URL to the public origin`;
  }
  return null;
}

export function propertyUrl(slug: string): string {
  return `${siteUrl()}/homes/${slug}`;
}
