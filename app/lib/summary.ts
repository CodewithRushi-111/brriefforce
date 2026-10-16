import type { Claim, Verdict } from "./types";
import { VERDICTS } from "./types";

export type VerdictCounts = Record<Verdict, number>;

/** Tally how many claims fall under each verdict. */
export function countByVerdict(claims: Claim[]): VerdictCounts {
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, 0])) as VerdictCounts;
  for (const claim of claims) {
    counts[claim.verdict]++;
  }
  return counts;
}
