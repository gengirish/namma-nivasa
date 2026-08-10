import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * In-memory fallback. Resets on cold start and does not coordinate across instances, which is
 * fine for a brochure site and not fine for anything that costs money — when Upstash is
 * configured it is used instead.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

const CLEANUP_INTERVAL_MS = 60_000;
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) {
    if (now > entry.resetAt) buckets.delete(key);
  }
}, CLEANUP_INTERVAL_MS).unref?.();

const upstashEnabled =
  Boolean(process.env.UPSTASH_REDIS_REST_URL) && Boolean(process.env.UPSTASH_REDIS_REST_TOKEN);

const limiterCache = new Map<string, Ratelimit>();

function upstashLimiter(limit: number, windowMs: number): Ratelimit {
  const key = `${limit}:${windowMs}`;
  let instance = limiterCache.get(key);
  if (!instance) {
    instance = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
    });
    limiterCache.set(key, instance);
  }
  return instance;
}

export function rateLimit(key: string, limit = 10, windowMs = 60_000): boolean {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || now > entry.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

export async function rateLimitAsync(key: string, limit = 10, windowMs = 60_000): Promise<boolean> {
  if (!upstashEnabled) return rateLimit(key, limit, windowMs);
  const { success } = await upstashLimiter(limit, windowMs).limit(key);
  return success;
}

/**
 * The address to rate-limit on.
 *
 * `x-forwarded-for` is caller-controlled: it is a list each proxy appends to, so the leading
 * entry is whatever the original client sent — including a client that invented it. Reading
 * `split(",")[0]` first lets an attacker rotate the header per request and get a fresh bucket
 * every time, which makes the limiter decorative.
 *
 * On Vercel `x-vercel-forwarded-for` is set by the platform and cannot be spoofed; `x-real-ip`
 * is the equivalent behind most other proxies. The `x-forwarded-for` fallback is last, for
 * local development where nothing sets either.
 */
export function getClientIp(req: Request): string {
  const platform = req.headers.get("x-vercel-forwarded-for") ?? req.headers.get("x-real-ip");
  if (platform?.trim()) return platform.trim();
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
