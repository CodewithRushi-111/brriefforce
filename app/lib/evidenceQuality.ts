// Deterministic, STRUCTURAL checks on a model-produced claim.
//
// These do NOT judge whether an excerpt semantically supports its claim — that
// remains the model's job (guided by the system prompt). They only catch
// structural inconsistencies the application can verify on its own, e.g. a
// definite verdict with no cited source. Output is advisory warnings; verdicts
// are never changed here.
import type { Claim } from "./types";

/** Evidence items with a syntactically usable URL (format valid, non-empty). */
function usableSources(claim: Claim) {
  return claim.evidence.filter((e) => e.sourceUrl && e.urlValid !== false);
}

export function assessClaim(claim: Claim): string[] {
  const warnings: string[] = [];
  const usable = usableSources(claim);

  // A definite verdict must rest on at least one cited source.
  if ((claim.verdict === "Supported" || claim.verdict === "Contradicted") && usable.length === 0) {
    warnings.push(
      `A "${claim.verdict}" verdict should cite at least one source, but none with a usable URL were provided.`,
    );
  }

  // "Mixed Evidence" means materially conflicting sources — needs at least two.
  if (claim.verdict === "Mixed Evidence" && claim.evidence.length < 2) {
    warnings.push(
      '"Mixed Evidence" should cite at least two conflicting sources; fewer than two were provided.',
    );
  }

  // "Potentially Outdated" must rest on newer dated evidence, not an old date alone.
  if (claim.verdict === "Potentially Outdated" && !claim.evidence.some((e) => e.publicationDate)) {
    warnings.push(
      '"Potentially Outdated" should cite newer dated evidence; no evidence had a publication date.',
    );
  }

  return warnings;
}

/** Attach structural warnings to each claim (non-mutating). */
export function withQualityWarnings(claims: Claim[]): Claim[] {
  return claims.map((c) => {
    const warnings = assessClaim(c);
    return warnings.length ? { ...c, warnings } : c;
  });
}
