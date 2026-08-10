import { Prisma } from "@prisma/client";

import { DomainError } from "@/lib/auth";
import { dashboardLink, notify, teamInbox } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { makeReference } from "@/lib/validations";

export interface CreateOwnerSubmissionInput {
  name: string;
  phone: string;
  email?: string | null;
  locality: string;
  propertyType?: string | null;
  config?: string | null;
  areaSqft?: number | null;
  expectedPrice?: string | null;
  timeline?: string | null;
  message?: string | null;
  mediaCount?: number;
}

export interface OwnerSubmissionReceipt {
  reference: string;
  first: string;
  locality: string;
}

/**
 * "List your home" intake.
 *
 * `mediaCount` records how many photos and videos the owner said they have; the files
 * themselves are never uploaded here. Storing a count a curator can ask about is honest about
 * what this holds, where an upload field that quietly discarded the bytes would not be.
 */
export async function createOwnerSubmission(
  input: CreateOwnerSubmissionInput,
): Promise<OwnerSubmissionReceipt> {
  const reference = makeReference("NIV-O");

  try {
    const created = await prisma.ownerSubmission.create({
      data: {
        reference,
        name: input.name,
        phone: input.phone,
        email: input.email ?? null,
        locality: input.locality,
        propertyType: input.propertyType ?? null,
        config: input.config ?? null,
        areaSqft: input.areaSqft ?? null,
        expectedPrice: input.expectedPrice ?? null,
        timeline: input.timeline ?? null,
        message: input.message ?? null,
        mediaCount: input.mediaCount ?? 0,
      },
      select: { id: true, reference: true, name: true, locality: true },
    });

    await notify({
      type: "OWNER_SUBMISSION_RECEIVED",
      recipient: teamInbox(),
      subject: `Owner submission — ${created.locality} (${created.reference})`,
      body: [
        `${input.name} · ${input.phone}${input.email ? ` · ${input.email}` : ""}`,
        `Locality: ${input.locality}`,
        input.propertyType ? `Type: ${input.propertyType}` : null,
        input.config ? `Config: ${input.config}` : null,
        input.areaSqft ? `Area: ${input.areaSqft} sqft` : null,
        input.expectedPrice ? `Expected: ${input.expectedPrice}` : null,
        input.timeline ? `Timeline: ${input.timeline}` : null,
        input.mediaCount ? `Media on hand: ${input.mediaCount} file(s)` : "No media offered",
        input.message ? `Notes: ${input.message}` : null,
        dashboardLink("/dashboard/submissions"),
      ]
        .filter(Boolean)
        .join("\n"),
      subjectId: created.id,
    });

    return {
      reference: created.reference,
      first: created.name.split(" ")[0],
      locality: created.locality,
    };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new DomainError("That submission was already received", 409);
    }
    throw err;
  }
}

/**
 * Newsletter. Re-subscribing an address that unsubscribed clears the flag rather than failing —
 * a person typing their address in again is asking to hear from us.
 */
export async function subscribe(email: string): Promise<{ alreadySubscribed: boolean }> {
  const normalized = email.trim().toLowerCase();
  const existing = await prisma.subscriber.findUnique({
    where: { email: normalized },
    select: { id: true, unsubscribedAt: true },
  });

  if (existing) {
    if (existing.unsubscribedAt) {
      await prisma.subscriber.update({
        where: { id: existing.id },
        data: { unsubscribedAt: null },
      });
      return { alreadySubscribed: false };
    }
    return { alreadySubscribed: true };
  }

  await prisma.subscriber.create({ data: { email: normalized } });
  return { alreadySubscribed: false };
}
