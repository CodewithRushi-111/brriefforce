import type { Claim } from "./types";

/** Escape a single CSV field per RFC 4180. */
function escape(value: string): string {
  const needsQuoting = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuoting ? `"${escaped}"` : escaped;
}

const HEADERS = [
  "Claim",
  "Verdict",
  "Reasoning",
  "Evidence Summary",
  "Source Excerpt",
  "Source Title",
  "Source URL",
  "Source Retrieved",
  "Publication Date",
];

/**
 * Attribution provenance as an export cell: "yes"/"no" when checked, "" when the
 * claim predates the check. "yes" means the URL matched a web-search result for
 * that verification — NOT that the page supports the claim or the summary is exact.
 */
function retrievedCell(sourceRetrieved: boolean | undefined): string {
  if (sourceRetrieved === true) return "yes";
  if (sourceRetrieved === false) return "no";
  return "";
}

/**
 * Flatten claims to CSV. One row per evidence item so every source gets its
 * own line; claims with no evidence still produce a single row.
 */
export function claimsToCsv(claims: Claim[]): string {
  const rows: string[][] = [HEADERS];

  for (const claim of claims) {
    if (claim.evidence.length === 0) {
      rows.push([claim.claim, claim.verdict, claim.reasoning, "", "", "", "", "", ""]);
      continue;
    }
    for (const ev of claim.evidence) {
      rows.push([
        claim.claim,
        claim.verdict,
        claim.reasoning,
        ev.excerpt,
        ev.sourceExcerpt ?? "",
        ev.sourceTitle,
        ev.sourceUrl,
        retrievedCell(ev.sourceRetrieved),
        ev.publicationDate,
      ]);
    }
  }

  return rows.map((row) => row.map(escape).join(",")).join("\r\n");
}

/** Trigger a browser download of the CSV. */
export function downloadCsv(csv: string, filename = "briefproof-results.csv"): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
