// MOCKED (deterministic) tests for source-URL validation and reachability.
// The network is fully mocked — NO real HTTP, NOT a live test.
import { describe, it, expect, vi } from "vitest";
import { isValidHttpUrl, checkUrlReachable, annotateClaimUrls } from "@/app/lib/urlCheck";
import type { Claim } from "@/app/lib/types";

const resp = (status: number): Response => ({ ok: status < 400, status }) as unknown as Response;

describe("MOCKED — isValidHttpUrl (format only)", () => {
  it("accepts http and https", () => {
    expect(isValidHttpUrl("https://a.com/x")).toBe(true);
    expect(isValidHttpUrl("http://a.com")).toBe(true);
  });
  it("rejects non-http(s) and malformed URLs", () => {
    expect(isValidHttpUrl("ftp://a.com")).toBe(false);
    expect(isValidHttpUrl("not a url")).toBe(false);
    expect(isValidHttpUrl("")).toBe(false);
  });
});

describe("MOCKED — checkUrlReachable", () => {
  it("200 → reachable", async () => {
    const f = vi.fn(async () => resp(200));
    expect(await checkUrlReachable("https://a.com", { fetchImpl: f })).toMatchObject({
      urlValid: true,
      reachability: "reachable",
    });
  });

  it("passes redirect:follow so redirects are handled", async () => {
    const f = vi.fn(async () => resp(200));
    await checkUrlReachable("https://a.com", { fetchImpl: f });
    expect(f).toHaveBeenCalledWith("https://a.com", expect.objectContaining({ redirect: "follow" }));
  });

  it("403 and 429 → blocked (server exists, restricts access)", async () => {
    const f403 = vi.fn(async () => resp(403));
    const f429 = vi.fn(async () => resp(429));
    expect((await checkUrlReachable("https://a.com", { fetchImpl: f403 })).reachability).toBe("blocked");
    expect((await checkUrlReachable("https://a.com", { fetchImpl: f429 })).reachability).toBe("blocked");
  });

  it("404 and 500 → unreachable", async () => {
    const f404 = vi.fn(async () => resp(404));
    const f500 = vi.fn(async () => resp(500));
    expect((await checkUrlReachable("https://a.com", { fetchImpl: f404 })).reachability).toBe("unreachable");
    expect((await checkUrlReachable("https://a.com", { fetchImpl: f500 })).reachability).toBe("unreachable");
  });

  it("network error → unreachable (not an error, not 'false')", async () => {
    const f = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect((await checkUrlReachable("https://a.com", { fetchImpl: f })).reachability).toBe("unreachable");
  });

  it("falls back to GET when HEAD is unsupported (405)", async () => {
    const f = vi
      .fn<(...a: unknown[]) => Promise<Response>>()
      .mockResolvedValueOnce(resp(405))
      .mockResolvedValueOnce(resp(200));
    const r = await checkUrlReachable("https://a.com", { fetchImpl: f as unknown as typeof fetch });
    expect(r.reachability).toBe("reachable");
    expect(f).toHaveBeenCalledTimes(2);
    expect((f.mock.calls[0][1] as RequestInit).method).toBe("HEAD");
    expect((f.mock.calls[1][1] as RequestInit).method).toBe("GET");
  });

  it("malformed URL → skipped, fetch never called", async () => {
    const f = vi.fn(async () => resp(200));
    const r = await checkUrlReachable("not-a-url", { fetchImpl: f });
    expect(r).toMatchObject({ urlValid: false, reachability: "skipped" });
    expect(f).not.toHaveBeenCalled();
  });

  it("internal/private hosts → skipped (SSRF guard), fetch never called", async () => {
    const f = vi.fn(async () => resp(200));
    for (const url of ["http://localhost:3000", "http://127.0.0.1", "http://192.168.1.5", "http://10.0.0.1"]) {
      const r = await checkUrlReachable(url, { fetchImpl: f });
      expect(r.reachability).toBe("skipped");
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("timeout → unreachable (deterministic, fake timers)", async () => {
    vi.useFakeTimers();
    try {
      const hanging: typeof fetch = ((_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })) as unknown as typeof fetch;
      const p = checkUrlReachable("https://slow.com", { timeoutMs: 50, fetchImpl: hanging });
      await vi.advanceTimersByTimeAsync(60);
      expect((await p).reachability).toBe("unreachable");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("MOCKED — annotateClaimUrls never changes the verdict", () => {
  const base: Claim = {
    claim: "The Great Wall is visible from the Moon.",
    verdict: "Contradicted",
    reasoning: "r",
    evidence: [
      { excerpt: "e", sourceUrl: "https://nasa.example/x", sourceTitle: "NASA", publicationDate: "2020-01-01" },
    ],
  };

  it("an unreachable source does NOT flip the verdict and is marked unreachable", async () => {
    const f = vi.fn(async () => {
      throw new Error("down");
    });
    const [claim] = await annotateClaimUrls([base], { fetchImpl: f });
    expect(claim.verdict).toBe("Contradicted"); // unchanged
    expect(claim.evidence[0].reachability).toBe("unreachable");
    expect(claim.evidence[0].urlValid).toBe(true);
  });

  it("empty source URL is marked skipped without a fetch", async () => {
    const f = vi.fn(async () => resp(200));
    const withEmpty: Claim = { ...base, evidence: [{ ...base.evidence[0], sourceUrl: "" }] };
    const [claim] = await annotateClaimUrls([withEmpty], { fetchImpl: f });
    expect(claim.evidence[0].reachability).toBe("skipped");
    expect(claim.evidence[0].urlValid).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
});
