"use client";

import { upload } from "@vercel/blob/client";
import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties, type ReactNode } from "react";

/**
 * The listing editor.
 *
 * Follows `StatusControl`: PATCH, check the `ApiResponse` envelope, then `router.refresh()`
 * rather than mutating a local copy — the server is where a listing lives, and re-reading it is
 * what keeps two curators from seeing different answers.
 *
 * Two things worth knowing before changing it:
 *
 *   - **The whole gallery is submitted, always.** `writeChildren()` replaces images and
 *     neighbourhood rows wholesale rather than diffing them, so "the array you send is what the
 *     listing has" is the existing contract, not a shortcut taken here.
 *   - **Photos never pass through the app.** `upload()` talks to Blob directly using a token
 *     minted by `/api/admin/uploads`, which is where the role check lives.
 */

const AMENITIES = [
  "POOL",
  "GYM",
  "GARDEN",
  "LIFT",
  "PARKING",
  "SECURITY",
  "POWER",
  "STUDY",
] as const;

const HOOD_KINDS = [
  "TRANSIT",
  "WORK",
  "SCHOOL",
  "HEALTH",
  "SHOPPING",
  "DINING",
  "PARK",
] as const;

export interface ListingFormValues {
  slug: string;
  name: string;
  location: string;
  locality: string;
  tagline: string;
  story: string;
  description: string[];
  bhk: string;
  bhkNum: number;
  areaLabel: string;
  area: string;
  areaSqft: number;
  priceRupees: number;
  latitude: number;
  longitude: number;
  amenities: string[];
  hoodBlurb: string;
  heroImageUrl: string;
  videoUrl: string;
  floorplanUrl: string;
  floorplanNote: string;
  ownerEmail: string;
  weeklyViewingSlots: number;
  images: { url: string; alt: string }[];
  hood: { kind: string; name: string; distance: string }[];
}

const input: CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #DDD5C9",
  borderRadius: 2,
  background: "#FAF7F2",
  color: "#1C1917",
  fontFamily: "inherit",
  fontSize: "0.85rem",
};

const label: CSSProperties = {
  display: "block",
  fontSize: "0.7rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "#78716C",
  marginBottom: 4,
};

const button: CSSProperties = {
  padding: "8px 14px",
  border: "1px solid #DDD5C9",
  borderRadius: 2,
  background: "#FAF7F2",
  color: "#1C1917",
  fontFamily: "inherit",
  fontSize: "0.8rem",
  cursor: "pointer",
};

function Field({ children, hint, text }: { children: ReactNode; hint?: string; text: string }) {
  return (
    <label style={{ display: "block", marginBottom: 14 }}>
      <span style={label}>{text}</span>
      {children}
      {hint && (
        <span style={{ display: "block", fontSize: "0.7rem", color: "#78716C", marginTop: 4 }}>
          {hint}
        </span>
      )}
    </label>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section
      style={{
        border: "1px solid #E7E0D6",
        borderRadius: 3,
        padding: 20,
        marginBottom: 20,
        background: "#FFFDF9",
      }}
    >
      <h2
        style={{
          fontSize: "0.72rem",
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          color: "#A16207",
          margin: "0 0 16px",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

export function ListingForm({
  id,
  slug,
  initial,
}: {
  id: string;
  slug: string;
  initial: ListingFormValues;
}) {
  const router = useRouter();
  const [v, setV] = useState<ListingFormValues>(initial);
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof ListingFormValues>(key: K, value: ListingFormValues[K]) => {
    setV((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  async function uploadPhoto(file: File): Promise<string | null> {
    setUploading(true);
    setError(null);
    try {
      const blob = await upload(`properties/${slug}/${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/admin/uploads",
      });
      return blob.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload that file");
      return null;
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/admin/properties/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slug: v.slug,
          name: v.name,
          location: v.location,
          locality: v.locality,
          tagline: v.tagline,
          story: v.story,
          description: v.description.filter((p) => p.trim().length > 0),
          bhk: v.bhk,
          bhkNum: v.bhkNum,
          areaLabel: v.areaLabel,
          area: v.area,
          areaSqft: v.areaSqft,
          // Back to paise, and rounded rather than truncated — a price typed as 2.5 crore must
          // not land a paisa short because of a float.
          pricePaise: Math.round(v.priceRupees * 100),
          latitude: v.latitude,
          longitude: v.longitude,
          amenities: v.amenities,
          hoodBlurb: v.hoodBlurb,
          heroImageUrl: v.heroImageUrl,
          videoUrl: v.videoUrl,
          floorplanUrl: v.floorplanUrl,
          floorplanNote: v.floorplanNote,
          ownerEmail: v.ownerEmail,
          weeklyViewingSlots: v.weeklyViewingSlots,
          images: v.images.filter((i) => i.url.trim().length > 0),
          hood: v.hood.filter((h) => h.name.trim().length > 0),
        }),
      });
      const payload = (await res.json().catch(() => null)) as
        | { success: false; error: string }
        | { success: true }
        | null;

      if (!res.ok || !payload?.success) {
        setError(payload && !payload.success ? payload.error : "Could not save");
        return;
      }
      setSaved(true);
      startTransition(() => router.refresh());
    } catch {
      setError("Could not reach the server");
    } finally {
      setSaving(false);
    }
  }

  const busy = saving || uploading || pending;

  return (
    <div style={{ maxWidth: 760 }}>
      <Section title="Identity">
        <Field text="Name">
          <input style={input} value={v.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field text="URL" hint="Changing this breaks existing links and shortlists, which are stored by slug.">
          <input style={input} value={v.slug} onChange={(e) => set("slug", e.target.value)} />
        </Field>
        <Field text="Location" hint="As displayed, e.g. “Yadavanahalli, Hosur Road, Bangalore”.">
          <input
            style={input}
            value={v.location}
            onChange={(e) => set("location", e.target.value)}
          />
        </Field>
        <Field text="Locality" hint="The filterable half, e.g. “Yadavanahalli”.">
          <input
            style={input}
            value={v.locality}
            onChange={(e) => set("locality", e.target.value)}
          />
        </Field>
        <Field text="Owner email" hint="CC'd on every enquiry about this home. Blank means the team hears about it alone.">
          <input
            style={input}
            type="email"
            value={v.ownerEmail}
            onChange={(e) => set("ownerEmail", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Copy">
        <Field text="Tagline">
          <input style={input} value={v.tagline} onChange={(e) => set("tagline", e.target.value)} />
        </Field>
        <Field text="Story" hint="Also the blurb on the listing card, so keep it to two or three sentences.">
          <textarea
            style={{ ...input, minHeight: 90 }}
            value={v.story}
            onChange={(e) => set("story", e.target.value)}
          />
        </Field>
        <Field text="Description" hint="One paragraph per blank line.">
          <textarea
            style={{ ...input, minHeight: 180 }}
            value={v.description.join("\n\n")}
            onChange={(e) => set("description", e.target.value.split(/\n\s*\n/))}
          />
        </Field>
        <Field text="Neighbourhood blurb">
          <textarea
            style={{ ...input, minHeight: 80 }}
            value={v.hoodBlurb}
            onChange={(e) => set("hoodBlurb", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="The home">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Field text="Configuration">
            <input style={input} value={v.bhk} onChange={(e) => set("bhk", e.target.value)} />
          </Field>
          <Field text="Bedrooms (filterable)">
            <input
              style={input}
              type="number"
              value={v.bhkNum}
              onChange={(e) => set("bhkNum", Number(e.target.value))}
            />
          </Field>
          <Field text="Area label">
            <input
              style={input}
              value={v.areaLabel}
              onChange={(e) => set("areaLabel", e.target.value)}
            />
          </Field>
          <Field text="Area (displayed)">
            <input style={input} value={v.area} onChange={(e) => set("area", e.target.value)} />
          </Field>
          <Field text="Area (sqft, filterable)">
            <input
              style={input}
              type="number"
              value={v.areaSqft}
              onChange={(e) => set("areaSqft", Number(e.target.value))}
            />
          </Field>
          <Field text="Price (₹)" hint="Stored as paise; enter rupees.">
            <input
              style={input}
              type="number"
              value={v.priceRupees}
              onChange={(e) => set("priceRupees", Number(e.target.value))}
            />
          </Field>
          <Field text="Latitude">
            <input
              style={input}
              type="number"
              step="0.000001"
              value={v.latitude}
              onChange={(e) => set("latitude", Number(e.target.value))}
            />
          </Field>
          <Field text="Longitude">
            <input
              style={input}
              type="number"
              step="0.000001"
              value={v.longitude}
              onChange={(e) => set("longitude", Number(e.target.value))}
            />
          </Field>
          <Field text="Viewing slots per week">
            <input
              style={input}
              type="number"
              value={v.weeklyViewingSlots}
              onChange={(e) => set("weeklyViewingSlots", Number(e.target.value))}
            />
          </Field>
        </div>

        <span style={label}>Amenities</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
          {AMENITIES.map((a) => (
            <label key={a} style={{ fontSize: "0.8rem", display: "flex", gap: 6 }}>
              <input
                type="checkbox"
                checked={v.amenities.includes(a)}
                onChange={(e) =>
                  set(
                    "amenities",
                    e.target.checked
                      ? [...v.amenities, a]
                      : v.amenities.filter((x) => x !== a),
                  )
                }
              />
              {a}
            </label>
          ))}
        </div>
      </Section>

      <Section title="Photographs">
        <Field text="Hero image URL">
          <input
            style={input}
            value={v.heroImageUrl}
            onChange={(e) => set("heroImageUrl", e.target.value)}
          />
        </Field>
        <div style={{ marginBottom: 14 }}>
          <label style={{ ...button, display: "inline-block" }}>
            {uploading ? "Uploading…" : "Upload a hero photo"}
            <input
              type="file"
              accept="image/*"
              hidden
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const url = await uploadPhoto(file);
                if (url) set("heroImageUrl", url);
                e.target.value = "";
              }}
            />
          </label>
        </div>

        <span style={label}>Gallery</span>
        {v.images.map((img, i) => (
          <div
            key={`${img.url}-${i}`}
            style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 8 }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt=""
              style={{ width: 64, height: 48, objectFit: "cover", borderRadius: 2, flexShrink: 0 }}
            />
            <input
              style={{ ...input, flex: 1 }}
              value={img.alt}
              placeholder="Describe the photo"
              onChange={(e) => {
                const next = [...v.images];
                next[i] = { ...next[i], alt: e.target.value };
                set("images", next);
              }}
            />
            <button
              type="button"
              style={button}
              disabled={i === 0 || busy}
              onClick={() => {
                const next = [...v.images];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                set("images", next);
              }}
              aria-label="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              style={button}
              disabled={busy}
              onClick={() => set("images", v.images.filter((_, x) => x !== i))}
              aria-label="Remove"
            >
              ✕
            </button>
          </div>
        ))}
        <label style={{ ...button, display: "inline-block", marginTop: 6 }}>
          {uploading ? "Uploading…" : "Add gallery photos"}
          <input
            type="file"
            accept="image/*"
            multiple
            hidden
            disabled={busy}
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = "";
              const added: { url: string; alt: string }[] = [];
              for (const file of files) {
                const url = await uploadPhoto(file);
                if (url) added.push({ url, alt: "" });
              }
              if (added.length) set("images", [...v.images, ...added]);
            }}
          />
        </label>
      </Section>

      <Section title="Extras">
        <Field text="Video URL">
          <input
            style={input}
            value={v.videoUrl}
            onChange={(e) => set("videoUrl", e.target.value)}
          />
        </Field>
        <Field text="Floor plan URL" hint="An image, not a PDF — it renders in an <img>.">
          <input
            style={input}
            value={v.floorplanUrl}
            onChange={(e) => set("floorplanUrl", e.target.value)}
          />
        </Field>
        <Field text="Floor plan note">
          <input
            style={input}
            value={v.floorplanNote}
            onChange={(e) => set("floorplanNote", e.target.value)}
          />
        </Field>
      </Section>

      <Section title="Neighbourhood">
        {v.hood.map((place, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <select
              style={{ ...input, width: 130 }}
              value={place.kind}
              onChange={(e) => {
                const next = [...v.hood];
                next[i] = { ...next[i], kind: e.target.value };
                set("hood", next);
              }}
            >
              {HOOD_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <input
              style={{ ...input, flex: 1 }}
              value={place.name}
              placeholder="Name"
              onChange={(e) => {
                const next = [...v.hood];
                next[i] = { ...next[i], name: e.target.value };
                set("hood", next);
              }}
            />
            <input
              style={{ ...input, width: 190 }}
              value={place.distance}
              placeholder="10 min walk"
              onChange={(e) => {
                const next = [...v.hood];
                next[i] = { ...next[i], distance: e.target.value };
                set("hood", next);
              }}
            />
            <button
              type="button"
              style={button}
              disabled={busy}
              onClick={() => set("hood", v.hood.filter((_, x) => x !== i))}
              aria-label="Remove"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          style={button}
          disabled={busy}
          onClick={() => set("hood", [...v.hood, { kind: "TRANSIT", name: "", distance: "" }])}
        >
          Add a place
        </button>
      </Section>

      <div style={{ display: "flex", gap: 12, alignItems: "center", padding: "4px 0 40px" }}>
        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          style={{
            ...button,
            background: busy ? "#D6C9B4" : "#A16207",
            borderColor: busy ? "#D6C9B4" : "#A16207",
            color: "#FFFDF9",
            padding: "10px 22px",
            cursor: busy ? "not-allowed" : "pointer",
          }}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {saved && !error && <span style={{ fontSize: "0.8rem", color: "#3F6212" }}>Saved.</span>}
        {error && <span style={{ fontSize: "0.8rem", color: "#991B1B" }}>{error}</span>}
      </div>
    </div>
  );
}
