import type { Claim, Verdict } from "@/app/lib/types";
import { VERDICT_STYLES } from "@/app/lib/verdictStyles";

function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${VERDICT_STYLES[verdict]}`}
    >
      {verdict}
    </span>
  );
}

/** Subtle note about a source link's reachability (never affects the verdict). */
function LinkStatus({ evidence }: { evidence: Claim["evidence"][number] }) {
  if (evidence.urlValid === false) {
    return <span className="text-amber-600 dark:text-amber-400">· invalid link</span>;
  }
  switch (evidence.reachability) {
    case "unreachable":
      return <span className="text-amber-600 dark:text-amber-400" title="Link could not be reached when checked; this does not affect the verdict.">· link unreachable</span>;
    case "blocked":
      return <span className="text-zinc-400" title="Source restricts automated access; the verdict is unaffected.">· access restricted</span>;
    default:
      return null;
  }
}

/**
 * Attribution provenance marker. Shown only when this evidence's source URL was
 * NOT among the pages web_search returned for this check. It reflects URL-level
 * provenance only — it does not say the summary is wrong or the verdict unsafe.
 */
function SourceProvenance({ evidence }: { evidence: Claim["evidence"][number] }) {
  if (!evidence.sourceUrl || evidence.sourceRetrieved !== false) return null;
  return (
    <span
      className="text-amber-600 dark:text-amber-400"
      title="This source URL did not appear in the web-search results for this check, so its provenance could not be confirmed. This does not affect the verdict and does not prove the summary is inaccurate."
    >
      · unverified source
    </span>
  );
}

interface Props {
  claims: Claim[];
  /** Only show claims with this verdict, if set. Indices stay tied to the full list. */
  filter?: Verdict | null;
  /** Original indices currently being re-verified. */
  reverifying?: Set<number>;
  /** Per-claim re-verify error messages, keyed by original index. */
  reverifyErrors?: Record<number, string>;
  /** Re-verify a single claim by its original index. */
  onReverify?: (index: number) => void;
}

export default function ResultsTable({
  claims,
  filter = null,
  reverifying,
  reverifyErrors,
  onReverify,
}: Props) {
  if (claims.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No checkable factual claims were found in this memo.
      </p>
    );
  }

  // Keep each row's original index so re-verification updates the correct claim.
  const rows = claims
    .map((claim, index) => ({ claim, index }))
    .filter(({ claim }) => !filter || claim.verdict === filter);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        No claims match this filter.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-black/[.08] dark:border-white/[.145]">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-zinc-50 dark:bg-zinc-900">
          <tr className="border-b border-black/[.08] dark:border-white/[.145]">
            <th className="p-3 font-semibold">Claim</th>
            <th className="p-3 font-semibold">Verdict</th>
            <th className="p-3 font-semibold">Evidence &amp; Sources</th>
            {onReverify && <th className="p-3 font-semibold">Action</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ claim, index }) => {
            const isReverifying = reverifying?.has(index) ?? false;
            const rowError = reverifyErrors?.[index];
            return (
              <tr
                key={index}
                className={`border-b border-black/[.06] align-top last:border-0 dark:border-white/[.1] ${
                  isReverifying ? "opacity-60" : ""
                }`}
              >
                <td className="max-w-md p-3">
                  <p className="font-medium">{claim.claim}</p>
                  {claim.reasoning && (
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {claim.reasoning}
                    </p>
                  )}
                  {claim.warnings && claim.warnings.length > 0 && (
                    <ul className="mt-1.5 flex flex-col gap-0.5">
                      {claim.warnings.map((w, k) => (
                        <li key={k} className="text-xs text-amber-600 dark:text-amber-400">
                          ⚠ {w}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="p-3">
                  <VerdictBadge verdict={claim.verdict} />
                </td>
                <td className="max-w-lg p-3">
                  {claim.evidence.length === 0 ? (
                    <span className="text-xs text-zinc-400">No sources cited.</span>
                  ) : (
                    <ul className="flex flex-col gap-3">
                      {claim.evidence.map((ev, j) => (
                        <li key={j} className="text-xs">
                          {ev.excerpt && (
                            <p className="text-zinc-700 dark:text-zinc-300">
                              <span className="font-medium text-zinc-500 dark:text-zinc-400">
                                Evidence summary:{" "}
                              </span>
                              {ev.excerpt}
                            </p>
                          )}
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-zinc-500 dark:text-zinc-400">
                            {ev.sourceUrl ? (
                              <a
                                href={ev.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium text-blue-600 underline underline-offset-2 dark:text-blue-400"
                              >
                                {ev.sourceTitle || ev.sourceUrl}
                              </a>
                            ) : (
                              <span>{ev.sourceTitle}</span>
                            )}
                            {ev.publicationDate && (
                              <span className="text-zinc-400">· {ev.publicationDate}</span>
                            )}
                            <LinkStatus evidence={ev} />
                            <SourceProvenance evidence={ev} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                {onReverify && (
                  <td className="p-3">
                    <button
                      onClick={() => onReverify(index)}
                      disabled={isReverifying}
                      className="inline-flex h-8 items-center justify-center whitespace-nowrap rounded-full border border-black/[.12] px-3 text-xs font-medium transition-colors hover:bg-black/[.04] disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/[.18] dark:hover:bg-white/[.06]"
                    >
                      {isReverifying ? "Re-verifying…" : "Re-verify"}
                    </button>
                    {rowError && (
                      <p className="mt-1.5 max-w-[12rem] text-xs text-red-600 dark:text-red-400">
                        {rowError}
                      </p>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
