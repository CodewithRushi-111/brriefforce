import type { ProgressEvent } from "@/app/lib/types";

/** Live progress shown while a memo is being verified. */
export default function ProgressPanel({ progress }: { progress: ProgressEvent[] }) {
  const searches = progress.filter((e) => e.type === "search").map((e) => e.query);
  const statuses = progress.filter((e) => e.type === "status").map((e) => e.message);
  const latestStatus = statuses[statuses.length - 1] ?? "Starting verification…";

  return (
    <div className="rounded-lg border border-black/[.08] bg-zinc-50 p-4 dark:border-white/[.145] dark:bg-zinc-900">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" aria-hidden />
        {latestStatus}
      </div>
      {searches.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Web searches ({searches.length})
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {searches.map((query, i) => (
              <li key={i} className="text-xs text-zinc-600 dark:text-zinc-300">
                🔎 {query}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs text-zinc-400">
        This can take a minute. You can cancel at any time without losing earlier results.
      </p>
    </div>
  );
}
