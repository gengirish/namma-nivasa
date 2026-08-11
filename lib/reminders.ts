import { buildIcsContent, icsFileName } from "@/lib/ics";
import { notify, teamInbox } from "@/lib/notifications";
import { prisma } from "@/lib/prisma";
import { friendlyDate, istDayWindow, slotLabel } from "@/lib/slots";

/**
 * The evening-before reminder, and the slot housekeeping that belongs beside it.
 *
 * Callable from a route, a script, or the cron without change — `app/api/cron/viewing-reminders`
 * is thirty lines of authorisation around these two functions and nothing else.
 */

/**
 * How far out a cancelled viewing must be before its hour goes back on sale.
 *
 * Cancelling deliberately did *not* free the slot for most of this project's life, so that an
 * owner already told about a visit could not have the same hour resold from under them. This is
 * the compromise: far enough out that the owner has not arranged their day around it, close
 * enough that a listing with three slots a week is not quietly starved by cancellations.
 */
const RELEASE_FLOOR_HOURS = 24;

export interface ReminderRun {
  sent: number;
  released: number;
}

/**
 * Mails everyone with a visit tomorrow, once.
 *
 * `reminderSentAt` is stamped after the send and is the only thing standing between a retried
 * cron and a visitor being told twice. The stamp is written whether delivery succeeded or not,
 * which is deliberate: `notify()` records a FAILED row that a human can see in
 * /dashboard/outbox, and a second copy of "your visit is tomorrow" is worse than a visible
 * failure. The one window left is a crash between sending and stamping — the same window
 * `notify()` documents for its own log row, and it errs towards telling someone twice rather
 * than not at all.
 */
export async function sendDueReminders(now: Date = new Date()): Promise<number> {
  const { start, end } = istDayWindow(1, now);

  const due = await prisma.viewing.findMany({
    where: {
      status: "BOOKED",
      reminderSentAt: null,
      scheduledFor: { gte: start, lt: end },
    },
    orderBy: { scheduledFor: "asc" },
    select: {
      id: true,
      scheduledFor: true,
      property: { select: { name: true, location: true, ownerEmail: true } },
      enquiry: {
        select: {
          id: true,
          reference: true,
          kind: true,
          name: true,
          phone: true,
          email: true,
          propertyName: true,
        },
      },
    },
  });

  let sent = 0;

  for (const viewing of due) {
    const { enquiry, property } = viewing;
    // The snapshot first: a listing can be renamed between booking and visit, and the visitor
    // should read the name they enquired about.
    const propertyName = enquiry.propertyName ?? property.name;
    const isCall = enquiry.kind === "OWNER_CALL";
    const when = `${friendlyDate(viewing.scheduledFor)} · ${slotLabel(viewing.scheduledFor)}`;

    const ics = buildIcsContent(viewing.scheduledFor.toISOString(), propertyName, enquiry.kind);

    await notify({
      type: "VIEWING_REMINDER",
      // The visitor is the person who needs reminding — but `Enquiry.email` is nullable, and a
      // reminder addressed to nobody is worse than one the team has to forward by hand.
      recipient: enquiry.email || teamInbox(),
      // The owner has to open the door; the team wants the audit. `copiesFor()` strips the
      // primary recipient and de-duplicates, so an owner who is also the team inbox — or the
      // visitor — is not copied on their own message.
      cc: [property.ownerEmail, teamInbox()].filter((address): address is string =>
        Boolean(address),
      ),
      subject: `Tomorrow: ${isCall ? "call with the owner" : "site visit"} — ${propertyName} (${enquiry.reference})`,
      // Written for all three readers at once rather than as a letter to one of them, because
      // all three receive this exact text.
      body: [
        isCall
          ? "A call with the owner is arranged for tomorrow."
          : "A site visit is arranged for tomorrow.",
        "",
        `Home: ${propertyName}`,
        isCall ? null : `Where: ${property.location}`,
        `When: ${when}`,
        `Visitor: ${enquiry.name} · ${enquiry.phone}`,
        `Reference: ${enquiry.reference}`,
        "",
        ics ? "A calendar invite is attached." : null,
        "If this no longer works, reply to this email and we will rearrange it.",
      ]
        .filter((line) => line !== null)
        .join("\n"),
      attachments: ics
        ? [
            {
              filename: icsFileName(propertyName),
              contentType: "text/calendar",
              content: Buffer.from(ics, "utf8").toString("base64"),
            },
          ]
        : undefined,
      subjectId: enquiry.id,
    });

    await prisma.viewing.update({
      where: { id: viewing.id },
      data: { reminderSentAt: new Date() },
    });
    sent += 1;
  }

  return sent;
}

/**
 * Puts the hours held by cancelled viewings back on sale, once they are far enough out.
 *
 * Deletes the `Viewing` and never the `Enquiry`: the lead is history worth keeping, and its
 * `propertyName` snapshot is what makes it readable a year later. Safe to delete only the
 * viewing because cancelling an enquiry already cascades to it
 * (`app/api/admin/enquiries/[id]/route.ts`), so a CANCELLED viewing never belongs to an enquiry
 * still claiming to be SCHEDULED — which would be a visit nobody is expecting.
 *
 * The row has to go rather than change status, because the thing occupying the slot is the
 * `@@unique([propertyId, scheduledFor])` index, not the status field.
 */
export async function releaseCancelledSlots(now: Date = new Date()): Promise<number> {
  const floor = new Date(now.getTime() + RELEASE_FLOOR_HOURS * 60 * 60 * 1000);

  const { count } = await prisma.viewing.deleteMany({
    where: { status: "CANCELLED", scheduledFor: { gt: floor } },
  });

  return count;
}

export async function runReminderCron(now: Date = new Date()): Promise<ReminderRun> {
  // Order is arbitrary — one reads BOOKED viewings and the other deletes CANCELLED ones, so the
  // two never touch the same row. Sequential rather than concurrent only to keep the failure
  // report readable: if releasing throws, no reminders have gone out yet to explain.
  const released = await releaseCancelledSlots(now);
  const sent = await sendDueReminders(now);
  return { sent, released };
}
