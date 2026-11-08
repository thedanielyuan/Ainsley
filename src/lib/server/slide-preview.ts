import "server-only";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { strToU8, unzipSync, zipSync } from "fflate";
import { getDocumentProxy } from "unpdf";

export const MAX_SLIDE_UPLOAD_BYTES = 32 * 1024 * 1024;
const MAX_PDF_BYTES = 64 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 256 * 1024 * 1024;
const MAX_XML_BYTES = 4 * 1024 * 1024;
const MAX_METADATA_BYTES = 16 * 1024 * 1024;
const MAX_SLIDES = 600;
const run = promisify(execFile);
let activePreviews = 0;

export class SlidePreviewError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
    this.name = "SlidePreviewError";
  }
}

/** Bound the upload buffer and conversion work together, rather than queueing large files. */
export async function withSlidePreviewSlot<T>(work: () => Promise<T>): Promise<T> {
  if (activePreviews >= 2) {
    throw new SlidePreviewError("Other slides are being prepared. Please try again in a moment.", 429);
  }
  activePreviews++;
  try {
    return await work();
  } finally {
    activePreviews--;
  }
}

function decodeAttribute(value: string) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      if (!Number.isSafeInteger(code) || code < 0 || code > 0x10ffff) throw new Error("Invalid XML character.");
      return String.fromCodePoint(code);
    }
    return ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" } as Record<string, string>)[entity.toLowerCase()];
  });
}

function attributes(tag: string) {
  return Object.fromEntries([...tag.matchAll(/([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g)]
    .map((match) => [match[1], decodeAttribute(match[3])]));
}

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeAttribute = (value: string) => value.replace(/[&<>"]/g, (c) => XML_ESCAPES[c]);

/** A relationships part holding just these relationships. */
function relationshipsPart(relations: Array<Record<string, string>>) {
  const items = relations.map((relation) =>
    `<Relationship ${Object.entries(relation).map(([name, value]) => `${name}="${escapeAttribute(value)}"`).join(" ")}/>`);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.join("")}</Relationships>`;
}

/** The deck again, with these parts replaced. Stored, not compressed: the copy only lives until it's converted. */
function replaceParts(data: Buffer, replacements: Map<string, string>) {
  const parts = unzipSync(data);
  for (const [name, text] of replacements) parts[name] = strToU8(text);
  return zipSync(parts, { level: 0 });
}

/**
 * Inspect the ZIP directory before inflating metadata or letting Office open the file. Returns the
 * slide count, and the deck to convert: the original, or a copy without its links to outside files.
 */
function inspectPresentation(data: Buffer): { slides: number; deck: Uint8Array } {
  const files = new Set<string>();
  let totalSize = 0;
  let metadataSize = 0;
  const metadata = (name: string) => /\.(xml|rels)$/i.test(name);
  try {
    if (data.length < 22 || data[0] !== 0x50 || data[1] !== 0x4b) throw new Error("Not a ZIP file.");
    unzipSync(data, { filter: (file) => {
      if (files.size >= 10_000 || files.has(file.name) || file.name.includes("\\") || file.name.startsWith("/") || file.name.split("/").includes("..")) {
        throw new Error("Invalid package paths.");
      }
      if (/vbaProject|vbaData|\.bin$/i.test(file.name) && /vba/i.test(file.name)) {
        throw new SlidePreviewError("Save a copy of this presentation without macros to preview it.");
      }
      if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0 || file.originalSize > MAX_PDF_BYTES || (file.compression !== 0 && file.compression !== 8)) {
        throw new Error("Invalid package entry.");
      }
      totalSize += file.originalSize;
      if (totalSize > MAX_UNPACKED_BYTES) throw new SlidePreviewError("This presentation is too large to preview. Try a smaller copy.", 413);
      if (metadata(file.name)) {
        metadataSize += file.originalSize;
        if (file.originalSize > MAX_XML_BYTES || metadataSize > MAX_METADATA_BYTES) throw new Error("Presentation metadata is too large.");
      }
      files.add(file.name);
      return false;
    } });
    if (!files.has("ppt/presentation.xml") || !files.has("ppt/_rels/presentation.xml.rels") || !files.has("[Content_Types].xml")) {
      throw new Error("Missing presentation parts.");
    }
    const parts = unzipSync(data, { filter: (file) => metadata(file.name) });
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const xml = new Map<string, string>();
    for (const [name, bytes] of Object.entries(parts)) {
      const text = decoder.decode(bytes);
      if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error("Unsupported XML entities.");
      xml.set(name, text);
    }
    const contentTypes = xml.get("[Content_Types].xml")!;
    if (/macroEnabled|vbaProject/i.test(contentTypes)) throw new SlidePreviewError("Save a copy of this presentation without macros to preview it.");
    if (!contentTypes.includes("application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml")) throw new Error("Not a PPTX presentation.");

    const slideTargets = new Map<string, string>();
    // Relationship parts that link to outside files, rewritten without those links.
    const unlinked = new Map<string, string>();
    for (const [name, text] of xml) {
      if (!name.endsWith(".rels")) continue;
      const kept: Array<Record<string, string>> = [];
      let linksOut = false;
      for (const match of text.matchAll(/<(?:[\w.-]+:)?Relationship\b[^>]*>/g)) {
        const relation = attributes(match[0]);
        if (!relation.Target || !relation.Type || !relation.Id) throw new Error("Invalid relationship.");
        if (relation.TargetMode?.toLowerCase() === "external") {
          // Hyperlinks load nothing. A linked picture, video or object could make Office fetch a
          // network or device file, so the link is dropped: Office draws the copy PowerPoint embeds
          // beside a linked picture (decks often link pictures on their author's own computer).
          if (relation.Type.endsWith("/hyperlink")) kept.push(relation);
          else linksOut = true;
          continue;
        }
        const owner = name.replace(/_rels\/([^/]+)\.rels$/, "$1");
        const target = relation.Target.startsWith("/")
          ? relation.Target.slice(1)
          : posix.normalize(posix.join(posix.dirname(owner), relation.Target));
        if (target.startsWith("../") || target.includes("\\") || /^[a-z][a-z\d+.-]*:/i.test(target)) throw new Error("Invalid relationship target.");
        if (name === "ppt/_rels/presentation.xml.rels" && relation.Type.endsWith("/slide")) slideTargets.set(relation.Id, target);
        kept.push(relation);
      }
      if (linksOut) unlinked.set(name, relationshipsPart(kept));
    }
    const presentation = xml.get("ppt/presentation.xml")!;
    // The slide list. Sections list the same slides again (by number, without a relationship id).
    const slideIds = [...presentation.matchAll(/<(?:[\w.-]+:)?sldId\b[^>]*>/g)]
      .map((match) => attributes(match[0])["r:id"])
      .filter((id): id is string => Boolean(id));
    if (!slideIds.length || slideIds.some((id) => !files.has(slideTargets.get(id) ?? ""))) throw new Error("No valid slide list.");
    if (slideIds.length > MAX_SLIDES) throw new SlidePreviewError(`Presentations can have up to ${MAX_SLIDES} slides. Split this deck into smaller parts.`, 413);
    return { slides: slideIds.length, deck: unlinked.size ? replaceParts(data, unlinked) : data };
  } catch (error) {
    if (error instanceof SlidePreviewError) throw error;
    throw new SlidePreviewError("This presentation couldn’t be opened. Try saving it as a new .pptx file.");
  }
}

async function findConverter() {
  const configured = process.env.SOFFICE_PATH?.trim();
  const candidates = configured ? [configured] : [
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/Applications/LibreOfficeDev.app/Contents/MacOS/soffice",
    "/usr/bin/libreoffice", "/usr/bin/soffice", "/usr/local/bin/soffice", "/opt/homebrew/bin/soffice",
    ...(process.env.PATH ?? "").split(delimiter).filter(Boolean).flatMap((directory) => [join(directory, "soffice"), join(directory, "libreoffice")]),
  ];
  for (const path of new Set(candidates)) {
    try { await access(path, constants.X_OK); return path; } catch { /* Try the next installed location. */ }
  }
  console.error("[ainsley] Slide preview converter unavailable. Install LibreOffice or set SOFFICE_PATH to its soffice executable.");
  throw new SlidePreviewError("Slide previews are temporarily unavailable. You can still read the text or download the original.", 503);
}

const PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
  <item oor:path="/org.openoffice.Office.Common/Security/Scripting">
    <prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop>
    <prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop>
    <prop oor:name="DisableActiveContent" oor:op="fuse"><value>true</value></prop>
    <prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop>
  </item>
</oor:items>`;

/** Render originals, including hidden slides, to keep citation numbers unchanged. */
export async function renderSlidePreview(data: Buffer, signal?: AbortSignal): Promise<Buffer> {
  const { slides, deck } = inspectPresentation(data);
  const executable = await findConverter();
  const directory = await mkdtemp(join(tmpdir(), "ainsley-slides-"));
  try {
    const profile = join(directory, "profile");
    await mkdir(join(profile, "user"), { recursive: true });
    await Promise.all([
      writeFile(join(directory, "input.pptx"), deck),
      writeFile(join(profile, "user", "registrymodifications.xcu"), PROFILE),
    ]);
    const options = JSON.stringify({
      ExportHiddenSlides: { type: "boolean", value: "true" },
      ExportNotesPages: { type: "boolean", value: "false" },
      ExportNotes: { type: "boolean", value: "false" },
      UseLosslessCompression: { type: "boolean", value: "true" },
      ReduceImageResolution: { type: "boolean", value: "false" },
      PDFViewSelection: { type: "long", value: "3" },
    });
    await run(executable, [
      `-env:UserInstallation=${pathToFileURL(profile).href}`,
      "--headless", "--nologo", "--nodefault", "--norestore",
      "--convert-to", `pdf:impress_pdf_Export:${options}`,
      "--outdir", directory, join(directory, "input.pptx"),
    ], { timeout: 75_000, killSignal: "SIGKILL", maxBuffer: 128 * 1024, windowsHide: true, signal });
    const output = join(directory, "input.pdf");
    const outputSize = (await stat(output)).size;
    if (outputSize > MAX_PDF_BYTES) throw new SlidePreviewError("The slide preview is too large. Try a smaller presentation.", 413);
    const pdf = await readFile(output);
    if (!pdf.subarray(0, 1024).includes("%PDF-")) throw new Error("Converter did not produce a PDF.");
    const document = await getDocumentProxy(new Uint8Array(pdf));
    try {
      if (document.numPages !== slides) throw new Error(`Expected ${slides} slides; rendered ${document.numPages} pages.`);
    } finally {
      await document.loadingTask.destroy();
    }
    return pdf;
  } catch (error) {
    if (error instanceof SlidePreviewError) throw error;
    console.error("[ainsley] Slide preview failed:", error);
    throw new SlidePreviewError("This presentation couldn’t be previewed. Try again, or download the original.", 502);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch((error) => console.error("[ainsley] Could not clean up slide preview files:", error));
  }
}
