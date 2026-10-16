"use client";

import { useEffect, useRef, useState } from "react";
import type {
  Claim,
  ProgressEvent,
  StreamEvent,
  Verdict,
  VerifyErrorResponse,
} from "@/app/lib/types";
import { claimsToCsv, downloadCsv } from "@/app/lib/csv";
import { SAMPLE_MEMO } from "@/app/lib/sampleMemo";
import { clearStoredResults, loadStoredResults, saveStoredResults } from "@/app/lib/storage";
import ResultsTable from "@/app/components/ResultsTable";
import VerdictSummary from "@/app/components/VerdictSummary";
import ProgressPanel from "@/app/components/ProgressPanel";

interface ReverifyResponse {
  claim: Claim;
}

export default function Home() {
  const [memo, setMemo] = useState("");
  const [claims, setClaims] = useState<Claim[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Verdict | null>(null);
  const [reverifying, setReverifying] = useState<Set<number>>(new Set());
  const [reverifyErrors, setReverifyErrors] = useState<Record<number, string>>({});
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Restore the last results from localStorage on first load.
  useEffect(() => {
    const stored = loadStoredResults();
    if (stored) setClaims(stored);
  }, []);

  async function handleVerify() {
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    setFilter(null);
    setReverifyErrors({});
    setProgress([]);

    try {
      const res = await fetch("/api/verify/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memo }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = (await res.json()) as VerifyErrorResponse;
        throw new Error(data.error || `Request failed (${res.status}).`);
      }
      if (!res.body) throw new Error("No response stream was returned.");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let gotResult = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by a blank line.
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          if (!payload) continue;

          const evt = JSON.parse(payload) as StreamEvent;
          if (evt.type === "result") {
            // Verdicts only appear here — after evidence has been evaluated.
            setClaims(evt.claims);
            saveStoredResults(evt.claims);
            gotResult = true;
          } else if (evt.type === "error") {
            throw new Error(evt.message);
          } else {
            setProgress((prev) => [...prev, evt]);
          }
        }
      }

      if (!gotResult) {
        throw new Error("The connection ended before verification finished. Please try again.");
      }
    } catch (err) {
      // Keep any previously shown results on failure or cancellation.
      if (controller.signal.aborted) {
        setError("Verification cancelled.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      setLoading(false);
      setProgress([]);
      abortRef.current = null;
    }
  }

  function handleCancel() {
    abortRef.current?.abort();
  }

  async function handleReverify(index: number) {
    const current = claims?.[index];
    // Guard against duplicate requests for the same claim.
    if (!current || reverifying.has(index)) return;

    setReverifying((prev) => new Set(prev).add(index));
    setReverifyErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });

    try {
      const res = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: current.claim }),
      });
      if (!res.ok) {
        const data = (await res.json()) as VerifyErrorResponse;
        throw new Error(data.error || `Request failed (${res.status}).`);
      }
      const data = (await res.json()) as ReverifyResponse;
      // Replace only this claim; never touch the rest of the results.
      setClaims((prev) => {
        if (!prev) return prev;
        const next = prev.map((c, i) => (i === index ? data.claim : c));
        saveStoredResults(next);
        return next;
      });
    } catch (err) {
      // Failure leaves the existing claim untouched; surface the error on the row.
      setReverifyErrors((prev) => ({
        ...prev,
        [index]: err instanceof Error ? err.message : "Re-verification failed.",
      }));
    } finally {
      setReverifying((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  }

  function handleClear() {
    setClaims(null);
    setFilter(null);
    setReverifyErrors({});
    clearStoredResults();
  }

  const canSubmit = memo.trim().length > 0 && !loading;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">BriefProof</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Paste an AI-generated research memo. BriefProof extracts its factual claims,
          checks each against live web sources, and classifies them with supporting
          evidence.
        </p>
      </header>

      <section className="flex flex-col gap-3">
        <label htmlFor="memo" className="text-sm font-medium">
          Research memo
        </label>
        <textarea
          id="memo"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="Paste the research memo here…"
          rows={12}
          disabled={loading}
          className="w-full resize-y rounded-lg border border-black/[.12] bg-white p-4 font-mono text-sm leading-6 outline-none focus:border-blue-500 disabled:opacity-60 dark:border-white/[.18] dark:bg-black"
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={handleVerify}
            disabled={!canSubmit}
            className="inline-flex h-10 items-center justify-center rounded-full bg-foreground px-6 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Verifying…" : "Verify claims"}
          </button>
          <button
            onClick={() => setMemo(SAMPLE_MEMO)}
            disabled={loading}
            className="inline-flex h-10 items-center justify-center rounded-full border border-black/[.12] px-5 text-sm font-medium transition-colors hover:bg-black/[.04] disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/[.18] dark:hover:bg-white/[.06]"
          >
            Load example
          </button>
          {loading && (
            <button
              onClick={handleCancel}
              className="inline-flex h-10 items-center justify-center rounded-full border border-red-300 px-5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
            >
              Cancel
            </button>
          )}
        </div>
      </section>

      {loading && <ProgressPanel progress={progress} />}

      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {claims && (
        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">
              Results{" "}
              <span className="text-base font-normal text-zinc-500">
                ({claims.length} claim{claims.length === 1 ? "" : "s"})
              </span>
            </h2>
            <div className="flex items-center gap-2">
              {claims.length > 0 && (
                <button
                  onClick={() => downloadCsv(claimsToCsv(claims))}
                  className="inline-flex h-9 items-center justify-center rounded-full border border-black/[.12] px-4 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.18] dark:hover:bg-white/[.06]"
                >
                  Export CSV
                </button>
              )}
              <button
                onClick={handleClear}
                className="inline-flex h-9 items-center justify-center rounded-full border border-black/[.12] px-4 text-sm font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.18] dark:hover:bg-white/[.06]"
              >
                Clear
              </button>
            </div>
          </div>
          {claims.length > 0 && (
            <VerdictSummary
              claims={claims}
              active={filter}
              onToggle={(v) => setFilter((prev) => (prev === v ? null : v))}
            />
          )}
          <ResultsTable
            claims={claims}
            filter={filter}
            reverifying={reverifying}
            reverifyErrors={reverifyErrors}
            onReverify={handleReverify}
          />
        </section>
      )}
    </main>
  );
}
