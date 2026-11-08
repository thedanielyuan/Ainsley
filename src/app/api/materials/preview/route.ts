import { MAX_SLIDE_UPLOAD_BYTES, renderSlidePreview, SlidePreviewError, withSlidePreviewSlot } from "@/lib/server/slide-preview";

const PPTX_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

async function readPresentation(request: Request) {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_SLIDE_UPLOAD_BYTES) throw new SlidePreviewError("Files can be up to 32 MB.", 413);
  if (!request.body) throw new SlidePreviewError("This file is empty.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel().catch(() => undefined);
  }, 15_000);
  try {
    while (true) {
      const chunk = await reader.read();
      if (timedOut) throw new SlidePreviewError("The file took too long to upload. Please try again.", 408);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_SLIDE_UPLOAD_BYTES) {
        await reader.cancel();
        throw new SlidePreviewError("Files can be up to 32 MB.", 413);
      }
      chunks.push(chunk.value);
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  if (!size) throw new SlidePreviewError("This file is empty.", 400);
  return Buffer.concat(chunks, size);
}

/** Existing device-local slide files are converted only when their preview is opened. */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return Response.json({ error: "Open this preview from Ainsley." }, { status: 403, headers: HEADERS });
  }
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== PPTX_TYPE) {
    return Response.json({ error: "Choose a PowerPoint (.pptx) file to preview." }, { status: 415, headers: HEADERS });
  }
  try {
    return await withSlidePreviewSlot(async () => {
      const data = await readPresentation(request);
      const pdf = await renderSlidePreview(data, request.signal);
      return new Response(new Uint8Array(pdf), {
        headers: { ...HEADERS, "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="slides.pdf"' },
      });
    });
  } catch (error) {
    if (error instanceof SlidePreviewError) return Response.json({ error: error.message }, { status: error.status, headers: HEADERS });
    console.error("[ainsley] Could not read slide preview upload:", error);
    return Response.json({ error: "The slide preview couldn’t be prepared. Please try again." }, { status: 500, headers: HEADERS });
  }
}
