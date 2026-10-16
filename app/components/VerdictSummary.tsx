import type { Claim, Verdict } from "@/app/lib/types";
import { VERDICTS } from "@/app/lib/types";
import { VERDICT_STYLES } from "@/app/lib/verdictStyles";
import { countByVerdict } from "@/app/lib/summary";

interface Props {
  claims: Claim[];
  /** Currently active verdict filter, or null for "show all". */
  active: Verdict | null;
  /** Toggle a verdict filter (pass the clicked verdict; same verdict clears it). */
  onToggle: (verdict: Verdict) => void;
}

export default function VerdictSummary({ claims, active, onToggle }: Props) {
  const counts = countByVerdict(claims);

  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by verdict">
      {VERDICTS.map((verdict) => {
        const count = counts[verdict];
        const isActive = active === verdict;
        const dim = active !== null && !isActive;
        return (
          <button
            key={verdict}
            onClick={() => onToggle(verdict)}
            disabled={count === 0}
            aria-pressed={isActive}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all ${VERDICT_STYLES[verdict]} ${
              isActive ? "ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-black" : ""
            } ${dim ? "opacity-50" : ""} ${
              count === 0 ? "cursor-not-allowed opacity-40" : "cursor-pointer hover:opacity-90"
            }`}
          >
            <span>{verdict}</span>
            <span className="rounded-full bg-black/10 px-1.5 dark:bg-white/15">{count}</span>
          </button>
        );
      })}
    </div>
  );
}
