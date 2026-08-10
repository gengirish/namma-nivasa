import { Prisma, type EnquiryKind } from "@prisma/client";

import { DomainError } from "@/lib/auth";
import type { EnquiryReceiptDto } from "@/lib/dto";
import { dashboardLink, notify, teamInbox } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { friendlyDate, isBookableDate, isSlotTime, slotInstant, slotLabel } from "@/lib/slots";
import { makeReference } from "@/lib/validations";
import { weekHasRoom } from "@/lib/viewings";

/**
 * Creating an enquiry, and — when it is a site visit or an owner call — booking the slot in the
 * same transaction.
 *
 * The two rows land together or not at all. An `Enquiry` row saying SCHEDULED with no `Viewing`
 * beside it is a visit nobody is expecting, and a `Viewing` with no enquiry is an hour blocked
 * for a person we cannot phone.
 *
 * The double-booking guard is the unique index on `(propertyId, scheduledFor)`, not a read.
 * Two visitors who load the picker at the same moment both see the slot open; both INSERT;
 * Postgres rejects one with P2002 and we tell that person to pick another time. Checking
 * "is it taken" first and inserting after would leave exactly the window that matters.
 */

export interface CreateEnquiryInput {
  kind: EnquiryKind;
  propertySlug?: string | null;
  name: string;
  /** Already normalized to E.164 by `phoneSchema`. */
  phone: string;
  email?: string | null;
  message?: string | null;
  date?: string | null;
  time?: string | null;
}

const SLOT_KINDS: EnquiryKind[] = ["SITE_VISIT", "OWNER_CALL"];

export async function createEnquiry(input: CreateEnquiryInput): Promise<EnquiryReceiptDto> {
  const wantsSlot = SLOT_KINDS.includes(input.kind);

  let property: {
    id: string;
    name: string;
    slug: string;
    weeklyViewingSlots: number;
  } | null = null;

  if (input.kind !== "GENERAL") {
    if (!input.propertySlug) throw new DomainError("That home is no longer listed", 404);
    property = await prisma.property.findFirst({
      where: { slug: input.propertySlug, status: "PUBLISHED" },
      select: { id: true, name: true, slug: true, weeklyViewingSlots: true },
    });
    if (!property) throw new DomainError("That home is no longer listed", 404);
  }

  let scheduledFor: Date | null = null;
  if (wantsSlot) {
    if (!input.date || !input.time) throw new DomainError("Pick a date and time");
    if (!isSlotTime(input.time)) throw new DomainError("Pick one of the offered times");
    if (!isBookableDate(input.date)) throw new DomainError("Pick a date within the next 60 days");

    scheduledFor = slotInstant(input.date, input.time);
    if (!scheduledFor) throw new DomainError("Pick a date and time");
    if (scheduledFor.getTime() <= Date.now()) {
      throw new DomainError("That time has already passed — pick another");
    }
    if (property && !(await weekHasRoom(property, scheduledFor))) {
      throw new DomainError(
        "That week is fully booked — pick a date in another week",
        409,
      );
    }
  }

  const reference = makeReference();

  try {
    const enquiry = await prisma.$transaction(async (tx) => {
      const created = await tx.enquiry.create({
        data: {
          reference,
          kind: input.kind,
          status: scheduledFor ? "SCHEDULED" : "NEW",
          propertyId: property?.id ?? null,
          // Snapshotted: the listing can be renamed or archived, and this enquiry still has to
          // read correctly a year from now.
          propertyName: property?.name ?? null,
          name: input.name,
          phone: input.phone,
          email: input.email ?? null,
          message: input.message ?? null,
        },
        select: { id: true, reference: true, kind: true, propertyName: true },
      });

      if (scheduledFor && property) {
        await tx.viewing.create({
          data: { propertyId: property.id, enquiryId: created.id, scheduledFor },
        });
      }
      return created;
    });

    const receipt: EnquiryReceiptDto = {
      reference: enquiry.reference,
      kind: enquiry.kind,
      propertyName: enquiry.propertyName,
      scheduledFor: scheduledFor?.toISOString() ?? null,
      whenLine: scheduledFor ? `${friendlyDate(scheduledFor)} · ${slotLabel(scheduledFor)}` : null,
    };

    // After the commit, and it cannot throw — a lead we have already stored must not be lost
    // to a notification failure.
    await notify({
      type: scheduledFor ? "VIEWING_BOOKED" : "ENQUIRY_RECEIVED",
      recipient: teamInbox(),
      subject: `${enquiryHeadline(input.kind)} — ${receipt.propertyName ?? "General"} (${receipt.reference})`,
      body: [
        `${input.name} · ${input.phone}${input.email ? ` · ${input.email}` : ""}`,
        receipt.propertyName ? `Home: ${receipt.propertyName}` : "General enquiry",
        receipt.whenLine ? `When: ${receipt.whenLine}` : null,
        input.message ? `Message: ${input.message}` : null,
        dashboardLink("/dashboard/enquiries"),
      ]
        .filter(Boolean)
        .join("\n"),
      subjectId: enquiry.id,
    });

    return receipt;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Either the slot went in the moment before ours, or the reference collided. Both are
      // "try again"; only the slot case is worth a specific sentence.
      const target = String(err.meta?.target ?? "");
      if (target.includes("scheduledFor") || target.includes("propertyId")) {
        throw new DomainError("Someone just took that slot — pick another time", 409);
      }
      throw new DomainError("That enquiry was already submitted", 409);
    }
    throw err;
  }
}

export function enquiryHeadline(kind: EnquiryKind): string {
  switch (kind) {
    case "SITE_VISIT":
      return "Site visit requested";
    case "OWNER_CALL":
      return "Owner call requested";
    case "MESSAGE":
      return "Message for owner";
    default:
      return "General enquiry";
  }
}
