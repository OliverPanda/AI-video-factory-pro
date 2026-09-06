const CACHE_TTL_MS = Number(process.env.WORKBENCH_CACHE_TTL_MS || 5000);

let _cached = null;
let _cacheKey = null;
let _cacheTimestamp = 0;

export function getCachedRouteContext(key) {
  const now = Date.now();
  if (_cached && _cacheKey === key && now - _cacheTimestamp < CACHE_TTL_MS) {
    return _cached;
  }
  return null;
}

export function setCachedRouteContext(key, value) {
  _cached = value;
  _cacheKey = key;
  _cacheTimestamp = Date.now();
}

export function invalidateRouteContextCache() {
  _cached = null;
  _cacheKey = null;
  _cacheTimestamp = 0;
}
