import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import type { NextRequest } from "next/server";

import { AuthError, apiError, requireRole } from "@/lib/auth";

/**
 * POST /api/admin/uploads — mints a short-lived token so a curator's browser can upload a photo
 * straight to Blob storage.
 *
 * The bytes never pass through this app. A Vercel function has a request-body ceiling and no
 * reason to hold a 4MB JPEG in memory on its way to a bucket, so the browser talks to Blob
 * directly and this route only decides whether it may.
 *
 * Two things are load-bearing:
 *
 *   - **`requireRole()` runs inside `onBeforeGenerateToken`**, which is the only place that can
 *     refuse. The token is the credential; issuing one and checking afterwards would be checking
 *     after the fact. Middleware already requires a signed-in Clerk user for `/api/admin`, but
 *     signed-in is not the same as CURATOR.
 *   - **The pathname is validated, not trusted.** The client chooses it, and a token scoped to
 *     whatever it asked for would let any curator write anywhere in the store — including over
 *     another listing's photos.
 *
 * This route does not use `withApiErrors`/`apiOk`: `handleUpload` owns both directions of the
 * protocol and the client SDK parses its exact shape. Wrapping it in this project's envelope
 * would break the upload rather than tidy it.
 */
export const dynamic = "force-dynamic";

const PREFIX = "properties/";
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/avif"];
/** Comfortably above a camera JPEG, well below anything that belongs in a listing. */
const MAX_BYTES = 12 * 1024 * 1024;

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const body = (await req.json()) as HandleUploadBody;

    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        await requireRole("CURATOR");

        if (!pathname.startsWith(PREFIX) || pathname.includes("..")) {
          throw new Error(`Uploads must live under ${PREFIX}`);
        }

        return {
          allowedContentTypes: ALLOWED,
          maximumSizeInBytes: MAX_BYTES,
          // Two curators uploading `front.jpg` for different homes must not collide, and a
          // replaced photo should not be served from a cache under its old name.
          addRandomSuffix: true,
        };
      },
      // Nothing to record: the URL only matters once it is saved onto the listing, which is a
      // separate, deliberate PATCH. An upload that is never attached is an orphan blob, not a
      // half-written listing.
      onUploadCompleted: async () => {},
    });

    return Response.json(result);
  } catch (err) {
    if (err instanceof AuthError) return apiError(err.message, err.status);
    return apiError(err instanceof Error ? err.message : "Upload failed", 400);
  }
}
