"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap, Marker } from "leaflet";

import { MAP_PIN } from "@/lib/graphics";

import { useNivasa } from "./nivasa-store";
import { Eyebrow, SERIF } from "./ui";

import "leaflet/dist/leaflet.css";

export function MapView() {
  const s = useNivasa();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<Record<string, Marker>>({});
  // Popup buttons read the latest handler through a ref so the map is built once.
  const goToPropertyRef = useRef(s.goToProperty);
  useEffect(() => {
    goToPropertyRef.current = s.goToProperty;
  }, [s.goToProperty]);

  // The catalogue is server-rendered, so it is stable for the life of this view; the map is
  // built once from it rather than re-created whenever React re-renders.
  const propertiesRef = useRef(s.properties);
  useEffect(() => {
    propertiesRef.current = s.properties;
  }, [s.properties]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      const el = containerRef.current;
      if (cancelled || !el || mapRef.current) return;

      const map = L.map(el, { scrollWheelZoom: false, zoomControl: true }).setView(
        [12.955, 77.66],
        12,
      );
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      const bounds: [number, number][] = [];
      for (const p of propertiesRef.current) {
        const icon = L.divIcon({
          className: "nv-pin",
          html: MAP_PIN,
          iconSize: [32, 40],
          iconAnchor: [16, 40],
          popupAnchor: [0, -36],
        });
        const marker = L.marker([p.latitude, p.longitude], { icon, title: p.name }).addTo(map);
        marker.bindPopup(
          `<div style="min-width:172px"><div style="font-family:Cinzel,Georgia,serif;font-weight:600;margin:2px 0;color:#1C1917">${p.name}</div>` +
            `<div style="color:#78716C;font-size:0.8rem;margin-bottom:10px">${p.location}</div>` +
            `<button data-view="${p.slug}" style="width:100%;padding:9px;background:#1C1917;color:#fff;border:none;border-radius:2px;cursor:pointer;font-family:inherit;font-size:0.7rem;letter-spacing:0.1em;text-transform:uppercase">View home</button></div>`,
        );
        markersRef.current[p.slug] = marker;
        bounds.push([p.latitude, p.longitude]);
      }

      if (bounds.length) map.fitBounds(bounds, { padding: [64, 64], maxZoom: 14 });

      map.on("popupopen", (e) => {
        const btn = e.popup.getElement()?.querySelector<HTMLButtonElement>("[data-view]");
        if (btn) {
          btn.onclick = () => goToPropertyRef.current(btn.getAttribute("data-view") ?? "");
        }
      });

      mapRef.current = map;
      // The container is sized by CSS after mount; nudge Leaflet to re-measure.
      setTimeout(() => map.invalidateSize(), 220);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      markersRef.current = {};
    };
  }, []);

  const focus = (slug: string) => {
    const marker = markersRef.current[slug];
    if (mapRef.current && marker) {
      mapRef.current.flyTo(marker.getLatLng(), 15, { duration: 0.8 });
      marker.openPopup();
    }
  };

  return (
    <main>
      <section style={{ padding: "30px 24px 8px" }}>
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "space-between",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <div>
            <Eyebrow>On the Map</Eyebrow>
            <h1
              style={{
                fontFamily: SERIF,
                fontWeight: 600,
                fontSize: "clamp(1.9rem,3.6vw,2.6rem)",
                margin: "8px 0 0",
                color: "#1C1917",
              }}
            >
              Where these homes are
            </h1>
          </div>
          <button
            className="nv-btn-ghost-light"
            onClick={s.goHome}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "none",
              border: "1px solid #DDD5C9",
              borderRadius: 2,
              padding: "9px 18px",
              color: "#1C1917",
              cursor: "pointer",
              fontSize: "0.76rem",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontFamily: "inherit",
            }}
          >
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Back to list
          </button>
        </div>
      </section>

      <section style={{ padding: "22px 24px 70px" }}>
        <div
          data-maplayout
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "330px 1fr",
            gap: 24,
          }}
        >
          <div data-maplist style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {s.properties.map((p) => (
              <button
                key={p.slug}
                className="nv-maprow"
                onClick={() => focus(p.slug)}
                style={{
                  textAlign: "left",
                  background: "#fff",
                  border: "1px solid #ECE5DB",
                  borderRadius: 6,
                  padding: "18px 20px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <p style={{ fontFamily: SERIF, fontWeight: 600, fontSize: "1.05rem", margin: "0 0 4px", color: "#1C1917" }}>
                  {p.name}
                </p>
                <p style={{ color: "#78716C", fontSize: "0.82rem", margin: 0 }}>{p.location}</p>
              </button>
            ))}
            <p style={{ fontSize: "0.7rem", color: "#A8A29E", margin: "2px 0 0", lineHeight: 1.5 }}>
              Approximate localities shown — exact address is shared once a visit is confirmed.
            </p>
          </div>

          <div
            ref={containerRef}
            style={{
              height: "64vh",
              minHeight: 460,
              borderRadius: 8,
              overflow: "hidden",
              border: "1px solid #ECE5DB",
              background: "#ECE5DB",
            }}
          />
        </div>
      </section>
    </main>
  );
}
