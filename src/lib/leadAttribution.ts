// src/lib/leadAttribution.ts
// Shared B2B lead attribution capture, persistence, and form-sync helpers.

export const ATTR_STORAGE_KEY = 'fiore_ads_attr';

export const UTM_PARAMS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const;

export const ATTR_URL_PARAMS = [
  'gclid',
  ...UTM_PARAMS,
] as const;

export const ATTR_KEYS = [
  'gclid',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'landing_page',
] as const;

export type UtmParam = (typeof UTM_PARAMS)[number];
export type AttributionKey = (typeof ATTR_KEYS)[number];

export interface LeadAttribution {
  gclid: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  utm_term: string;
  utm_content: string;
  landing_page: string;
}

export const ATTR_INPUT_IDS: Record<AttributionKey, string> = {
  gclid: 'ads-f-gclid',
  utm_source: 'ads-f-utm-source',
  utm_medium: 'ads-f-utm-medium',
  utm_campaign: 'ads-f-utm-campaign',
  utm_term: 'ads-f-utm-term',
  utm_content: 'ads-f-utm-content',
  landing_page: 'ads-f-landing-page',
};

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LocationLike {
  href?: string;
  search?: string;
}

export interface InputElementLike {
  value: string;
}

export interface DocumentLike {
  getElementById(id: string): InputElementLike | null;
}

export interface AttributionEnv {
  getStorage?: () => StorageLike | null | undefined;
  getLocation?: () => LocationLike | null | undefined;
  getDocument?: () => DocumentLike | null | undefined;
}

export function emptyAttribution(): LeadAttribution {
  return {
    gclid: '',
    utm_source: '',
    utm_medium: '',
    utm_campaign: '',
    utm_term: '',
    utm_content: '',
    landing_page: '',
  };
}

export function normalizeAttribution(input: unknown): LeadAttribution {
  const base = emptyAttribution();
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    for (const key of ATTR_KEYS) {
      if (typeof record[key] === 'string') {
        base[key] = record[key];
      }
    }
  }
  return base;
}

/**
 * Pure attribution transition rule per page load:
 * - landing_page is captured once on first session entry and never cleared on gclid change.
 * - If URL has a non-empty gclid that differs from stored.gclid (including empty -> new gclid),
 *   treat as a NEW click: set gclid from URL, set each utm_* from current URL if present+non-empty
 *   or "" otherwise (clearing prior campaign UTMs).
 * - Otherwise (no gclid in URL, empty gclid, or same gclid as stored), preserve stored values
 *   and update only params present+non-empty in current URL.
 */
export function computeNextAttribution(
  storedInput: Partial<LeadAttribution> | null | undefined,
  locationLike: LocationLike
): LeadAttribution {
  const stored = normalizeAttribution(storedInput);
  const href = typeof locationLike?.href === 'string' ? locationLike.href : '';
  const search = typeof locationLike?.search === 'string' ? locationLike.search : '';

  const landing_page = stored.landing_page !== '' ? stored.landing_page : href;

  const params = new URLSearchParams(search);
  const rawGclid = params.get('gclid');
  const urlGclid = rawGclid !== null && rawGclid !== '' ? rawGclid : '';

  if (urlGclid !== '' && urlGclid !== stored.gclid) {
    const next: LeadAttribution = {
      gclid: urlGclid,
      utm_source: '',
      utm_medium: '',
      utm_campaign: '',
      utm_term: '',
      utm_content: '',
      landing_page,
    };
    for (const utm of UTM_PARAMS) {
      const val = params.get(utm);
      next[utm] = val !== null && val !== '' ? val : '';
    }
    return next;
  }

  const next: LeadAttribution = {
    ...stored,
    landing_page,
  };
  for (const utm of UTM_PARAMS) {
    const val = params.get(utm);
    if (val !== null && val !== '') {
      next[utm] = val;
    }
  }
  return next;
}

export function createAttributionController(defaultEnv: AttributionEnv = {}) {
  let memoryFallback: LeadAttribution | null = null;
  let storageWriteFailed = false;

  function resolveStorage(env?: AttributionEnv): StorageLike | null | undefined {
    if (env?.getStorage) {
      return env.getStorage();
    }
    if (defaultEnv.getStorage) {
      return defaultEnv.getStorage();
    }
    if (typeof window !== 'undefined') {
      return window.sessionStorage;
    }
    return null;
  }

  function resolveLocation(env?: AttributionEnv): LocationLike {
    if (env?.getLocation) {
      return env.getLocation() || {};
    }
    if (defaultEnv.getLocation) {
      return defaultEnv.getLocation() || {};
    }
    if (typeof window !== 'undefined' && window.location) {
      return {
        href: window.location.href || '',
        search: window.location.search || '',
      };
    }
    return {};
  }

  function resolveDocument(env?: AttributionEnv): DocumentLike | null | undefined {
    if (env?.getDocument) {
      return env.getDocument();
    }
    if (defaultEnv.getDocument) {
      return defaultEnv.getDocument();
    }
    if (typeof document !== 'undefined') {
      return document as unknown as DocumentLike;
    }
    return null;
  }

  function readStoredAttribution(env?: AttributionEnv): LeadAttribution {
    try {
      const storage = resolveStorage(env);
      if (!storage) {
        return memoryFallback ? normalizeAttribution(memoryFallback) : emptyAttribution();
      }
      const raw = storage.getItem(ATTR_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return normalizeAttribution(parsed);
      }
      if (storageWriteFailed && memoryFallback) {
        return normalizeAttribution(memoryFallback);
      }
      return emptyAttribution();
    } catch {
      return memoryFallback ? normalizeAttribution(memoryFallback) : emptyAttribution();
    }
  }

  function captureAttribution(env?: AttributionEnv): LeadAttribution {
    const stored = readStoredAttribution(env);
    const loc = resolveLocation(env);
    const next = computeNextAttribution(stored, loc);

    memoryFallback = normalizeAttribution(next);
    try {
      const storage = resolveStorage(env);
      if (storage) {
        storage.setItem(ATTR_STORAGE_KEY, JSON.stringify(next));
        storageWriteFailed = false;
      } else {
        storageWriteFailed = true;
      }
    } catch {
      storageWriteFailed = true;
    }

    return normalizeAttribution(next);
  }

  function syncAttributionInputs(env?: AttributionEnv): LeadAttribution {
    const attr = readStoredAttribution(env);
    try {
      const doc = resolveDocument(env);
      if (doc) {
        for (const key of ATTR_KEYS) {
          const el = doc.getElementById(ATTR_INPUT_IDS[key]);
          if (el) {
            el.value = attr[key] || '';
          }
        }
      }
    } catch {
      // Ignore DOM access errors; still return normalized attribution
    }
    return attr;
  }

  function getAttributionForSubmit(env?: AttributionEnv): LeadAttribution {
    const attr = syncAttributionInputs(env);
    const out = emptyAttribution();
    let doc: DocumentLike | null | undefined = null;
    try {
      doc = resolveDocument(env);
    } catch {
      doc = null;
    }
    for (const key of ATTR_KEYS) {
      const el = doc ? doc.getElementById(ATTR_INPUT_IDS[key]) : null;
      out[key] = el && typeof el.value === 'string' ? el.value : (attr[key] ?? '');
    }
    return out;
  }

  function resetMemoryFallback(): void {
    memoryFallback = null;
    storageWriteFailed = false;
  }

  return {
    readStoredAttribution,
    captureAttribution,
    syncAttributionInputs,
    getAttributionForSubmit,
    resetMemoryFallback,
  };
}

const defaultController = createAttributionController();

export const readStoredAttribution = defaultController.readStoredAttribution;
export const captureAttribution = defaultController.captureAttribution;
export const syncAttributionInputs = defaultController.syncAttributionInputs;
export const getAttributionForSubmit = defaultController.getAttributionForSubmit;
export const resetMemoryFallback = defaultController.resetMemoryFallback;
