import { AMENITY_LABEL, HOOD_LABEL } from "@/lib/content";
import type { PropertyDto } from "@/lib/dto";

/**
 * A standalone, printable brochure for a single home. Generated in the browser and handed over
 * as a Blob download — no server round-trip, and it keeps working offline once the page is open.
 */
export function buildBrochureHtml(cur: PropertyDto): string {
  const amenities = cur.amenities.map((a) => `<li>${AMENITY_LABEL[a]}</li>`).join("");
  const hood = cur.hood
    .map(
      (place) =>
        `<tr><td>${place.name}</td><td style="color:#6b6b6b">${HOOD_LABEL[place.kind]}</td><td style="text-align:right;white-space:nowrap">${place.distance}</td></tr>`,
    )
    .join("");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${cur.name} — Nivasa</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=Josefin+Sans:wght@300;400;500&display=swap" rel="stylesheet">
<style>@page{margin:14mm;}*{box-sizing:border-box;}body{margin:0;font-family:"Josefin Sans",system-ui,sans-serif;color:#1C1917;background:#FAF7F2;line-height:1.6;}
.wrap{max-width:820px;margin:0 auto;padding:32px 28px 60px;}h1,h2,h3{font-family:"Cinzel",serif;font-weight:600;}
.brand{font-family:"Cinzel",serif;letter-spacing:0.2em;font-weight:700;font-size:1.2rem;}.brand span{color:#A16207;}
.hero{width:100%;height:340px;object-fit:cover;border-radius:8px;margin:18px 0;background:#1C1917;}
.eyebrow{font-size:0.7rem;letter-spacing:0.26em;text-transform:uppercase;color:#A16207;font-weight:600;margin:26px 0 4px;}
.specs{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:10px 0;}.specs div{border-top:1px solid #E4DCD0;padding-top:8px;}.specs p{margin:0;}.specs .k{font-size:0.66rem;letter-spacing:0.1em;text-transform:uppercase;color:#8a8580;}.specs .v{font-family:"Cinzel",serif;font-size:1.05rem;}
table{width:100%;border-collapse:collapse;font-size:0.88rem;}td{padding:8px 0;border-top:1px solid #E4DCD0;}ul{columns:2;font-size:0.9rem;color:#44403C;padding-left:18px;}
.note{font-size:0.7rem;color:#9a938c;}@media print{body{background:#fff;}.hero{height:300px;}.noprint{display:none;}}</style></head><body><div class="wrap">
<div style="display:flex;justify-content:space-between;align-items:center;"><span class="brand">NAMA<span>NIVASA</span></span><span class="note">Curated homes · Bangalore</span></div>
<img class="hero" src="${cur.heroImageUrl}" alt="${cur.name}">
<p class="eyebrow" style="margin-top:4px">${cur.location}</p><h1 style="font-size:2rem;margin:2px 0 6px;">${cur.name}</h1>
<p style="font-family:Cinzel,serif;font-style:italic;color:#A16207;font-size:1.1rem;margin:0 0 10px;">${cur.tagline}</p>
<p style="color:#44403C;font-weight:300;">${cur.story}</p>
<div class="specs"><div><p class="k">Config</p><p class="v">${cur.bhk}</p></div><div><p class="k">${cur.areaLabel}</p><p class="v">${cur.area}</p></div><div><p class="k">Locality</p><p class="v">${cur.locality}</p></div></div>
<p class="note" style="border-top:2px solid #1C1917;border-bottom:2px solid #1C1917;padding:14px 0;margin:14px 0;">Price on request · zero brokerage. Ask us for the full cost breakdown.</p>
${amenities ? `<p class="eyebrow">Amenities</p><ul>${amenities}</ul>` : ""}
${hood ? `<p class="eyebrow">Neighbourhood</p><p style="color:#44403C;font-weight:300;margin:4px 0 8px;">${cur.hoodBlurb}</p><table>${hood}</table>` : ""}
<p class="eyebrow">Enquire</p><p style="margin:4px 0;">This home is listed and managed directly by the owner. Arrange a visit through Nivasa — no brokerage, no middlemen.</p>
<p class="note" style="margin-top:26px;border-top:1px solid #E4DCD0;padding-top:14px;">© 2026 Nivasa. Figures indicative. Print this page to save as PDF.</p>
</div></body></html>`;
}

export function downloadBrochure(cur: PropertyDto): boolean {
  try {
    const blob = new Blob([buildBrochureHtml(cur)], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nivasa-${cur.slug}-brochure.html`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {
    return false;
  }
}

export function shareOnWhatsApp(cur: PropertyDto): void {
  const url = `${window.location.origin}/homes/${cur.slug}`;
  const text = `Take a look at ${cur.name} on Nivasa — ${cur.bhk} in ${cur.locality}. Curated, zero brokerage.`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text + " " + url)}`, "_blank", "noopener");
}
