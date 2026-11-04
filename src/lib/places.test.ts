import { afterEach, describe, expect, it, vi } from "vitest";
import { geocode } from "./places";

afterEach(() => vi.unstubAllGlobals());

describe("location search", () => {
  it("biases Santana toward the current São Paulo map area", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ lat: "-23.4993210", lon: "-46.6289326", display_name: "Santana, São Paulo, Brasil" }],
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await geocode("santana", { lat: -23.5505, lon: -46.6333 });
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error("Location search did not request geocoding");
    const url = new URL(call[0]);
    expect(url.searchParams.get("viewbox")).toBe("-46.8833,-23.3005,-46.3833,-23.8005");
    expect(url.searchParams.has("bounded")).toBe(false);
    expect(result?.lat).toBe(-23.499321);
  });

  it("reports unavailable geocoding instead of treating it as no results", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    await expect(geocode("santana")).rejects.toThrow("Geocoding HTTP 429");
  });

  it("returns null when no location matches", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [] }));
    expect(await geocode("bairro inexistente")).toBeNull();
  });
});
describe("establishment loading fallback", () => {
  it("uses OpenStreetMap search when the map servers fail", async () => {
    const { fetchPlaces } = await import("./places");
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("interpreter")) return { ok: false, status: 504 };
      const amenity = new URL(url).searchParams.get("amenity");
      return {
        ok: true,
        json: async () => (amenity === "pharmacy"
          ? [{ osm_type: "way", osm_id: 618167209, lat: "-23.4993", lon: "-46.6289", name: "Droga Raia", extratags: { opening_hours: "24/7" }, address: { road: "Rua Voluntários da Pátria", city_district: "Santana" } }]
          : []),
      };
    }));
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 500 });
    const r = await fetchPlaces({ lat: -23.4993, lon: -46.6289 }, 2000);
    vi.useRealTimers();
    expect(r.fromCache).toBe(false);
    expect(r.places).toHaveLength(1);
    expect(r.places[0]?.id).toBe("w618167209");
    expect(r.places[0]?.open24h).toBe(true);
  }, 20000);
});

describe("street search with typos", () => {
  it("finds Rua Andrea Del Castagno when typed as 'andreia'", async () => {
    const { geocodeAll } = await import("./places");
    vi.stubGlobal("fetch", vi.fn(async (u: string) => {
      const q = new URL(u).searchParams.get("q") ?? "";
      return { ok: true, json: async () => (/^del castagno/i.test(q) ? [{ lat: "-23.5", lon: "-46.68", display_name: "Rua Andrea Del Castagno, Limão, São Paulo, Brasil" }] : []) };
    }));
    const r = await geocodeAll("rua andreia del castagno, são paulo");
    expect(r[0]?.label).toBe("Rua Andrea Del Castagno, Limão, São Paulo");
  }, 10000);
});
