"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";

import { MAP_PIN } from "@/lib/graphics";

import "leaflet/dist/leaflet.css";

/**
 * The one home, on its own map. `components/map-view.tsx` is the whole collection; this is the
 * detail page's answer to "where is this, exactly" — and the answer is deliberately *not* exact.
 * The pin sits inside a locality-sized circle for the same reason the list view carries the
 * disclaimer: the street address is shared once a visit is confirmed, not before.
 */
export function PropertyMap({
  latitude,
  longitude,
  name,
}: {
  latitude: number;
  longitude: number;
  name: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      const el = containerRef.current;
      if (cancelled || !el || mapRef.current) return;

      // Scroll wheel off: this map sits mid-article, and a wheel that zooms instead of scrolling
      // traps a visitor on their way to the booking card.
      const map = L.map(el, { scrollWheelZoom: false, zoomControl: true }).setView(
        [latitude, longitude],
        15,
      );
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
        maxZoom: 19,
      }).addTo(map);

      // Dashed and deliberately legible: the caption under the map claims this is a locality
      // rather than an address, and a hairline at 0.6 opacity over beige tiles says nothing.
      L.circle([latitude, longitude], {
        radius: 450,
        color: "#8A5206",
        weight: 2,
        opacity: 0.95,
        dashArray: "6 5",
        fillColor: "#C99A3F",
        fillOpacity: 0.18,
      }).addTo(map);

      L.marker([latitude, longitude], {
        icon: L.divIcon({
          className: "nv-pin",
          html: MAP_PIN,
          iconSize: [32, 40],
          iconAnchor: [16, 40],
        }),
        title: name,
        keyboard: false,
      }).addTo(map);

      mapRef.current = map;
      // The container is sized by CSS after mount; nudge Leaflet to re-measure.
      setTimeout(() => map.invalidateSize(), 220);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Navigating between homes keeps this component mounted, so the map is rebuilt per listing
    // rather than left pointing at the previous one.
  }, [latitude, longitude, name]);

  return (
    <div
      ref={containerRef}
      className="nv-map-dark"
      // `group`, not `img` — `img` would make the subtree presentational and hide Leaflet's own
      // zoom buttons, which are focusable.
      role="group"
      aria-label={`Map showing the approximate location of ${name}`}
      style={{
        height: 340,
        borderRadius: 6,
        overflow: "hidden",
        border: "1px solid #2e2825",
        background: "#1F1B18",
      }}
    />
  );
}
