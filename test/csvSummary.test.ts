// MOCKED (deterministic) tests for CSV export and verdict tallying.
import { describe, it, expect } from "vitest";
import { claimsToCsv } from "@/app/lib/csv";
import { countByVerdict } from "@/app/lib/summary";
import type { Claim } from "@/app/lib/types";

const claim = (over: Partial<Claim>): Claim => ({
  claim: "c",
  verdict: "Supported",
  reasoning: "r",
  evidence: [],
  ...over,
});

describe("MOCKED — claimsToCsv", () => {
  it("emits a header row with Source URL column", () => {
    const csv = claimsToCsv([]);
    expect(csv.split("\r\n")[0]).toContain("Source URL");
  });

  it("labels the evidence column as a summary, not a verbatim excerpt", () => {
    const header = claimsToCsv([]).split("\r\n")[0];
    expect(header).toContain("Evidence Summary");
    expect(header).not.toContain("Evidence Excerpt");
  });

  it("exports the real API source excerpt in its own column, separate from the summary", () => {
    const csv = claimsToCsv([
      claim({
        evidence: [
          { excerpt: "AI summary one", sourceExcerpt: "Verbatim cited text", sourceUrl: "https://a.com", sourceTitle: "A", publicationDate: "" },
          { excerpt: "AI summary two", sourceUrl: "https://b.com", sourceTitle: "B", publicationDate: "" }, // no API excerpt
        ],
      }),
    ]);
    const rows = csv.split("\r\n");
    expect(rows[0]).toContain("Source Excerpt");
    // Source Excerpt is its own column (index 4), distinct from Evidence Summary (index 3).
    expect(rows[1].split(",")[4]).toBe("Verbatim cited text");
    expect(rows[1].split(",")[3]).toBe("AI summary one");
    // Missing API excerpt → blank, never copied from the summary.
    expect(rows[2].split(",")[4]).toBe("");
  });

  it("exports source-attribution provenance honestly (yes/no/blank)", () => {
    const csv = claimsToCsv([
      claim({
        evidence: [
          { excerpt: "s", sourceUrl: "https://a.com", sourceTitle: "A", publicationDate: "", sourceRetrieved: true },
          { excerpt: "s", sourceUrl: "https://b.com", sourceTitle: "B", publicationDate: "", sourceRetrieved: false },
          { excerpt: "s", sourceUrl: "https://c.com", sourceTitle: "C", publicationDate: "" }, // un-grounded
        ],
      }),
    ]);
    const rows = csv.split("\r\n");
    expect(rows[0]).toContain("Source Retrieved");
    expect(rows[1].split(",")).toContain("yes");
    expect(rows[2].split(",")).toContain("no");
    // Un-grounded evidence leaves the cell blank, never "yes".
    expect(rows[3]).not.toContain("yes");
  });

  it("writes one row per evidence item and preserves the source URL", () => {
    const csv = claimsToCsv([
      claim({
        evidence: [
          { excerpt: "a", sourceUrl: "https://one.com/x", sourceTitle: "One", publicationDate: "2024-01-01" },
          { excerpt: "b", sourceUrl: "https://two.com/y", sourceTitle: "Two", publicationDate: "2024-02-02" },
        ],
      }),
    ]);
    const rows = csv.split("\r\n");
    expect(rows).toHaveLength(3); // header + 2 evidence rows
    expect(csv).toContain("https://one.com/x");
    expect(csv).toContain("https://two.com/y");
  });

  it("still emits one row for a claim with no evidence", () => {
    const csv = claimsToCsv([claim({ claim: "lonely", evidence: [] })]);
    expect(csv.split("\r\n")).toHaveLength(2);
    expect(csv).toContain("lonely");
  });

  it("escapes commas, quotes, and newlines per RFC 4180", () => {
    const csv = claimsToCsv([
      claim({ claim: 'has "quote", comma\nand newline', reasoning: "r" }),
    ]);
    expect(csv).toContain('"has ""quote"", comma\nand newline"');
  });
});

describe("MOCKED — countByVerdict", () => {
  it("counts every verdict category", () => {
    const counts = countByVerdict([
      claim({ verdict: "Supported" }),
      claim({ verdict: "Supported" }),
      claim({ verdict: "Contradicted" }),
      claim({ verdict: "Mixed Evidence" }),
      claim({ verdict: "Insufficient Evidence" }),
      claim({ verdict: "Potentially Outdated" }),
    ]);
    expect(counts).toEqual({
      Supported: 2,
      Contradicted: 1,
      "Mixed Evidence": 1,
      "Insufficient Evidence": 1,
      "Potentially Outdated": 1,
    });
  });
});
