import Anthropic, { toFile } from "@anthropic-ai/sdk";
import { getClient, missingKeyMessage } from "@/lib/server/anthropic";
import { extractFile, UnsupportedFileError } from "@/lib/server/extract";
import type { ProcessedUpload } from "@/lib/types";

const MAX_BYTES = 32 * 1024 * 1024;

/**
 * Reads an uploaded file: extracts its text (for search and for formats Claude can't open
 * directly) and stores PDFs and images with the Files API, so chats can reference them by
 * id instead of re-sending the bytes on every turn.
 */
export async function POST(req: Request) {
  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return Response.json({ error: "Expected a multipart upload with a file field." }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return Response.json({ error: "No file was uploaded." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "Files can be up to 32 MB." }, { status: 413 });
  }
  if (file.size === 0) {
    return Response.json({ error: "This file is empty." }, { status: 400 });
  }

  try {
    const data = Buffer.from(await file.arrayBuffer());
    const extracted = await extractFile(data, file.name, file.type);

    let fileId: string | undefined;
    if (extracted.upload) {
      const stored = await getClient().files.upload({
        file: await toFile(extracted.upload.data, extracted.upload.name, {
          type: extracted.upload.mimeType,
        }),
      });
      fileId = stored.id;
    }

    const result: ProcessedUpload = {
      name: file.name,
      kind: extracted.kind,
      mimeType: extracted.mimeType,
      size: file.size,
      pageCount: extracted.pageCount,
      fileId,
      pages: extracted.pages,
      scanned: extracted.scanned,
      thumbnail: extracted.thumbnail,
    };
    return Response.json(result);
  } catch (err) {
    if (err instanceof UnsupportedFileError) {
      return Response.json({ error: err.message }, { status: 415 });
    }
    console.error("[ainsley] upload failed:", err);
    return Response.json({ error: describeError(err) }, { status: 500 });
  }
}

/** Deletes a stored file when the student removes it from their library. */
export async function DELETE(req: Request) {
  const fileId = new URL(req.url).searchParams.get("fileId") ?? "";
  if (!/^file_[A-Za-z0-9_-]{8,}$/.test(fileId)) {
    return Response.json({ error: "Invalid file id." }, { status: 400 });
  }
  try {
    await getClient().files.delete(fileId);
  } catch (err) {
    if (!(err instanceof Anthropic.NotFoundError)) {
      console.error("[ainsley] file delete failed:", err);
      return Response.json({ error: "Couldn't delete the file." }, { status: 502 });
    }
  }
  return new Response(null, { status: 204 });
}

function describeError(err: unknown) {
  if (err instanceof Anthropic.AuthenticationError) {
    return "Ainsley couldn't authenticate with the Claude API. Check ANTHROPIC_API_KEY in .env.local.";
  }
  if (err instanceof Anthropic.RateLimitError) return "Too many uploads right now. Wait a moment and try again.";
  if (err instanceof Anthropic.BadRequestError) return `The file was rejected: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach the Claude API. Check your connection.";
  if (err instanceof Anthropic.APIError) return `Claude API error${err.status ? ` (${err.status})` : ""}. Try again.`;
  return missingKeyMessage() ?? "Something went wrong while reading this file.";
}
