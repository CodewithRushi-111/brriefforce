// Server-side source-URL validation and reachability checks.
//
// IMPORTANT: reachability is a quality signal ONLY. A link being unreachable is
// never treated as evidence that the associated claim is false — these functions
// never touch verdicts. Format validity and reachability are reported separately.
import type { Claim, Reachability } from "./types";

export interface UrlCheckResult {
  /** sourceUrl parses as an http(s) URL (format only). */
  urlValid: boolean;
  reachability: Reachability;
  /** HTTP status code, when a response was received. */
  status?: number;
}

export interface ReachabilityOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Injectable fetch, for deterministic testing. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

/** Format-only validation: is this a syntactically valid http(s) URL? */
export function isValidHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** Guard against SSRF: skip localhost / link-local / private network hosts. */
function isInternalHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h === "::1" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0") return true;
  if (/^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true; // link-local
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h)) return true; // 172.16.0.0/12
  return false;
}

function classify(status: number): Reachability {
  if (status >= 200 && status < 400) return "reachable";
  if (status === 401 || status === 403 || status === 429) return "blocked";
  return "unreachable"; // 404, other 4xx, 5xx
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  method: "HEAD" | "GET",
  timeoutMs: number,
  external?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (external) {
    if (external.aborted) controller.abort();
    else external.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // redirect: "follow" transparently handles 3xx chains.
    return await fetchImpl(url, { method, redirect: "follow", signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (external) external.removeEventListener("abort", onAbort);
  }
}

/**
 * Check whether a source URL is reachable. Handles redirects (followed),
 * timeouts, blocked/rate-limited responses, and network errors gracefully.
 * Never throws.
 */
export async function checkUrlReachable(
  rawUrl: string,
  opts: ReachabilityOptions = {},
): Promise<UrlCheckResult> {
  const { timeoutMs = 6000, signal, fetchImpl = fetch } = opts;

  if (!isValidHttpUrl(rawUrl)) {
    return { urlValid: false, reachability: "skipped" };
  }
  if (isInternalHost(new URL(rawUrl).hostname)) {
    return { urlValid: true, reachability: "skipped" };
  }

  try {
    let res = await fetchWithTimeout(fetchImpl, rawUrl, "HEAD", timeoutMs, signal);
    // Some servers reject HEAD — retry with GET (and discard the body).
    if (res.status === 405 || res.status === 501) {
      res = await fetchWithTimeout(fetchImpl, rawUrl, "GET", timeoutMs, signal);
      try {
        await res.body?.cancel?.();
      } catch {
        // ignore
      }
    }
    return { urlValid: true, reachability: classify(res.status), status: res.status };
  } catch {
    // Network error, DNS failure, or timeout — unreachable, NOT "false".
    return { urlValid: true, reachability: "unreachable" };
  }
}

/**
 * Annotate every claim's evidence with URL format validity and reachability.
 * Best-effort: on any unexpected failure the original claims are returned
 * unchanged. Verdicts are never modified.
 */
export async function annotateClaimUrls(
  claims: Claim[],
  opts: ReachabilityOptions = {},
): Promise<Claim[]> {
  try {
    return await Promise.all(
      claims.map(async (claim) => ({
        ...claim,
        evidence: await Promise.all(
          claim.evidence.map(async (ev) => {
            if (!ev.sourceUrl) {
              return { ...ev, urlValid: false, reachability: "skipped" as Reachability };
            }
            const { urlValid, reachability } = await checkUrlReachable(ev.sourceUrl, opts);
            return { ...ev, urlValid, reachability };
          }),
        ),
      })),
    );
  } catch {
    return claims;
  }
}
