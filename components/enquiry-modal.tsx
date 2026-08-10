"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";

import type { DayAvailabilityDto } from "@/lib/dto";
import { buildIcsHref, icsFileName } from "@/lib/ics";

import { useNivasa } from "./nivasa-store";
import { SERIF } from "./ui";

const label: React.CSSProperties = {
  display: "block",
  fontSize: "0.72rem",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#57534E",
  marginBottom: 8,
};

const field: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  border: "1px solid #DDD5C9",
  borderRadius: 2,
  fontFamily: "inherit",
  fontSize: "0.95rem",
  background: "#FAF7F2",
  color: "#1C1917",
};

/** `YYYY-MM-DD` in Asia/Kolkata — the earliest date the picker will accept. */
function todayInIst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
}

/**
 * Field state lives here rather than in the dialog so that closing the modal — which unmounts
 * this subtree — clears it, with no reset effect to run.
 */
function EnquiryForm() {
  const s = useNivasa();
  const nameRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const [availability, setAvailability] = useState<DayAvailabilityDto | null>(null);

  const isScheduling =
    Boolean(s.modalProperty) && (s.modalMode === "call" || s.modalMode === "phonecall");
  const slug = s.modalProperty?.slug;

  useEffect(() => {
    const t = setTimeout(() => nameRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, []);

  /**
   * The slot grid comes from the server for the chosen date, so a time somebody else has
   * already booked is never offered. Aborted on change: a slow answer for yesterday's date
   * must not overwrite a fast answer for today's.
   */
  useEffect(() => {
    if (!isScheduling || !slug || !s.selDate) return;
    const controller = new AbortController();
    fetch(`/api/properties/${encodeURIComponent(slug)}/availability?date=${s.selDate}`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((payload: { success: boolean; data?: DayAvailabilityDto }) => {
        if (payload?.success && payload.data) setAvailability(payload.data);
      })
      .catch(() => {
        /* aborted or offline — the submit below still refuses an unpicked slot */
      });
    return () => controller.abort();
  }, [isScheduling, slug, s.selDate]);

  // Matched against the chosen date rather than cleared on change: a slow answer for the
  // previous date can still land after the abort, and rendering it against the new date would
  // offer slots that belong to a different day. It also makes "loading" a derived fact rather
  // than a second piece of state to keep in step.
  const current = availability?.date === s.selDate ? availability : null;

  const heading = s.modalProperty
    ? s.modalMode === "call"
      ? "Schedule a Site Visit"
      : s.modalMode === "phonecall"
        ? "Schedule a Call"
        : "Leave a Message"
    : "Tell us what you're looking for";

  const sub = s.modalProperty
    ? s.modalMode === "call"
      ? `Pick a date and time, and the owner of ${s.modalProperty.name} will meet you at the home.`
      : s.modalMode === "phonecall"
        ? `Pick a date and time, and the owner of ${s.modalProperty.name} will call you then.`
        : `Send a message directly to the owner of ${s.modalProperty.name}.`
    : "Leave your number and we'll arrange a visit to the home that fits — or open any listing to pick a time yourself.";

  const submitLabel = s.modalProperty
    ? s.modalMode === "call"
      ? "Request Visit"
      : s.modalMode === "phonecall"
        ? "Request Call"
        : "Send Message"
    : "Send";

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void s.submitEnquiry({ name, phone, email, message });
  };

  return (
    <>
      <h3 style={{ fontFamily: SERIF, fontWeight: 600, fontSize: "1.4rem", margin: "0 0 6px", color: "#1C1917" }}>
        {heading}
      </h3>
      <p style={{ color: "#78716C", fontSize: "0.88rem", margin: "0 0 24px" }}>{sub}</p>

      <form onSubmit={onSubmit}>
        {isScheduling && (
          <>
            <div style={{ marginBottom: 18 }}>
              <label style={label} htmlFor="nv-date">
                Preferred date
              </label>
              <input
                id="nv-date"
                type="date"
                min={todayInIst()}
                value={s.selDate}
                onChange={(e) => {
                  s.setSelDate(e.target.value);
                  s.setSelTime("");
                }}
                style={field}
              />
            </div>

            <div style={{ marginBottom: 18 }}>
              <p style={{ ...label, marginBottom: 10 }}>Preferred time</p>

              {!s.selDate ? (
                <p style={{ fontSize: "0.85rem", color: "#A8A29E", margin: 0 }}>
                  Pick a date to see the times still open.
                </p>
              ) : !current ? (
                <p style={{ fontSize: "0.85rem", color: "#A8A29E", margin: 0 }}>
                  Checking the owner&apos;s week…
                </p>
              ) : (
                <>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {(current?.slots ?? []).map((slot) => {
                      const active = s.selTime === slot.time;
                      return (
                        <button
                          key={slot.time}
                          type="button"
                          disabled={!slot.available}
                          onClick={() => s.setSelTime(slot.time)}
                          aria-pressed={active}
                          title={slot.available ? undefined : "Already booked"}
                          style={{
                            padding: "8px 14px",
                            border: `1px solid ${active ? "#A16207" : "#DDD5C9"}`,
                            borderRadius: 20,
                            background: active ? "#A16207" : slot.available ? "#ffffff" : "#F1ECE4",
                            color: active ? "#ffffff" : slot.available ? "#57534E" : "#B6AFA5",
                            fontSize: "0.8rem",
                            cursor: slot.available ? "pointer" : "not-allowed",
                            textDecoration: slot.available ? "none" : "line-through",
                            fontFamily: "inherit",
                          }}
                        >
                          {slot.time}
                        </button>
                      );
                    })}
                  </div>
                  <p style={{ fontSize: "0.7rem", color: "#A8A29E", margin: "8px 0 0" }}>
                    {current.slotsLeftInWeek === 0
                      ? "That week is fully booked — try a date in another week."
                      : `${current.slotsLeftInWeek} of ${current.weeklySlots} slots left that week. Struck-through times are already taken.`}
                  </p>
                </>
              )}
            </div>
          </>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={label} htmlFor="nv-name">
            Your name
          </label>
          <input
            id="nv-name"
            ref={nameRef}
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={field}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={label} htmlFor="nv-phone">
            Phone number
          </label>
          <input
            id="nv-phone"
            type="tel"
            required
            autoComplete="tel"
            placeholder="98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            style={field}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={label} htmlFor="nv-email">
            Email (optional)
          </label>
          <input
            id="nv-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={field}
          />
        </div>
        {(s.modalMode === "message" || !s.modalProperty) && (
          <div style={{ marginBottom: 16 }}>
            <label style={label} htmlFor="nv-msg">
              Message (optional)
            </label>
            <textarea
              id="nv-msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              style={{ ...field, resize: "vertical", minHeight: 90 }}
            />
          </div>
        )}

        <button
          type="submit"
          disabled={s.submitting}
          className="nv-btn-gold"
          style={{
            width: "100%",
            padding: 15,
            background: "#A16207",
            color: "#fff",
            border: "1px solid #A16207",
            borderRadius: 2,
            cursor: s.submitting ? "progress" : "pointer",
            opacity: s.submitting ? 0.75 : 1,
            fontSize: "0.8rem",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            fontFamily: "inherit",
          }}
        >
          {s.submitting ? "Sending…" : submitLabel}
        </button>
      </form>
    </>
  );
}

function Receipt() {
  const s = useNivasa();
  const receipt = s.receipt!;
  const first = receipt.reference;
  const icsHref = receipt.scheduledFor
    ? buildIcsHref(receipt.scheduledFor, receipt.propertyName ?? "Nivasa", receipt.kind)
    : null;

  const headline = receipt.scheduledFor
    ? receipt.kind === "OWNER_CALL"
      ? "We’ve got it."
      : "You’re all set."
    : "Message sent.";

  const sub = receipt.scheduledFor
    ? receipt.kind === "OWNER_CALL"
      ? `The owner of ${receipt.propertyName} will call you at the time below, on the number you shared.`
      : `The owner of ${receipt.propertyName} will meet you at the home. We’ll confirm the exact address beforehand.`
    : `${receipt.propertyName ? `The owner of ${receipt.propertyName}` : "We"} will get back to you shortly on the number you shared. No brokers in between.`;

  return (
    <div style={{ textAlign: "center", padding: "6px 0 2px" }}>
      <div
        style={{
          width: 62,
          height: 62,
          borderRadius: "50%",
          background: "#F3ECE1",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 22px",
          animation: "nvpop .4s cubic-bezier(.34,1.56,.64,1) both",
        }}
      >
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#A16207"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <h3 style={{ fontFamily: SERIF, fontWeight: 600, fontSize: "1.5rem", margin: "0 0 12px", color: "#1C1917" }}>
        {headline}
      </h3>
      <p style={{ color: "#57534E", fontSize: "0.95rem", fontWeight: 300, margin: "0 0 24px", lineHeight: 1.6 }}>
        {sub}
      </p>

      <div
        style={{
          textAlign: "left",
          background: "#FAF7F2",
          border: "1px solid #ECE5DB",
          borderRadius: 4,
          padding: "18px 20px",
          margin: "0 0 22px",
        }}
      >
        {receipt.whenLine && (
          <Row label="When" value={receipt.whenLine} />
        )}
        {receipt.propertyName && <Row label="Home" value={receipt.propertyName} bordered />}
        <Row label="Reference" value={first} bordered />
      </div>

      {icsHref && (
        <a
          href={icsHref}
          download={icsFileName(receipt.propertyName ?? "viewing")}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 9,
            width: "100%",
            padding: 14,
            background: "#1C1917",
            color: "#fff",
            borderRadius: 2,
            fontSize: "0.78rem",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            marginBottom: 12,
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="4" width="18" height="18" rx="2" />
            <path d="M16 2v4M8 2v4M3 10h18" />
          </svg>
          Add to calendar
        </a>
      )}

      <button
        className="nv-btn-ghost-ink"
        onClick={s.closeModal}
        style={{
          width: "100%",
          padding: 14,
          background: "transparent",
          color: "#57534E",
          border: "1px solid #DDD5C9",
          borderRadius: 2,
          cursor: "pointer",
          fontSize: "0.78rem",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontFamily: "inherit",
        }}
      >
        Done
      </button>
      <p style={{ fontSize: "0.72rem", color: "#A8A29E", margin: "18px 0 0" }}>
        Quote {first} if you call us about this.
      </p>
    </div>
  );
}

function Row({ label: k, value, bordered }: { label: string; value: string; bordered?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 16,
        padding: "6px 0",
        ...(bordered ? { borderTop: "1px solid #ECE5DB" } : {}),
      }}
    >
      <span style={{ fontSize: "0.72rem", letterSpacing: "0.08em", textTransform: "uppercase", color: "#A8A29E" }}>
        {k}
      </span>
      <span style={{ fontSize: "0.9rem", color: "#1C1917", textAlign: "right" }}>{value}</span>
    </div>
  );
}

export function EnquiryModal() {
  const s = useNivasa();
  if (!s.modalOpen) return null;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) s.closeModal();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={s.receipt ? "Enquiry confirmed" : "Enquiry"}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(12,10,9,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
        padding: 24,
      }}
    >
      <div
        style={{
          background: "#fff",
          width: "100%",
          maxWidth: 480,
          borderRadius: 6,
          padding: 34,
          position: "relative",
          animation: "nvmodal .22s ease",
          maxHeight: "92vh",
          overflow: "auto",
        }}
      >
        <button
          onClick={s.closeModal}
          aria-label="Close"
          style={{
            position: "absolute",
            top: 22,
            right: 22,
            cursor: "pointer",
            fontSize: "1.3rem",
            color: "#78716C",
            background: "none",
            border: "none",
          }}
        >
          ×
        </button>

        {s.receipt ? <Receipt /> : <EnquiryForm />}
      </div>
    </div>
  );
}
