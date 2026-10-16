// MOCKED (deterministic) integration tests. The Anthropic SDK is replaced with
// fakes — NO network, NO API key, NOT a live web-search test. These lock in the
// streaming-progress fix, the pause_turn continuation, verifyClaim, and
// verifyMemo's extract-then-concurrently-verify orchestration.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ProgressEvent } from "@/app/lib/types";

interface FakeBlock {
  type: string;
  name?: string;
  input?: unknown;
}
type FakeEvent =
  | { type: "content_block_start"; index: number; content_block: FakeBlock }
  | { type: "content_block_delta"; index: number; delta: { type: string; partial_json?: string } }
  | { type: "content_block_stop"; index: number };
interface FakeMessage {
  stop_reason: string;
  // `content` on a block is used by web_search_tool_result blocks (the results list);
  // `citations` on a text block carries web_search_result_location citation objects.
  content: { type: string; text?: string; content?: unknown; citations?: unknown }[];
}
interface FakeTurn {
  events: FakeEvent[];
  final: FakeMessage;
}

// `turns` feeds messages.stream (verification); `extract` feeds messages.create
// (claim extraction).
const h = vi.hoisted(() => ({ turns: [] as FakeTurn[], extract: null as FakeMessage | null }));

vi.mock("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    messages = {
      create: async () =>
        h.extract ?? { stop_reason: "end_turn", content: [{ type: "text", text: '{"claims":[]}' }] },
      stream: () => {
        const turn: FakeTurn =
          h.turns.shift() ?? { events: [], final: { stop_reason: "end_turn", content: [] } };
        return {
          async *[Symbol.asyncIterator]() {
            for (const e of turn.events) yield e;
          },
          finalMessage: async () => turn.final,
        };
      },
    };
    static AuthenticationError = class extends Error {};
    static RateLimitError = class extends Error {};
  }
  return { default: FakeAnthropic };
});

// Imported AFTER the mock is registered.
const { verifyMemo, verifyClaim } = await import("@/app/lib/verify");

const textFinal = (claims: unknown): FakeMessage => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify({ claims }) }],
});
const extraction = (claims: string[]): FakeMessage => ({
  stop_reason: "end_turn",
  content: [{ type: "text", text: JSON.stringify({ claims }) }],
});
const oneClaim = (verdict: string, claim = "c") =>
  textFinal([{ claim, verdict, reasoning: "r", evidence: [] }]);

// A web_search_tool_result block as it appears in a real assistant message:
// `content` is the list of results the tool actually returned (url/title/…).
const webSearchResult = (urls: string[]) => ({
  type: "web_search_tool_result",
  content: urls.map((url) => ({ type: "web_search_result", url, title: "T", encrypted_content: "enc" })),
});
// A final message that carries BOTH the search results and the model's JSON answer.
const finalWithSearch = (urls: string[], claims: unknown): FakeMessage => ({
  stop_reason: "end_turn",
  content: [webSearchResult(urls), { type: "text", text: JSON.stringify({ claims }) }],
});
const provenanceWarned = (warnings: string[] | undefined) =>
  (warnings ?? []).some((w) => /provenance could not be confirmed/i.test(w));

// A real web_search_result_location citation object, as the API attaches it to text blocks.
const citationObj = (url: string, citedText: string) => ({
  type: "web_search_result_location",
  url,
  title: "T",
  cited_text: citedText,
  encrypted_index: "idx",
});
// Final message carrying search results AND a text block with real citations + the JSON answer.
const finalWithCitations = (args: {
  searchUrls?: string[];
  citations?: Array<{ url: string; cited: string }>;
  claims: unknown;
}): FakeMessage => ({
  stop_reason: "end_turn",
  content: [
    webSearchResult(args.searchUrls ?? []),
    {
      type: "text",
      text: JSON.stringify({ claims: args.claims }),
      citations: (args.citations ?? []).map((c) => citationObj(c.url, c.cited)),
    },
  ],
});
const oneEvidenceClaim = (sourceUrl: string, excerpt = "An AI paraphrase.") => [
  { claim: "c", verdict: "Supported", reasoning: "r", evidence: [{ excerpt, sourceUrl, sourceTitle: "T", publicationDate: "" }] },
];

beforeEach(() => {
  h.turns.length = 0;
  h.extract = null;
  // Verification runs server-side URL reachability checks; stub fetch so these
  // deterministic tests never touch the network.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 }) as unknown as Response));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MOCKED — verifyClaim", () => {
  it("returns a single normalized claim with its source URL", async () => {
    h.turns.push({
      events: [],
      final: textFinal([
        {
          claim: "The first iPhone was released in 2007.",
          verdict: "Supported",
          reasoning: "r",
          evidence: [
            { excerpt: "e", sourceUrl: "https://example.com", sourceTitle: "X", publicationDate: "2007-06-29" },
          ],
        },
      ]),
    });
    const claim = await verifyClaim("The first iPhone was released in 2007.");
    expect(claim.verdict).toBe("Supported");
    expect(claim.evidence[0].sourceUrl).toBe("https://example.com");
  });

  it("throws when the model returns no claim (does not fabricate one)", async () => {
    h.turns.push({ events: [], final: textFinal([]) });
    await expect(verifyClaim("x")).rejects.toThrow();
  });
});

describe("MOCKED — per-claim streaming progress (via verifyClaim)", () => {
  it("emits a search event when query is present at content_block_start (the fix)", async () => {
    const progress: ProgressEvent[] = [];
    h.turns.push({
      events: [
        {
          type: "content_block_start",
          index: 0,
          content_block: { type: "server_tool_use", name: "web_search", input: { query: "eiffel tower location" } },
        },
      ],
      final: oneClaim("Supported"),
    });
    await verifyClaim("claim", (e) => progress.push(e));

    expect(progress.filter((e) => e.type === "search")).toEqual([
      { type: "search", query: "eiffel tower location" },
    ]);
    const statuses = progress.filter((e) => e.type === "status").map((e) => e.message);
    expect(statuses[0]).toMatch(/Reading the memo/i);
    expect(statuses.some((s) => /Evaluating evidence/i.test(s))).toBe(true);
    expect(statuses[statuses.length - 1]).toMatch(/Validating source links/i);
  });

  it("falls back to input_json_delta accumulation when query is not at start", async () => {
    const progress: ProgressEvent[] = [];
    h.turns.push({
      events: [
        { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", name: "web_search", input: {} } },
        { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"fallback q"}' } },
        { type: "content_block_stop", index: 0 },
      ],
      final: oneClaim("Supported"),
    });
    await verifyClaim("claim", (e) => progress.push(e));
    expect(progress.filter((e) => e.type === "search")).toEqual([{ type: "search", query: "fallback q" }]);
  });

  it("deduplicates identical repeated queries", async () => {
    const progress: ProgressEvent[] = [];
    h.turns.push({
      events: [
        { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", name: "web_search", input: { query: "dup" } } },
        { type: "content_block_start", index: 1, content_block: { type: "server_tool_use", name: "web_search", input: { query: "dup" } } },
      ],
      final: oneClaim("Supported"),
    });
    await verifyClaim("claim", (e) => progress.push(e));
    expect(progress.filter((e) => e.type === "search")).toHaveLength(1);
  });

  it("resumes after a paused turn (pause_turn continuation)", async () => {
    h.turns.push({ events: [], final: { stop_reason: "pause_turn", content: [] } });
    h.turns.push({ events: [], final: oneClaim("Contradicted") });
    const progress: ProgressEvent[] = [];
    const claim = await verifyClaim("claim", (e) => progress.push(e));
    expect(claim.verdict).toBe("Contradicted");
    expect(progress.some((e) => e.type === "status" && /Continuing research/i.test(e.message))).toBe(true);
  });
});

describe("MOCKED — verifyMemo orchestration (extract → concurrent verify)", () => {
  it("extracts claims then verifies each, preserving order", async () => {
    h.extract = extraction(["Claim A", "Claim B", "Claim C"]);
    h.turns.push({ events: [], final: oneClaim("Supported", "Claim A") });
    h.turns.push({ events: [], final: oneClaim("Contradicted", "Claim B") });
    h.turns.push({ events: [], final: oneClaim("Mixed Evidence", "Claim C") });

    const progress: ProgressEvent[] = [];
    const res = await verifyMemo("memo text", (e) => progress.push(e));

    expect(res.claims.map((c) => c.claim)).toEqual(["Claim A", "Claim B", "Claim C"]);
    expect(res.claims.map((c) => c.verdict)).toEqual(["Supported", "Contradicted", "Mixed Evidence"]);

    const statuses = progress.filter((e) => e.type === "status").map((e) => e.message);
    expect(statuses[0]).toMatch(/Extracting claims/i);
    expect(statuses.some((s) => /Verifying 3 claims/i.test(s))).toBe(true);
    expect(statuses.some((s) => /Verified 3\/3/i.test(s))).toBe(true);
  });

  it("de-duplicates identical claims so each is verified once", async () => {
    h.extract = extraction(["Dup claim", "Dup claim", "Other"]);
    h.turns.push({ events: [], final: oneClaim("Supported", "Dup claim") });
    h.turns.push({ events: [], final: oneClaim("Supported", "Other") });

    const res = await verifyMemo("memo");
    expect(res.claims.map((c) => c.claim)).toEqual(["Dup claim", "Other"]);
  });

  it("returns no claims (and does not verify) when extraction finds none", async () => {
    h.extract = extraction([]);
    const res = await verifyMemo("a memo with only opinions");
    expect(res.claims).toEqual([]);
  });
});

describe("MOCKED — source-attribution grounding (sourceRetrieved)", () => {
  it("marks a source that matches the web_search results as retrieved", async () => {
    h.turns.push({
      events: [],
      final: finalWithSearch(
        ["https://a.com/x"],
        [
          {
            claim: "c",
            verdict: "Supported",
            reasoning: "r",
            evidence: [
              { excerpt: "A summary of what the page says.", sourceUrl: "https://a.com/x", sourceTitle: "T", publicationDate: "" },
            ],
          },
        ],
      ),
    });
    const claim = await verifyClaim("c");
    expect(claim.evidence[0].sourceRetrieved).toBe(true);
    expect(provenanceWarned(claim.warnings)).toBe(false);
  });

  it("flags a fabricated / unmatched source URL and warns on a definite verdict", async () => {
    h.turns.push({
      events: [],
      final: finalWithSearch(
        ["https://a.com/x"], // the only URL actually retrieved
        [
          {
            claim: "c",
            verdict: "Supported",
            reasoning: "r",
            evidence: [
              // A URL that was never in the search results.
              { excerpt: "A summary.", sourceUrl: "https://fabricated.example.org/z", sourceTitle: "T", publicationDate: "" },
            ],
          },
        ],
      ),
    });
    const claim = await verifyClaim("c");
    expect(claim.evidence[0].sourceRetrieved).toBe(false);
    expect(provenanceWarned(claim.warnings)).toBe(true);
    expect(claim.verdict).toBe("Supported"); // provenance never changes the verdict
  });

  it("does not attribute an AI search-coverage summary to an unrelated source", async () => {
    const coverage = "I searched multiple databases and found broad coverage of this subject.";
    h.turns.push({
      events: [],
      final: finalWithSearch(
        ["https://realdata.gov/report"],
        [
          {
            claim: "c",
            verdict: "Supported",
            reasoning: "r",
            evidence: [
              { excerpt: coverage, sourceUrl: "https://someblog.example.com/post", sourceTitle: "Blog", publicationDate: "" },
            ],
          },
        ],
      ),
    });
    const claim = await verifyClaim("c");
    // The unrelated URL is not confirmed as the source of this summary.
    expect(claim.evidence[0].sourceRetrieved).toBe(false);
    // The summary text is preserved verbatim (nothing fabricated or rewritten).
    expect(claim.evidence[0].excerpt).toBe(coverage);
    expect(provenanceWarned(claim.warnings)).toBe(true);
  });

  it("insufficient evidence stays empty — no fabricated supporting evidence", async () => {
    h.turns.push({
      events: [],
      final: finalWithSearch([], [{ claim: "c", verdict: "Insufficient Evidence", reasoning: "r", evidence: [] }]),
    });
    const claim = await verifyClaim("c");
    expect(claim.verdict).toBe("Insufficient Evidence");
    expect(claim.evidence).toEqual([]);
    expect(provenanceWarned(claim.warnings)).toBe(false);
  });
});

describe("MOCKED — real API source excerpt (sourceExcerpt from web_search citations)", () => {
  it("extracts cited_text and associates it to the matching evidence URL", async () => {
    h.turns.push({
      events: [],
      final: finalWithCitations({
        searchUrls: ["https://a.com/x"],
        citations: [{ url: "https://a.com/x", cited: "The market reached $12B in 2024." }],
        claims: oneEvidenceClaim("https://a.com/x"),
      }),
    });
    const claim = await verifyClaim("c");
    expect(claim.evidence[0].sourceExcerpt).toBe("The market reached $12B in 2024.");
    expect(claim.evidence[0].sourceRetrieved).toBe(true);
    // The AI summary is preserved and kept distinct from the verbatim excerpt.
    expect(claim.evidence[0].excerpt).toBe("An AI paraphrase.");
  });

  it("omits the excerpt when the citation URL does not match the evidence URL", async () => {
    h.turns.push({
      events: [],
      final: finalWithCitations({
        searchUrls: ["https://a.com/x"],
        citations: [{ url: "https://a.com/x", cited: "Cited text for a different page." }],
        claims: oneEvidenceClaim("https://b.com/y"),
      }),
    });
    const claim = await verifyClaim("c");
    expect(claim.evidence[0].sourceExcerpt).toBeUndefined();
  });

  it("omits the excerpt when no citation text is present (never manufactured)", async () => {
    h.turns.push({
      events: [],
      final: finalWithCitations({
        searchUrls: ["https://a.com/x"],
        citations: [],
        claims: oneEvidenceClaim("https://a.com/x"),
      }),
    });
    const claim = await verifyClaim("c");
    expect(claim.evidence[0].sourceExcerpt).toBeUndefined();
    expect(claim.evidence[0].sourceRetrieved).toBe(true); // provenance flag unaffected
  });

  it("uses the API cited_text, NOT a fabricated excerpt in the model's JSON", async () => {
    h.turns.push({
      events: [],
      final: finalWithCitations({
        searchUrls: ["https://a.com/x"],
        citations: [{ url: "https://a.com/x", cited: "Genuine text the API extracted." }],
        claims: oneEvidenceClaim("https://a.com/x", "A FABRICATED model paraphrase."),
      }),
    });
    const claim = await verifyClaim("c");
    expect(claim.evidence[0].sourceExcerpt).toBe("Genuine text the API extracted.");
    // The model's JSON text is never promoted to the verbatim excerpt.
    expect(claim.evidence[0].sourceExcerpt).not.toBe(claim.evidence[0].excerpt);
    expect(claim.evidence[0].excerpt).toBe("A FABRICATED model paraphrase.");
  });

  it("truncates a long excerpt to a short cited span with an ellipsis", async () => {
    const long = "x".repeat(600);
    h.turns.push({
      events: [],
      final: finalWithCitations({
        searchUrls: ["https://a.com/x"],
        citations: [{ url: "https://a.com/x", cited: long }],
        claims: oneEvidenceClaim("https://a.com/x"),
      }),
    });
    const claim = await verifyClaim("c");
    const excerpt = claim.evidence[0].sourceExcerpt!;
    expect(excerpt.endsWith("…")).toBe(true);
    expect(excerpt.length).toBe(501); // 500 chars + ellipsis
  });

  it("associates via normalized URL (protocol / www / trailing slash differences)", async () => {
    h.turns.push({
      events: [],
      final: finalWithCitations({
        searchUrls: ["https://www.a.com/x/"],
        citations: [{ url: "https://www.a.com/x/", cited: "Matched after normalization." }],
        claims: oneEvidenceClaim("http://a.com/x"),
      }),
    });
    const claim = await verifyClaim("c");
    expect(claim.evidence[0].sourceExcerpt).toBe("Matched after normalization.");
  });
});
