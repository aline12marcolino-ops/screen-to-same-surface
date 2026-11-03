import type { Category } from "./queue";

export type Sector = "publico" | "particular" | "nao_informado";

export type Place = {
  id: string;
  name: string;
  category: Category;
  sector: Sector;
  lat: number;
  lon: number;
  address: string | null;
  phone: string | null;
  hours: string | null;
  open24h: boolean;
  distanceKm?: number;
};

export const CATEGORY_LABEL: Record<Category, string> = {
  farmacia: "Farmácia",
  ama: "AMA",
  ubs: "UBS / Posto",
  clinica: "Clínica",
  hospital: "Hospital",
  upa: "UPA",
};

export const CATEGORY_COLOR: Record<Category, string> = {
  farmacia: "var(--cat-farmacia)",
  ama: "var(--cat-ama)",
  ubs: "var(--cat-ubs)",
  clinica: "var(--cat-clinica)",
  hospital: "var(--cat-hospital)",
  upa: "var(--cat-upa)",
};

export const CATEGORY_GLYPH: Record<Category, string> = {
  farmacia: "℞",
  ama: "A",
  ubs: "U",
  clinica: "C",
  hospital: "H",
  upa: "24",
};

type OsmEl = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export function classify(tags: Record<string, string>): Category | null {
  const n = (tags.name ?? "").toLowerCase();
  if (/\bupa\b|pronto atendimento/.test(n)) return "upa";
  if (/\bama\b|assist[eê]ncia m[eé]dica ambulatorial/.test(n)) return "ama";
  if (/\bubs\b|unidade b[aá]sica|posto de sa[uú]de|\besf\b/.test(n) || tags.healthcare === "centre") return "ubs";
  if (tags.amenity === "pharmacy" || tags.healthcare === "pharmacy") return "farmacia";
  if (tags.amenity === "hospital" || tags.healthcare === "hospital") return "hospital";
  if (tags.amenity === "clinic" || tags.amenity === "doctors" || tags.healthcare === "clinic" || tags.healthcare === "doctor")
    return "clinica";
  return null;
}

export function sectorOf(tags: Record<string, string>, cat: Category): Sector {
  const op = (tags["operator:type"] ?? "").toLowerCase();
  if (["public", "government", "public_sector"].includes(op)) return "publico";
  if (["private", "commercial", "business"].includes(op)) return "particular";
  if (cat === "ubs" || cat === "ama" || cat === "upa") return "publico";
  const s = `${tags.name ?? ""} ${tags.operator ?? ""}`.toLowerCase();
  if (/municipal|estadual|federal|\bsus\b|prefeitura|secretaria/.test(s)) return "publico";
  if (cat === "farmacia" && tags.brand) return "particular";
  return "nao_informado";
}

function addressOf(t: Record<string, string>): string | null {
  if (t["addr:full"]) return t["addr:full"];
  const street = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(", ");
  const parts = [street, t["addr:suburb"], t["addr:city"], t["addr:postcode"]].filter(Boolean);
  return parts.length ? parts.join(" — ") : null;
}

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

/** Real health facilities from OpenStreetMap around a point. */
export async function fetchPlaces(center: { lat: number; lon: number }, radiusM: number): Promise<Place[]> {
  const a = `(around:${radiusM},${center.lat},${center.lon})`;
  const q = `[out:json][timeout:25];(
    nwr["amenity"~"^(pharmacy|hospital|clinic|doctors)$"]${a};
    nwr["healthcare"~"^(centre|hospital|clinic|pharmacy|doctor)$"]${a};
  );out center tags 400;`;
  let lastErr: unknown;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(q) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { elements: OsmEl[] };
      const out: Place[] = [];
      const seen = new Set<string>();
      for (const el of json.elements) {
        const t = el.tags ?? {};
        if (!t.name) continue; // only real, named units
        const lat = el.lat ?? el.center?.lat;
        const lon = el.lon ?? el.center?.lon;
        if (lat == null || lon == null) continue;
        const cat = classify(t);
        if (!cat) continue;
        const key = `${t.name}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const hours = t.opening_hours ?? null;
        out.push({
          id: `${el.type[0]}${el.id}`,
          name: t.name,
          category: cat,
          sector: sectorOf(t, cat),
          lat,
          lon,
          address: addressOf(t),
          phone: t.phone ?? t["contact:phone"] ?? null,
          hours,
          open24h: hours === "24/7",
          distanceKm: haversineKm(center, { lat, lon }),
        });
      }
      return out.sort((x, y) => (x.distanceKm ?? 0) - (y.distanceKm ?? 0));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export async function geocode(query: string): Promise<{ lat: number; lon: number; label: string } | null> {
  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(query)}`,
  );
  const j = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (!j[0]) return null;
  return { lat: +j[0].lat, lon: +j[0].lon, label: j[0].display_name };
}
