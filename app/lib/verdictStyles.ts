import type { Verdict } from "./types";

/** Tailwind classes for each verdict badge, shared by the table and summary. */
export const VERDICT_STYLES: Record<Verdict, string> = {
  Supported: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  Contradicted: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  "Mixed Evidence": "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  "Insufficient Evidence": "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300",
  "Potentially Outdated": "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
};
