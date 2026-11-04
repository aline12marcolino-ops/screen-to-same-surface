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
  const n = (tags["name"] ?? "").toLowerCase();
  if (/\bupa\b|pronto atendimento/.test(n)) return "upa";
  if (/\bama\b|assist[eê]ncia m[eé]dica ambulatorial/.test(n)) return "ama";
  if (/\bubs\b|unidade b[aá]sica|posto de sa[uú]de|\besf\b/.test(n) || tags["healthcare"] === "centre") return "ubs";
  if (tags["amenity"] === "pharmacy" || tags["healthcare"] === "pharmacy") return "farmacia";
  if (tags["amenity"] === "hospital" || tags["healthcare"] === "hospital") return "hospital";
  if (tags["amenity"] === "clinic" || tags["amenity"] === "doctors" || tags["healthcare"] === "clinic" || tags["healthcare"] === "doctor")
    return "clinica";
  return null;
}

export function sectorOf(tags: Record<string, string>, cat: Category): Sector {
  const op = (tags["operator:type"] ?? "").toLowerCase();
  if (["public", "government", "public_sector"].includes(op)) return "publico";
  if (["private", "commercial", "business"].includes(op)) return "particular";
  if (cat === "ubs" || cat === "ama" || cat === "upa") return "publico";
  const s = `${tags["name"] ?? ""} ${tags["operator"] ?? ""}`.toLowerCase();
  if (/municipal|estadual|federal|\bsus\b|prefeitura|secretaria/.test(s)) return "publico";
  if (cat === "farmacia" && tags["brand"]) return "particular";
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

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

export function parseElements(elements: OsmEl[], center: { lat: number; lon: number }): Place[] {
  const out: Place[] = [];
  const seen = new Set<string>();
  for (const el of elements) {
    const t = el.tags ?? {};
    if (!t["name"]) continue; // only real, named units
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (lat == null || lon == null) continue;
    const cat = classify(t);
    if (!cat) continue;
    const key = `${t["name"]}|${lat.toFixed(4)}|${lon.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hours = t["opening_hours"] ?? null;
    out.push({
      id: `${el.type[0]}${el.id}`,
      name: t["name"],
      category: cat,
      sector: sectorOf(t, cat),
      lat,
      lon,
      address: addressOf(t),
      phone: t["phone"] ?? t["contact:phone"] ?? null,
      hours,
      open24h: hours === "24/7",
      distanceKm: haversineKm(center, { lat, lon }),
    });
  }
  return out.sort((x, y) => (x.distanceKm ?? 0) - (y.distanceKm ?? 0));
}

async function queryEndpoint(url: string, q: string, signal: AbortSignal): Promise<OsmEl[]> {
  const res = await fetch(url, { method: "POST", signal, body: "data=" + encodeURIComponent(q) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { elements?: OsmEl[]; remark?: string };
  // Overpass reports timeouts/overload as HTTP 200 with a "remark" — not a real empty result.
  if (!Array.isArray(json.elements) || (json.remark && /error|timed out|runtime/i.test(json.remark))) {
    throw new Error(json.remark ?? "Invalid Overpass response");
  }
  return json.elements;
}

const cacheKey = (c: { lat: number; lon: number }, r: number) => `places:${c.lat.toFixed(3)},${c.lon.toFixed(3)}:${r}`;

function readCache(key: string): Place[] | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    return raw ? (JSON.parse(raw) as { places: Place[] }).places : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, places: Place[]) {
  try {
    localStorage.setItem(key, JSON.stringify({ places, at: Date.now() }));
  } catch {
    /* storage full or unavailable */
  }
}

/** Last saved results for this area, shown instantly while fresh data loads. */
export function cachedPlaces(center: { lat: number; lon: number }, radiusM: number): Place[] | null {
  return readCache(cacheKey(center, radiusM));
}

export type PlacesResult = { places: Place[]; fromCache: boolean };

/** Delay before the Nominatim fallback starts racing the Overpass mirrors. */
export const FALLBACK_DELAY_MS = 2500;

/** Real health facilities from OpenStreetMap around a point. Races all Overpass mirrors and (after a short delay) Nominatim; first non-empty answer wins. Falls back to the last saved result for this area. */
export async function fetchPlaces(center: { lat: number; lon: number }, radiusM: number): Promise<PlacesResult> {
  const a = `(around:${radiusM},${center.lat},${center.lon})`;
  const q = `[out:json][timeout:10];(
    nwr["amenity"~"^(pharmacy|hospital|clinic|doctors)$"]${a};
    nwr["healthcare"~"^(centre|hospital|clinic|pharmacy|doctor)$"]${a};
  );out center tags 400;`;
  const key = cacheKey(center, radiusM);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  let done = false;
  const overpass = Promise.any(ENDPOINTS.map((u) => queryEndpoint(u, q, ctrl.signal))).then((els) => parseElements(els, center));
  const nominatim = sleep(FALLBACK_DELAY_MS).then(async () => {
    if (done) throw new Error("not needed");
    const places = await fetchPlacesNominatim(center, radiusM, () => done);
    if (!places.length) throw new Error("empty");
    return places;
  });
  try {
    const places = await Promise.any([overpass, nominatim]);
    done = true;
    writeCache(key, places);
    return { places, fromCache: false };
  } catch (e) {
    const cached = readCache(key);
    if (cached) return { places: cached, fromCache: true };
    throw e;
  } finally {
    done = true;
    clearTimeout(timer);
    ctrl.abort();
  }
}

type NomEl = {
  osm_type: string;
  osm_id: number;
  lat: string;
  lon: string;
  name?: string;
  type?: string;
  extratags?: Record<string, string> | null;
  address?: Record<string, string>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fallback: same OpenStreetMap data via Nominatim, bounded to the search area (1 request/second per usage policy). */
export async function fetchPlacesNominatim(center: { lat: number; lon: number }, radiusM: number, cancelled: () => boolean = () => false): Promise<Place[]> {
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  const viewbox = `${center.lon - dLon},${center.lat + dLat},${center.lon + dLon},${center.lat - dLat}`;
  const els: OsmEl[] = [];
  let ok = 0;
  for (const [i, amenity] of ["pharmacy", "hospital", "clinic", "doctors"].entries()) {
    if (i) await sleep(1100);
    if (cancelled()) break;
    const params = new URLSearchParams({ format: "jsonv2", amenity, viewbox, bounded: "1", limit: "50", extratags: "1", addressdetails: "1", countrycodes: "br" });
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const list = (await res.json()) as NomEl[];
      ok++;
      for (const n of list) {
        const a = n.address ?? {};
        const tags: Record<string, string> = { ...(n.extratags ?? {}), amenity };
        if (n.name) tags["name"] = n.name;
        if (a["road"]) tags["addr:street"] = a["road"];
        if (a["house_number"]) tags["addr:housenumber"] = a["house_number"];
        const suburb = a["suburb"] ?? a["city_district"];
        if (suburb) tags["addr:suburb"] = suburb;
        if (a["city"] ?? a["town"]) tags["addr:city"] = (a["city"] ?? a["town"])!;
        if (a["postcode"]) tags["addr:postcode"] = a["postcode"];
        els.push({ type: n.osm_type, id: n.osm_id, lat: +n.lat, lon: +n.lon, tags });
      }
    } catch {
      /* try next category */
    }
  }
  if (!ok) throw new Error("Nominatim unavailable");
  return parseElements(els, center).filter((p) => (p.distanceKm ?? 0) <= radiusM / 1000);
}

export type GeoResult = { lat: number; lon: number; label: string };

/** Up to 6 distinct matches (e.g. same street name in different neighborhoods/cities), nearby ones first. */
const STREET_PREFIX = /^\s*(rua|r\.|avenida|av\.?|alameda|al\.|travessa|tv\.|estrada|rodovia|pra[cç]a|largo|viela)\b/i;

/** Searches what was typed and, when no street type was given, also "Rua …" so streets like "santana, 55" appear. */
export async function geocodeAll(query: string, near?: { lat: number; lon: number }): Promise<GeoResult[]> {
  const first = await geocodeOnce(query, near);
  if (!first.length) return fuzzyGeocode(query, near);
  if (STREET_PREFIX.test(query)) return first;
  await sleep(1100); // Nominatim: 1 request/second
  const streets = await geocodeOnce(`Rua ${query.trim()}`, near).catch(() => []);
  const seen = new Set<string>();
  // Exact street-name matches first, then the rest.
  const all = [...streets.slice(0, 4), ...first, ...streets.slice(4)].filter((r) => !seen.has(r.label) && seen.add(r.label));
  return all.slice(0, 8);
}

/** Small typos ("andreia" for "Andrea"): retry with fewer words of the name, keeping the city. */
async function fuzzyGeocode(query: string, near?: { lat: number; lon: number }): Promise<GeoResult[]> {
  const [name = "", ...rest] = query.split(",");
  const city = rest.map((s) => s.trim()).filter((s) => s && !/^\d+$/.test(s)).join(", ");
  const words = name.replace(STREET_PREFIX, "").trim().split(/\s+/).filter(Boolean);
  const tries: string[] = [];
  if (words.length > 1) tries.push(words.slice(1).join(" "));
  const longest = [...words].sort((a, b) => b.length - a.length)[0];
  if (longest && longest.length >= 5 && !tries.includes(longest)) tries.push(longest);
  for (const t of tries) {
    await sleep(1100);
    const r = await geocodeOnce(city ? `${t}, ${city}` : t, near).catch(() => []);
    if (r.length) return r;
  }
  return [];
}

async function geocodeOnce(query: string, near?: { lat: number; lon: number }): Promise<GeoResult[]> {
  const params = new URLSearchParams({ format: "json", limit: "8", countrycodes: "br", q: query.trim() });
  if (near) params.set("viewbox", `${near.lon - 0.25},${near.lat + 0.25},${near.lon + 0.25},${near.lat - 0.25}`);
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Geocoding HTTP ${res.status}`);
  const j = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  const seen = new Set<string>();
  const out: GeoResult[] = [];
  for (const r of j) {
    const label = r.display_name.split(", ").filter((s) => !/^(Brasil|Região|\d{5}-?\d{3}$)/.test(s)).join(", ");
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ lat: +r.lat, lon: +r.lon, label });
  }
  return out.slice(0, 6);
}

export async function geocode(query: string, near?: { lat: number; lon: number }): Promise<{ lat: number; lon: number; label: string } | null> {
  const params = new URLSearchParams({ format: "json", limit: "1", countrycodes: "br", q: query.trim() });
  // Prefer the current map area without preventing explicit searches elsewhere.
  if (near) {
    params.set("viewbox", `${near.lon - 0.25},${near.lat + 0.25},${near.lon + 0.25},${near.lat - 0.25}`);
  }
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Geocoding HTTP ${res.status}`);
  const j = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  if (!j[0]) return null;
  return { lat: +j[0].lat, lon: +j[0].lon, label: j[0].display_name };
}
