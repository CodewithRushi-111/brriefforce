// MOCKED (deterministic) tests for the STRUCTURAL evidence-quality checks.
// These assert the application's own rules on model-produced claims. They do NOT
// (and cannot) verify semantic relevance — that is the model's job, guided by the
// system prompt. See the "irrelevant excerpt" test for how that boundary is handled.
import { describe, it, expect } from "vitest";
import { assessClaim } from "@/app/lib/evidenceQuality";
import type { Claim, Evidence } from "@/app/lib/types";

const ev = (over: Partial<Evidence> = {}): Evidence => ({
  excerpt: "e",
  sourceUrl: "https://example.com/a",
  sourceTitle: "Example",
  publicationDate: "2024-01-01",
  urlValid: true,
  reachability: "reachable",
  ...over,
});

const claim = (over: Partial<Claim>): Claim => ({
  claim: "c",
  verdict: "Supported",
  reasoning: "r",
  evidence: [],
  ...over,
});

describe("MOCKED — structural evidence-quality assessment", () => {
  it("relevant supporting evidence → no warnings", () => {
    expect(assessClaim(claim({ verdict: "Supported", evidence: [ev()] }))).toEqual([]);
  });

  it("directly contradictory evidence → no warnings", () => {
    expect(assessClaim(claim({ verdict: "Contradicted", evidence: [ev()] }))).toEqual([]);
  });

  it("two credible conflicting sources → Mixed Evidence has no warning", () => {
    const c = claim({
      verdict: "Mixed Evidence",
      evidence: [ev({ sourceUrl: "https://a.com" }), ev({ sourceUrl: "https://b.com" })],
    });
    expect(assessClaim(c)).toEqual([]);
  });

  it("no adequate evidence → Insufficient Evidence has no warning", () => {
    expect(assessClaim(claim({ verdict: "Insufficient Evidence", evidence: [] }))).toEqual([]);
  });

  it("definite verdict with NO usable source → warned", () => {
    const supported = assessClaim(claim({ verdict: "Supported", evidence: [] }));
    expect(supported.join(" ")).toMatch(/should cite at least one source/i);
    const contradicted = assessClaim(claim({ verdict: "Contradicted", evidence: [] }));
    expect(contradicted.join(" ")).toMatch(/should cite at least one source/i);
  });

  it("a format-invalid URL does not count as a usable source", () => {
    const c = claim({
      verdict: "Supported",
      evidence: [ev({ sourceUrl: "not-a-url", urlValid: false })],
    });
    expect(assessClaim(c).join(" ")).toMatch(/should cite at least one source/i);
  });

  it("Mixed Evidence with fewer than two sources → warned", () => {
    expect(assessClaim(claim({ verdict: "Mixed Evidence", evidence: [ev()] })).join(" ")).toMatch(
      /at least two conflicting sources/i,
    );
  });

  it("outdated claim WITH newer dated evidence → no warning", () => {
    const c = claim({ verdict: "Potentially Outdated", evidence: [ev({ publicationDate: "2025-01-01" })] });
    expect(assessClaim(c)).toEqual([]);
  });

  it("Potentially Outdated with NO dated evidence → warned (old date alone is not enough)", () => {
    const c = claim({ verdict: "Potentially Outdated", evidence: [ev({ publicationDate: "" })] });
    expect(assessClaim(c).join(" ")).toMatch(/newer dated evidence/i);
  });

  it("definite verdict whose only source was NOT retrieved → provenance warning", () => {
    const c = claim({ verdict: "Supported", evidence: [ev({ sourceRetrieved: false })] });
    expect(assessClaim(c).join(" ")).toMatch(/provenance could not be confirmed/i);
  });

  it("definite verdict whose source WAS retrieved → no provenance warning", () => {
    const c = claim({ verdict: "Supported", evidence: [ev({ sourceRetrieved: true })] });
    expect(assessClaim(c)).toEqual([]);
  });

  it("un-grounded (undefined sourceRetrieved) → no provenance warning", () => {
    // Older claims and data predating the grounding check must not be warned about.
    const c = claim({ verdict: "Supported", evidence: [ev()] });
    expect(assessClaim(c)).toEqual([]);
  });

  it("a retrieved source alongside an unretrieved one → no provenance warning", () => {
    // Warn only when EVERY usable source is unconfirmed; one grounded source is enough.
    const c = claim({
      verdict: "Contradicted",
      evidence: [ev({ sourceUrl: "https://a.com", sourceRetrieved: true }), ev({ sourceUrl: "https://b.com", sourceRetrieved: false })],
    });
    expect(assessClaim(c)).toEqual([]);
  });

  it("a present-but-irrelevant excerpt does NOT force Supported (model may choose Insufficient; preserved)", () => {
    // Relevance is a semantic judgement left to the model. The structural layer
    // must not upgrade such a claim: if the model returned Insufficient Evidence
    // despite having a cited page, that stands with no 'needs a source' warning.
    const c = claim({
      verdict: "Insufficient Evidence",
      evidence: [ev({ excerpt: "A page about an unrelated topic." })],
    });
    expect(assessClaim(c)).toEqual([]);
    expect(c.verdict).toBe("Insufficient Evidence");
  });
});
