// MOCKED (deterministic) rendering tests for ResultsTable's evidence display.
// Guards the evidence-attribution fix: the model's `excerpt` is a summary /
// paraphrase, so the UI must present it as an "Evidence summary" and must NOT
// wrap it in quotation marks as if it were a verbatim source quote.
//
// Rendered with react-dom/server (no JSX, no @testing-library) so the test runs
// in a plain `.test.ts` file picked up by the existing vitest include glob.
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ResultsTable from "@/app/components/ResultsTable";
import type { Claim } from "@/app/lib/types";

const EXCERPT = "This source reports the market reached 12 billion dollars in 2024.";

const claim: Claim = {
  claim: "The market reached $12B in 2024.",
  verdict: "Supported",
  reasoning: "r",
  evidence: [
    {
      excerpt: EXCERPT,
      sourceUrl: "https://example.com/report",
      sourceTitle: "Example Report",
      publicationDate: "2024-05-01",
    },
  ],
};

const render = (claims: Claim[]) => renderToStaticMarkup(createElement(ResultsTable, { claims }));

describe("MOCKED — ResultsTable evidence attribution", () => {
  it("labels the evidence as an 'Evidence summary'", () => {
    const html = render([claim]);
    expect(html).toContain("Evidence summary");
    expect(html).toContain(EXCERPT);
  });

  it("does NOT wrap the evidence in typographic quotation marks", () => {
    const html = render([claim]);
    // The old UI rendered &ldquo;/&rdquo; (U+201C / U+201D) around the excerpt,
    // implying a verbatim quote. The summary must never be presented that way.
    expect(html).not.toContain("“");
    expect(html).not.toContain("”");
    // And not with straight ASCII quotes hugging the excerpt either.
    expect(html).not.toContain(`"${EXCERPT}"`);
  });

  it("still shows the source title, link, and publication date", () => {
    const html = render([claim]);
    expect(html).toContain("Example Report");
    expect(html).toContain("https://example.com/report");
    expect(html).toContain("2024-05-01");
  });
});

const withProvenance = (sourceRetrieved: boolean | undefined): Claim => ({
  ...claim,
  evidence: [{ ...claim.evidence[0], sourceRetrieved }],
});

const CITED = "Official data shows the figure was 12 billion dollars.";
const withSourceExcerpt = (): Claim => ({
  ...claim,
  evidence: [{ ...claim.evidence[0], sourceExcerpt: CITED }],
});

describe("MOCKED — ResultsTable API source excerpt vs AI summary", () => {
  it("renders the API source excerpt labeled and quoted, distinct from the unquoted summary", () => {
    const html = render([withSourceExcerpt()]);
    expect(html).toContain("Source excerpt");
    // The verbatim API excerpt IS quoted (it is a real quote).
    expect(html).toContain(`“${CITED}”`);
    // The AI summary is still shown and still NOT wrapped in quotation marks.
    expect(html).toContain("Evidence summary");
    expect(html).toContain(EXCERPT);
    expect(html).not.toContain(`“${EXCERPT}”`);
  });

  it("omits the source-excerpt line when no citation text is present", () => {
    const html = render([claim]);
    expect(html).not.toContain("Source excerpt");
    // With no API excerpt, nothing is quoted at all.
    expect(html).not.toContain("“");
  });
});

describe("MOCKED — ResultsTable source-attribution provenance", () => {
  it("marks an unretrieved source as unverified (and never as 'verified')", () => {
    const html = render([withProvenance(false)]);
    expect(html).toContain("unverified source");
    // Must not imply the URL or summary is verified just because it was shown.
    expect(html.toLowerCase()).not.toContain(">verified<");
    // The summary is still a summary, not a quotation.
    expect(html).toContain("Evidence summary");
    expect(html).not.toContain("“");
  });

  it("does NOT show the unverified marker when the source was retrieved", () => {
    expect(render([withProvenance(true)])).not.toContain("unverified source");
  });

  it("does NOT show the marker for un-grounded (undefined) older claims", () => {
    expect(render([withProvenance(undefined)])).not.toContain("unverified source");
  });
});
