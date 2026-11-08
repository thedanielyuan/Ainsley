import Anthropic from "@anthropic-ai/sdk";
import { describeError } from "@/lib/server/anthropic";
import { extractFile, UnsupportedFileError } from "@/lib/server/extract";
import { transcribeImage, transcribePdf } from "@/lib/server/transcribe";
import type { MaterialPage } from "@/lib/types";

const MAX_BYTES = 32 * 1024 * 1024;

/**
 * Transcribes a photo or scanned PDF in the student's library, sent again from their device
 * (where the original is kept), so its text can be searched. The browser calls this in the
 * background after such a file is added, and once for each one added before this existed.
 *
 * A 422 means trying again won't help; any other failure may be temporary.
 */
export async function POST(req: Request) {
  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return Response.json({ error: "Expected a multipart upload with a file field." }, { status: 400 });
  }
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "No file was uploaded." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "Files can be up to 32 MB." }, { status: 413 });
  }

  try {
    const data = Buffer.from(await file.arrayBuffer());
    const extracted = await extractFile(data, file.name, file.type);
    let pages: MaterialPage[];
    if (extracted.kind === "image" && extracted.upload) {
      const text = await transcribeImage(extracted.upload.data, extracted.upload.mimeType, req.signal);
      pages = [{ n: 1, text }];
    } else if (extracted.kind === "pdf" && extracted.scanned) {
      pages = await transcribePdf(data, extracted.pageCount, req.signal);
    } else {
      return Response.json({ error: "Only photos and scanned PDFs need transcribing." }, { status: 422 });
    }
    return Response.json({ pages });
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    if (err instanceof UnsupportedFileError) return Response.json({ error: err.message }, { status: 422 });
    console.error("[ainsley] transcription failed:", err);
    const lasting =
      err instanceof Anthropic.BadRequestError ||
      err instanceof Anthropic.PermissionDeniedError ||
      err instanceof Anthropic.NotFoundError;
    return Response.json({ error: describeError(err) }, { status: lasting ? 422 : 502 });
  }
}
