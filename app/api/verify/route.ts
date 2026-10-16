import { describeError, verifyClaim, verifyMemo } from "@/app/lib/verify";

// Fact-checking can involve many web searches, so give the request room to run.
export const maxDuration = 300;

const MAX_MEMO_CHARS = 60_000;
const MAX_CLAIM_CHARS = 2_000;

function mapError(err: unknown): Response {
  const { status, message } = describeError(err);
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  let body: { memo?: unknown; claim?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const memo = typeof body.memo === "string" ? body.memo.trim() : "";
  const claim = typeof body.claim === "string" ? body.claim.trim() : "";

  // Length validation up front, before the (expensive) API-key check.
  if (!memo && !claim) {
    return Response.json({ error: "Please provide a memo or claim to verify." }, { status: 400 });
  }
  if (memo.length > MAX_MEMO_CHARS) {
    return Response.json(
      { error: `Memo is too long (max ${MAX_MEMO_CHARS.toLocaleString()} characters).` },
      { status: 400 },
    );
  }
  if (claim.length > MAX_CLAIM_CHARS) {
    return Response.json(
      { error: `Claim is too long (max ${MAX_CLAIM_CHARS.toLocaleString()} characters).` },
      { status: 400 },
    );
  }

  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the server." },
      { status: 500 },
    );
  }

  try {
    // A single-claim request takes precedence (re-verification of one row).
    if (claim) {
      const result = await verifyClaim(claim);
      return Response.json({ claim: result });
    }
    const result = await verifyMemo(memo);
    return Response.json(result);
  } catch (err) {
    return mapError(err);
  }
}
