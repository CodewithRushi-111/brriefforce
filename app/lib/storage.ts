// Safe, versioned persistence of the latest verification results in localStorage.
// Stores only claim data (public research findings) — never API keys or secrets.
import type { Claim } from "./types";
import { VERDICTS } from "./types";

const STORAGE_KEY = "briefproof:results:v1";

interface StoredResults {
  version: 1;
  claims: Claim[];
  savedAt: number;
}

function isClaim(value: unknown): value is Claim {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  if (typeof c.claim !== "string") return false;
  if (!VERDICTS.includes(c.verdict as (typeof VERDICTS)[number])) return false;
  if (typeof c.reasoning !== "string") return false;
  if (!Array.isArray(c.evidence)) return false;
  return c.evidence.every((e) => {
    if (typeof e !== "object" || e === null) return false;
    const ev = e as Record<string, unknown>;
    return (
      typeof ev.excerpt === "string" &&
      typeof ev.sourceUrl === "string" &&
      typeof ev.sourceTitle === "string" &&
      typeof ev.publicationDate === "string"
    );
  });
}

/** Load stored results, returning null if absent, unparseable, or an outdated/invalid shape. */
export function loadStoredResults(): Claim[] | null {
  if (typeof window === "undefined") return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage disabled (private mode, etc.)
  }
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      (parsed as StoredResults).version !== 1 ||
      !Array.isArray((parsed as StoredResults).claims)
    ) {
      clearStoredResults();
      return null;
    }
    const claims = (parsed as StoredResults).claims;
    if (!claims.every(isClaim)) {
      clearStoredResults();
      return null;
    }
    return claims;
  } catch {
    clearStoredResults();
    return null;
  }
}

/** Persist the latest results. Silently no-ops if storage is unavailable. */
export function saveStoredResults(claims: Claim[]): void {
  if (typeof window === "undefined") return;
  const payload: StoredResults = { version: 1, claims, savedAt: Date.now() };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota exceeded or storage disabled — results stay in memory only.
  }
}

export function clearStoredResults(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
