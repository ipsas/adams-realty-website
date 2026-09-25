import { describe, expect, it } from "vitest";
import { geocodeAddress } from "./geocode";

const respond = (body: unknown, status = 200) =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("geocodeAddress", () => {
  it("reads the first match's coordinates", async () => {
    const result = await geocodeAddress(
      "55 Trinity Ave SW, Atlanta, GA",
      respond({ result: { addressMatches: [{ coordinates: { x: -84.39, y: 33.749 } }] } }),
    );
    expect(result).toEqual({ lat: 33.749, lng: -84.39 });
  });

  it("returns null when nothing matches or the service fails", async () => {
    expect(await geocodeAddress("nowhere", respond({ result: { addressMatches: [] } }))).toBeNull();
    expect(await geocodeAddress("x", respond({}, 500))).toBeNull();
    const throwing = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    expect(await geocodeAddress("x", throwing)).toBeNull();
  });
});
