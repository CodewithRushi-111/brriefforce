// Shared types for BriefProof claim verification.

export const VERDICTS = [
  "Supported",
  "Contradicted",
  "Mixed Evidence",
  "Insufficient Evidence",
  "Potentially Outdated",
] as const;

export type Verdict = (typeof VERDICTS)[number];

/**
 * Server-side reachability of a source URL. This is independent of the verdict:
 * an unreachable link is NOT evidence that a claim is false.
 * - "reachable": responded 2xx/3xx
 * - "blocked": server exists but restricts automated access (401/403/429)
 * - "unreachable": network error, timeout, 404, or 5xx
 * - "skipped": not checked (invalid format, or an internal/private host)
 * - "unchecked": checks were not run for this item
 */
export type Reachability =
  | "reachable"
  | "blocked"
  | "unreachable"
  | "skipped"
  | "unchecked";

export interface Evidence {
  /**
   * A brief summary/paraphrase (in the model's own words) of what the source
   * says about the claim. This is NOT a verbatim quotation — never render it
   * wrapped in quotation marks or otherwise imply it is exact source text.
   */
  excerpt: string;
  /** URL of the source the excerpt came from. */
  sourceUrl: string;
  /** Title of the source page, if known. */
  sourceTitle: string;
  /** Publication date of the source in ISO (YYYY-MM-DD) form, or "" if unknown. */
  publicationDate: string;
  /** Whether sourceUrl is a syntactically valid http(s) URL (format only). */
  urlValid?: boolean;
  /** Server-side reachability of sourceUrl (distinct from format validity). */
  reachability?: Reachability;
  /**
   * Provenance flag (attribution only). `true` iff this evidence's sourceUrl
   * matched a URL actually returned by web_search during THIS verification.
   * `false` means it did not match, or provenance could not be established.
   * This is URL-level attribution ONLY — it does NOT prove the page's content
   * supports the claim, nor that the evidence summary is accurate. Absent
   * (undefined) on claims produced before this check existed.
   */
  sourceRetrieved?: boolean;
  /**
   * Verbatim quoted text that Anthropic's web_search integration attributed to
   * this source (a `web_search_result_location` citation's `cited_text`),
   * associated to this evidence by normalized-URL match against the real API
   * response — NOT taken from the model's JSON. It is a SHORT cited excerpt
   * (possibly truncated), not the full page, and its presence does NOT mean the
   * claim has been semantically verified. Omitted when no citation text could be
   * reliably associated. Absent (undefined) on older claims.
   */
  sourceExcerpt?: string;
}

export interface Claim {
  /** The factual claim extracted from the memo, stated plainly. */
  claim: string;
  /** How the claim holds up against the gathered web evidence. */
  verdict: Verdict;
  /** One or two sentences explaining the verdict. */
  reasoning: string;
  /** Supporting / contradicting evidence with sources. */
  evidence: Evidence[];
  /**
   * Deterministic, structural quality notes about this claim's evidence
   * (e.g. a definite verdict with no cited source). NOT a semantic judgement.
   */
  warnings?: string[];
}

export interface VerificationResult {
  claims: Claim[];
}

export interface VerifyErrorResponse {
  error: string;
}

/** Progress signals emitted while a memo verification streams. */
export type ProgressEvent =
  | { type: "status"; message: string }
  | { type: "search"; query: string };

/** Everything the streaming verify endpoint can send over SSE. */
export type StreamEvent =
  | ProgressEvent
  | { type: "result"; claims: Claim[] }
  | { type: "error"; message: string };
