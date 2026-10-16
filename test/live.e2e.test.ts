// LIVE end-to-end tests — these make REAL calls to the Anthropic API with REAL
// web search. They are skipped automatically when no ANTHROPIC_API_KEY is
// available. Only the two verdicts with reliably reproducible real-world
// examples (Supported, Contradicted) are asserted by label; the other three
// verdicts depend on model judgement and are covered by the MOCKED tests.
import { describe, it, expect } from "vitest";
import { verifyClaim } from "@/app/lib/verify";
import { VERDICTS } from "@/app/lib/types";
import type { Claim } from "@/app/lib/types";

const LIVE = !!process.env.ANTHROPIC_API_KEY;
const LIVE_TIMEOUT = 240_000;

function isValidHttpUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** Shared structural checks for any real result. */
function assertWellFormed(claim: Claim) {
  expect(VERDICTS).toContain(claim.verdict);
  expect(claim.reasoning.length).toBeGreaterThan(0);
  // Every NON-EMPTY source URL must be a valid http(s) URL.
  for (const ev of claim.evidence) {
    if (ev.sourceUrl) expect(isValidHttpUrl(ev.sourceUrl)).toBe(true);
  }
}

describe.skipIf(!LIVE)("LIVE — real web-search verdicts", () => {
  it(
    "classifies a clearly true claim as Supported with real source URLs",
    async () => {
      const claim = await verifyClaim("Water boils at 100 degrees Celsius at sea level.");
      assertWellFormed(claim);
      expect(claim.verdict).toBe("Supported");
      const validUrls = claim.evidence.filter((e) => isValidHttpUrl(e.sourceUrl));
      expect(validUrls.length).toBeGreaterThan(0);
    },
    LIVE_TIMEOUT,
  );

  it(
    "classifies a well-known false claim as Contradicted with real source URLs",
    async () => {
      const claim = await verifyClaim(
        "The Great Wall of China is visible from the Moon with the naked eye.",
      );
      assertWellFormed(claim);
      expect(claim.verdict).toBe("Contradicted");
      const validUrls = claim.evidence.filter((e) => isValidHttpUrl(e.sourceUrl));
      expect(validUrls.length).toBeGreaterThan(0);
    },
    LIVE_TIMEOUT,
  );

  // A genuinely contested health claim. We do NOT assert a specific uncertain
  // label (Mixed / Insufficient / Potentially Outdated are not reliably
  // reproducible — forcing one would be dishonest). The only defensible live
  // assertion is that modern evidence does not SUPPORT it. This exercises the
  // non-binary verdict path end-to-end without forcing a verdict.
  it(
    "does NOT classify a contested claim as Supported (exercises the non-binary path)",
    async () => {
      const claim = await verifyClaim(
        "Drinking a glass of red wine every day is good for your heart.",
      );
      assertWellFormed(claim);
      expect(claim.verdict).not.toBe("Supported");
    },
    LIVE_TIMEOUT,
  );
});

// Note on reporting: when ANTHROPIC_API_KEY is present, both tests above RUN and
// the report reads "2 passed" (0 skipped). When the key is absent, describe.skipIf
// marks both as skipped under "LIVE — real web-search verdicts" (0 passed). There
// is no separate placeholder test, so a nonzero "skipped" count here always means
// the key was unavailable to the runner — never a decorative skip.
