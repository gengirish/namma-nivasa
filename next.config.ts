import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * `agentmail` is a server-only SDK, and it must stay out of the bundle.
   *
   * Its `x402.mjs` does `await import("@x402/fetch")` for a payments feature nothing here uses,
   * and the package declares no peer dependency for it — so the module is simply absent.
   * Turbopack resolves dynamic imports statically, which turns that absence into a hard
   * "Module not found" at build time rather than a runtime branch that never executes.
   *
   * Listing it here leaves it as a runtime require in the server bundle, so the import is only
   * evaluated if something actually calls the x402 path. Every consumer is server-side
   * (lib/agentmail.ts, lib/notifications.ts, lib/email-threads.ts, the webhook route and the
   * inbox page), so nothing about this reaches a browser.
   */
  serverExternalPackages: ["agentmail"],
};

export default nextConfig;
