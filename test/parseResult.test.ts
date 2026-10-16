// MOCKED (deterministic) tests of the model-output parser. These feed canned
// JSON — NOT live model responses — so every one of the five verdicts and the
// edge-case guarantees are exercised reliably. No network, no API key.
import { describe, it, expect } from "vitest";
import { parseResult, extractQuery } from "@/app/lib/verify";
import { VERDICTS } from "@/app/lib/types";

const wrap = (claims: unknown) => JSON.stringify({ claims });

describe("MOCKED — parseResult: all five verdict categories round-trip", () => {
  for (const verdict of VERDICTS) {
    it(`preserves "${verdict}"`, () => {
      const json = wrap([
        { claim: "c", verdict, reasoning: "r", evidence: [] },
      ]);
      const { claims } = parseResult(json);
      expect(claims).toHaveLength(1);
      expect(claims[0].verdict).toBe(verdict);
    });
  }
});

describe("MOCKED — parseResult: structural parsing", () => {
  it("extracts JSON even with surrounding prose", () => {
    const text = `Here is my analysis.\n${wrap([{ claim: "x", verdict: "Supported", reasoning: "", evidence: [] }])}\nThanks!`;
    const { claims } = parseResult(text);
    expect(claims[0].claim).toBe("x");
  });

  it("throws when there is no JSON object", () => {
    expect(() => parseResult("no json here")).toThrow();
  });

  it("throws when claims is not an array", () => {
    expect(() => parseResult(JSON.stringify({ claims: "nope" }))).toThrow();
  });

  it("normalizes evidence fields and keeps source URLs", () => {
    const json = wrap([
      {
        claim: "c",
        verdict: "Supported",
        reasoning: "r",
        evidence: [
          { excerpt: "e", sourceUrl: "https://example.com/a", sourceTitle: "T", publicationDate: "2020-01-01" },
        ],
      },
    ]);
    const { claims } = parseResult(json);
    expect(claims[0].evidence[0]).toEqual({
      excerpt: "e",
      sourceUrl: "https://example.com/a",
      sourceTitle: "T",
      publicationDate: "2020-01-01",
    });
  });
});

describe("MOCKED — edge-case guarantees (parser never coerces a verdict)", () => {
  it("missing/invalid verdict falls back to Insufficient Evidence, NOT Contradicted", () => {
    // "Missing evidence must not be treated as proof that a claim is false."
    const json = wrap([{ claim: "c", reasoning: "no verdict given", evidence: [] }]);
    const { claims } = parseResult(json);
    expect(claims[0].verdict).toBe("Insufficient Evidence");
    expect(claims[0].verdict).not.toBe("Contradicted");
  });

  it("empty evidence does not flip a verdict to Contradicted or Supported", () => {
    const json = wrap([{ claim: "c", verdict: "Insufficient Evidence", reasoning: "r", evidence: [] }]);
    const { claims } = parseResult(json);
    expect(claims[0].verdict).toBe("Insufficient Evidence");
  });

  it('"Mixed Evidence" is NOT coerced to Supported even with multiple sources', () => {
    // "Conflicting credible sources should not automatically produce Supported."
    const json = wrap([
      {
        claim: "c",
        verdict: "Mixed Evidence",
        reasoning: "sources disagree",
        evidence: [
          { excerpt: "pro", sourceUrl: "https://a.com", sourceTitle: "A", publicationDate: "2024-01-01" },
          { excerpt: "con", sourceUrl: "https://b.com", sourceTitle: "B", publicationDate: "2024-02-01" },
        ],
      },
    ]);
    const { claims } = parseResult(json);
    expect(claims[0].verdict).toBe("Mixed Evidence");
  });

  it("an old publication date alone does not change a Supported verdict", () => {
    // "Old publication dates alone must not automatically produce Potentially Outdated."
    const json = wrap([
      {
        claim: "c",
        verdict: "Supported",
        reasoning: "still true",
        evidence: [{ excerpt: "e", sourceUrl: "https://a.com", sourceTitle: "A", publicationDate: "1999-01-01" }],
      },
    ]);
    const { claims } = parseResult(json);
    expect(claims[0].verdict).toBe("Supported");
  });

  it("uncertainty verdicts preserve their reasoning text", () => {
    // "Uncertain results must communicate uncertainty honestly."
    const json = wrap([
      { claim: "c", verdict: "Insufficient Evidence", reasoning: "could not find reliable sources", evidence: [] },
    ]);
    const { claims } = parseResult(json);
    expect(claims[0].reasoning).toMatch(/could not find/i);
  });
});

describe("MOCKED — extractQuery (delta-accumulation fallback)", () => {
  it("pulls query from a complete JSON blob", () => {
    expect(extractQuery('{"query":"hello world"}')).toBe("hello world");
  });
  it("returns empty string on malformed JSON", () => {
    expect(extractQuery('{"query":')).toBe("");
  });
});
