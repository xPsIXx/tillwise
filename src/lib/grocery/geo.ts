export type GeoFix = { lat: number; lon: number; accuracy: number };

export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function stillAtShop(
  lat: number,
  lon: number,
  shopLat: number | null | undefined,
  shopLon: number | null | undefined,
  withinM = 250,
): boolean {
  if (shopLat == null || shopLon == null) return false;
  return distanceM(lat, lon, shopLat, shopLon) <= withinM;
}

export function getBrowserLocation(): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("This browser has no location. Type the shop instead."));
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      reject(new Error("Location needs HTTPS (or localhost). Type the shop if this phone is on http."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) reject(new Error("Location was denied. Type the shop instead."));
        else if (err.code === err.TIMEOUT) reject(new Error("Location timed out. Try again or type the shop."));
        else reject(new Error("Could not get location. Type the shop instead."));
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 20_000 },
    );
  });
}

export function shortShopName(name: string | null | undefined): string {
  return name?.split(",")[0]?.trim() || "";
}
