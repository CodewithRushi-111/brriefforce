import { describeError, verifyMemo } from "@/app/lib/verify";
import type { StreamEvent } from "@/app/lib/types";

// Fact-checking can involve many web searches, so give the request room to run.
export const maxDuration = 300;

const MAX_MEMO_CHARS = 60_000;

/** Streams verification progress as Server-Sent Events, ending with a result or error. */
export async function POST(request: Request) {
  let memo = "";
  try {
    const body = (await request.json()) as { memo?: unknown };
    memo = typeof body.memo === "string" ? body.memo.trim() : "";
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Pre-flight validation uses plain JSON so the client can read the error before
  // committing to reading a stream.
  if (!memo) {
    return Response.json({ error: "Please provide a memo to verify." }, { status: 400 });
  }
  if (memo.length > MAX_MEMO_CHARS) {
    return Response.json(
      { error: `Memo is too long (max ${MAX_MEMO_CHARS.toLocaleString()} characters).` },
      { status: 400 },
    );
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not set. Add it to .env.local and restart the server." },
      { status: 500 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true; // controller already torn down (client gone)
        }
      };

      try {
        const result = await verifyMemo(memo, send, request.signal);
        send({ type: "result", claims: result.claims });
      } catch (err) {
        // A client disconnect surfaces as an abort — nothing to report.
        if (request.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
          // fall through to close
        } else {
          send({ type: "error", message: describeError(err).message });
        }
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
