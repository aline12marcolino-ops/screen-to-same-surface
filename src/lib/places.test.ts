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