// @vitest-environment jsdom
// MOCKED (deterministic) tests for localStorage persistence + validation.
import { describe, it, expect, beforeEach } from "vitest";
import { loadStoredResults, saveStoredResults, clearStoredResults } from "@/app/lib/storage";
import type { Claim } from "@/app/lib/types";

const KEY = "briefproof:results:v1";
const good: Claim[] = [
  {
    claim: "c",
    verdict: "Supported",
    reasoning: "r",
    evidence: [{ excerpt: "e", sourceUrl: "https://a.com", sourceTitle: "A", publicationDate: "2024-01-01" }],
  },
];

beforeEach(() => {
  localStorage.clear();
});

describe("MOCKED — storage round-trip and validation", () => {
  it("saves and restores valid claims", () => {
    saveStoredResults(good);
    expect(loadStoredResults()).toEqual(good);
  });

  it("accepts older persisted claims that lack the sourceRetrieved field", () => {
    // `good` has no sourceRetrieved on its evidence — the pre-grounding shape.
    saveStoredResults(good);
    const loaded = loadStoredResults();
    expect(loaded).not.toBeNull();
    expect(loaded![0].evidence[0]).not.toHaveProperty("sourceRetrieved");
  });

  it("round-trips the new sourceRetrieved provenance flag", () => {
    const withFlag: Claim[] = [
      {
        claim: "c",
        verdict: "Supported",
        reasoning: "r",
        evidence: [{ excerpt: "e", sourceUrl: "https://a.com", sourceTitle: "A", publicationDate: "2024-01-01", sourceRetrieved: true }],
      },
    ];
    saveStoredResults(withFlag);
    expect(loadStoredResults()).toEqual(withFlag);
  });

  it("returns null and clears a payload with an invalid verdict", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ version: 1, claims: [{ claim: "c", verdict: "Bogus", reasoning: "r", evidence: [] }] }),
    );
    expect(loadStoredResults()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("returns null and clears a wrong-version payload", () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 99, claims: good }));
    expect(loadStoredResults()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("returns null and clears non-JSON garbage", () => {
    localStorage.setItem(KEY, "not-json");
    expect(loadStoredResults()).toBeNull();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(loadStoredResults()).toBeNull();
  });

  it("clearStoredResults removes the entry", () => {
    saveStoredResults(good);
    clearStoredResults();
    expect(localStorage.getItem(KEY)).toBeNull();
  });
});
