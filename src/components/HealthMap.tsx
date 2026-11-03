import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { CATEGORY_COLOR, CATEGORY_GLYPH, type Place } from "@/lib/places";

type Props = {
  center: { lat: number; lon: number };
  user: { lat: number; lon: number } | null;
  places: Place[];
  selectedId: string | null;
  onSelect: (id: string) => void;
};

export default function HealthMap({ center, user, places, selectedId, onSelect }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current, { zoomControl: true }).setView([center.lat, center.lon], 14);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    map.current?.setView([center.lat, center.lon], map.current.getZoom());
  }, [center.lat, center.lon]);

  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clearLayers();
    if (user) {
      L.marker([user.lat, user.lon], {
        icon: L.divIcon({ className: "", html: '<div class="map-user-dot"></div>', iconSize: [18, 18] }),
      })
        .bindTooltip("Você está aqui")
        .addTo(g);
    }
    for (const p of places) {
      const sel = p.id === selectedId;
      L.marker([p.lat, p.lon], {
        icon: L.divIcon({
          className: "",
          html: `<div class="map-pin${sel ? " is-selected" : ""}" style="--pin:${CATEGORY_COLOR[p.category]}">${CATEGORY_GLYPH[p.category]}</div>`,
          iconSize: [30, 30],
          iconAnchor: [15, 15],
        }),
        zIndexOffset: sel ? 1000 : 0,
      })
        .bindTooltip(p.name)
        .on("click", () => onSelect(p.id))
        .addTo(g);
    }
  }, [places, selectedId, user, onSelect]);

  useEffect(() => {
    const p = places.find((x) => x.id === selectedId);
    if (p) map.current?.flyTo([p.lat, p.lon], Math.max(map.current.getZoom(), 16), { duration: 0.6 });
  }, [selectedId]);

  return <div ref={el} className="h-full w-full" />;
}
