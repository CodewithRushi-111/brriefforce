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
  content: { type: string; text?: string }[];
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
