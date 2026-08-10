"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { OWNER_REASONS } from "@/lib/content";
import type { ListingMedia } from "@/lib/types";

import { useNivasa } from "./nivasa-store";
import { Eyebrow, SERIF } from "./ui";

const MEDIA_LIMIT = 20;

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

interface Receipt {
  reference: string;
  first: string;
  locality: string;
}

function formatBytes(bytes: number): string {
  return bytes > 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function OwnerForm({ onSubmitted }: { onSubmitted: (receipt: Receipt) => void }) {
  const s = useNivasa();
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [media, setMedia] = useState<ListingMedia[]>([]);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Files are described, not uploaded. The form records what the owner has so a curator can ask
   * for it — an upload control that silently discarded the bytes would be worse than honest.
   */
  const onMediaPick = (e: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || []);
    if (!picked.length) return;

    const next = media.slice();
    for (const f of picked) {
      if (next.some((m) => m.name === f.name && m.bytes === f.size)) continue;
      next.push({
        id: `${f.name}_${f.size}_${next.length}`,
        name: f.name,
        bytes: f.size,
        meta: formatBytes(f.size),
        video: (f.type || "").startsWith("video"),
      });
    }
    e.target.value = "";
    setMedia(next.slice(0, MEDIA_LIMIT));
    s.showToast(picked.length === 1 ? "Added 1 file." : `Added ${picked.length} files.`);
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;

    const form = e.currentTarget;
    const data = new FormData(form);
    const areaRaw = String(data.get("area") || "").trim();

    const body = {
      name: String(data.get("name") || "").trim(),
      phone: String(data.get("phone") || "").trim(),
      email: String(data.get("email") || "").trim() || null,
      locality: String(data.get("locality") || "").trim(),
      propertyType: String(data.get("type") || "") || null,
      config: String(data.get("config") || "") || null,
      areaSqft: areaRaw ? Number(areaRaw) : null,
      expectedPrice: String(data.get("price") || "").trim() || null,
      timeline: String(data.get("timeline") || "") || null,
      message: String(data.get("message") || "").trim() || null,
      mediaCount: media.length,
    };

    setSubmitting(true);
    try {
      const res = await fetch("/api/owner-submissions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => null)) as
        | { success: true; data: Receipt }
        | { success: false; error: string }
        | null;

      if (!res.ok || !payload?.success) {
        s.showToast(payload && !payload.success ? payload.error : "Could not send that — try again");
        return;
      }
      form.reset();
      setMedia([]);
      onSubmitted(payload.data);
    } catch {
      s.showToast("Could not reach the server — check your connection and try again");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={onSubmit}
      style={{ background: "#fff", border: "1px solid #ECE5DB", borderRadius: 10, padding: 36 }}
    >
      <h3 style={{ fontFamily: SERIF, fontWeight: 600, fontSize: "1.3rem", margin: "0 0 4px", color: "#1C1917" }}>
        Tell us about your home
      </h3>
      <p style={{ color: "#78716C", fontSize: "0.86rem", margin: "0 0 26px" }}>
        Takes about two minutes. Fields marked * are required.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <label style={label} htmlFor="ol-name">
            Your name *
          </label>
          <input id="ol-name" name="name" type="text" required style={field} />
        </div>
        <div>
          <label style={label} htmlFor="ol-phone">
            Phone *
          </label>
          <input id="ol-phone" name="phone" type="tel" required placeholder="98765 43210" style={field} />
        </div>
        <div>
          <label style={label} htmlFor="ol-email">
            Email
          </label>
          <input id="ol-email" name="email" type="email" style={field} />
        </div>
        <div>
          <label style={label} htmlFor="ol-locality">
            Locality / area *
          </label>
          <input
            id="ol-locality"
            name="locality"
            type="text"
            required
            placeholder="e.g. Indiranagar"
            style={field}
          />
        </div>
        <div>
          <label style={label} htmlFor="ol-type">
            Property type
          </label>
          <select id="ol-type" name="type" style={{ ...field, cursor: "pointer" }} defaultValue="Apartment">
            <option>Apartment</option>
            <option>Villa / Independent house</option>
            <option>Penthouse</option>
            <option>Plot</option>
            <option>Other</option>
          </select>
        </div>
        <div>
          <label style={label} htmlFor="ol-config">
            Configuration
          </label>
          <select id="ol-config" name="config" style={{ ...field, cursor: "pointer" }} defaultValue="2 BHK">
            <option>1 BHK</option>
            <option>2 BHK</option>
            <option>3 BHK</option>
            <option>4 BHK</option>
            <option>5+ BHK</option>
            <option>Plot / NA</option>
          </select>
        </div>
        <div>
          <label style={label} htmlFor="ol-area">
            Approx. area (sqft)
          </label>
          <input id="ol-area" name="area" type="number" min="0" style={field} />
        </div>
        <div>
          <label style={label} htmlFor="ol-price">
            Expected price (₹)
          </label>
          <input id="ol-price" name="price" type="text" placeholder="e.g. 1.4 Cr" style={field} />
        </div>
        <div style={{ gridColumn: "1/-1" }}>
          <label style={label} htmlFor="ol-timeline">
            Timeline
          </label>
          <select
            id="ol-timeline"
            name="timeline"
            style={{ ...field, cursor: "pointer" }}
            defaultValue="Ready to sell now"
          >
            <option>Ready to sell now</option>
            <option>In 1–3 months</option>
            <option>Just exploring</option>
          </select>
        </div>
        <div style={{ gridColumn: "1/-1" }}>
          <label style={label} htmlFor="ol-msg">
            Anything else about your home
          </label>
          <textarea id="ol-msg" name="message" style={{ ...field, resize: "vertical", minHeight: 96 }} />
        </div>
      </div>

      <div style={{ marginTop: 26, paddingTop: 24, borderTop: "1px solid #ECE5DB" }}>
        <p style={label}>Photos &amp; videos</p>
        <p style={{ color: "#78716C", fontSize: "0.84rem", margin: "0 0 14px", textWrap: "pretty" }}>
          Good light, wide shots, and a walk-through video help us assess your home faster. We only
          note what you have here — a curator will ask you to send the files.
        </p>
        <input
          ref={fileInput}
          type="file"
          accept="image/*,video/*"
          multiple
          onChange={onMediaPick}
          style={{ display: "none" }}
        />
        <button
          type="button"
          className="nv-btn-dashed"
          onClick={() => fileInput.current?.click()}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "13px 20px",
            minHeight: 44,
            background: "#FAF7F2",
            color: "#A16207",
            border: "1px dashed #C9A227",
            borderRadius: 2,
            cursor: "pointer",
            fontFamily: "inherit",
            fontSize: "0.78rem",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
          }}
        >
          <span style={{ fontSize: "1.15rem", lineHeight: 1, fontWeight: 300 }}>+</span>
          <span>Add photos &amp; videos</span>
        </button>

        {media.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <p
              style={{
                fontSize: "0.72rem",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "#A8A29E",
                margin: "0 0 10px",
              }}
            >
              {media.length === 1 ? "1 file noted" : `${media.length} files noted`}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {media.map((m) => (
                <div
                  key={m.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 14px",
                    background: "#FAF7F2",
                    border: "1px solid #ECE5DB",
                    borderRadius: 2,
                  }}
                >
                  <span
                    style={{
                      fontSize: "0.64rem",
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      color: "#A16207",
                      border: "1px solid #E7D9BC",
                      borderRadius: 2,
                      padding: "3px 7px",
                    }}
                  >
                    {m.video ? "Video" : "Photo"}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: "0.88rem",
                      color: "#1C1917",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {m.name}
                  </span>
                  <span style={{ fontSize: "0.76rem", color: "#A8A29E" }}>{m.meta}</span>
                  <button
                    type="button"
                    className="nv-btn-ghost-light"
                    onClick={() => setMedia((cur) => cur.filter((x) => x.id !== m.id))}
                    aria-label={`Remove ${m.name}`}
                    style={{
                      width: 28,
                      height: 28,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "transparent",
                      border: "1px solid #DDD5C9",
                      borderRadius: 2,
                      color: "#78716C",
                      cursor: "pointer",
                      fontSize: "0.9rem",
                      lineHeight: 1,
                      fontFamily: "inherit",
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="nv-btn-gold"
        style={{
          width: "100%",
          marginTop: 22,
          padding: 16,
          background: "#A16207",
          color: "#fff",
          border: "1px solid #A16207",
          borderRadius: 2,
          cursor: submitting ? "progress" : "pointer",
          opacity: submitting ? 0.75 : 1,
          fontSize: "0.8rem",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          fontFamily: "inherit",
        }}
      >
        {submitting ? "Sending…" : "Submit for review"}
      </button>
      <p style={{ fontSize: "0.72rem", color: "#A8A29E", margin: "16px 0 0", textWrap: "pretty" }}>
        By submitting you agree we may contact you about your listing. We review every home
        personally and only feature a select few — submitting doesn&apos;t guarantee a listing.
      </p>
    </form>
  );
}

export function ListPropertyView() {
  const s = useNivasa();
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  return (
    <main>
      <section
        style={{
          padding: "52px 24px 30px",
          background: "linear-gradient(180deg,#FFFFFF 0%,#FAF7F2 100%)",
          borderBottom: "1px solid #ECE5DB",
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto", textAlign: "center" }}>
          <Eyebrow style={{ letterSpacing: "0.3em" }}>For Owners</Eyebrow>
          <h1
            style={{
              fontFamily: SERIF,
              fontWeight: 600,
              fontSize: "clamp(2rem,4.4vw,3rem)",
              margin: "14px 0 12px",
              color: "#1C1917",
            }}
          >
            List your home with Nivasa
          </h1>
          <p
            style={{
              maxWidth: 600,
              margin: "0 auto",
              color: "#57534E",
              fontSize: "1.05rem",
              fontWeight: 300,
            }}
          >
            We take on only a handful of homes at a time. Tell us about yours — if it&apos;s the
            right fit, we&apos;ll visit, photograph and present it, with no brokerage on either side.
          </p>
        </div>
      </section>

      {receipt ? (
        <section style={{ padding: "70px 24px 90px" }}>
          <div
            style={{
              maxWidth: 560,
              margin: "0 auto",
              textAlign: "center",
              background: "#fff",
              border: "1px solid #ECE5DB",
              borderRadius: 10,
              padding: "52px 40px",
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                background: "#F3ECE1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 24px",
                animation: "nvpop .4s cubic-bezier(.34,1.56,.64,1) both",
              }}
            >
              <svg
                width="30"
                height="30"
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
            <h2 style={{ fontFamily: SERIF, fontWeight: 600, fontSize: "1.7rem", margin: "0 0 12px", color: "#1C1917" }}>
              Thank you, {receipt.first}.
            </h2>
            <p style={{ color: "#57534E", fontSize: "1rem", fontWeight: 300, margin: "0 0 12px", lineHeight: 1.7 }}>
              We&apos;ve received the details for your home in {receipt.locality}. Our curation team
              reviews every submission personally and will reach out within two working days.
            </p>
            <p style={{ color: "#78716C", fontSize: "0.88rem", margin: "0 0 28px" }}>
              Your reference is <strong style={{ color: "#1C1917" }}>{receipt.reference}</strong>.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
              <button
                className="nv-btn-gold"
                onClick={() => setReceipt(null)}
                style={{
                  padding: "14px 28px",
                  background: "#A16207",
                  color: "#fff",
                  border: "1px solid #A16207",
                  borderRadius: 2,
                  cursor: "pointer",
                  fontSize: "0.78rem",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  fontFamily: "inherit",
                }}
              >
                List another home
              </button>
              <button
                className="nv-btn-ghost-ink"
                onClick={s.goHome}
                style={{
                  padding: "14px 28px",
                  background: "transparent",
                  color: "#1C1917",
                  border: "1px solid #DDD5C9",
                  borderRadius: 2,
                  cursor: "pointer",
                  fontSize: "0.78rem",
                  letterSpacing: "0.12em",
                  textTransform: "uppercase",
                  fontFamily: "inherit",
                }}
              >
                Back to homes
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section style={{ padding: "56px 24px 90px" }}>
          <div
            data-maplayout
            style={{
              maxWidth: 1100,
              margin: "0 auto",
              display: "grid",
              gridTemplateColumns: "0.85fr 1.15fr",
              gap: 56,
            }}
          >
            <div>
              <Eyebrow>Why list with us</Eyebrow>
              <h2 style={{ fontFamily: SERIF, fontWeight: 600, fontSize: "1.6rem", margin: "10px 0 26px", color: "#1C1917" }}>
                A quieter way to sell
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {OWNER_REASONS.map((r) => (
                  <div key={r.title} style={{ borderTop: "1px solid #ECE5DB", paddingTop: 16 }}>
                    <h3
                      style={{
                        fontFamily: SERIF,
                        fontWeight: 500,
                        fontSize: "1.1rem",
                        margin: "0 0 6px",
                        color: "#1C1917",
                      }}
                    >
                      {r.title}
                    </h3>
                    <p style={{ color: "#57534E", fontSize: "0.92rem", fontWeight: 300, margin: 0 }}>
                      {r.body}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <OwnerForm onSubmitted={setReceipt} />
          </div>
        </section>
      )}
    </main>
  );
}
