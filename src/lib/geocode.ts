/**
 * Address → coordinates using the free U.S. Census Bureau geocoder (no API
 * key). Used for listings entered by hand; MLS feeds already carry lat/lng.
 * Returns null on any failure — callers fall back to manual coordinates.
 */
export async function geocodeAddress(
  address: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ lat: number; lng: number } | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      result?: { addressMatches?: { coordinates?: { x?: number; y?: number } }[] };
    };
    const c = json.result?.addressMatches?.[0]?.coordinates;
    if (typeof c?.x !== "number" || typeof c?.y !== "number") return null;
    return { lat: c.y, lng: c.x };
  } catch {
    return null;
  }
}
