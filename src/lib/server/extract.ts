import "server-only";
import { strFromU8, unzipSync, type Unzipped } from "fflate";
import sharp, { type Metadata } from "sharp";
import { extractText, getDocumentProxy } from "unpdf";
import type { MaterialKind, MaterialPage } from "@/lib/types";

/** What the upload route needs to know after reading a file. */
export interface Extracted {
  kind: MaterialKind;
  mimeType: string;
  pageCount: number;
  pages: MaterialPage[];
  scanned?: boolean;
  /** Bytes to store with the Files API, for files Ainsley AI can view directly (PDFs, images). */
  upload?: { data: Buffer; mimeType: string; name: string };
  thumbnail?: string;
}

export class UnsupportedFileError extends Error {}

const MAX_PDF_PAGES = 600; // The Messages API's PDF limit on 1M-context models.
const SECTION_CHARS = 4000;
const IMAGE_MAX_SIDE = 2000; // Stays within the many-images limit when a chat has lots of photos.

export async function extractFile(data: Buffer, fileName: string, declaredType: string): Promise<Extracted> {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (isPdf(data)) return extractPdf(data, fileName);
  if (isZip(data) && ext === "pptx") return extractPptx(data);
  if (isZip(data) && ext === "docx") return extractDocx(data);
  if (declaredType.startsWith("image/") || ["jpg", "jpeg", "png", "webp", "gif", "heic", "heif"].includes(ext)) {
    return extractImage(data, fileName, ext);
  }
  if (declaredType.startsWith("text/") || ["txt", "md", "markdown"].includes(ext)) {
    return extractPlainText(data);
  }
  throw new UnsupportedFileError(
    "This file type isn't supported. Use PDFs, slides (.pptx), Word documents (.docx), text, or photos.",
  );
}

const isPdf = (b: Buffer) => b.subarray(0, 1024).includes("%PDF-");
const isZip = (b: Buffer) => b[0] === 0x50 && b[1] === 0x4b;

function tidy(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------- PDF ----------

async function extractPdf(data: Buffer, fileName: string): Promise<Extracted> {
  let text: string[];
  let totalPages: number;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(data));
    ({ text, totalPages } = await extractText(pdf, { mergePages: false }));
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "PasswordException") {
      throw new UnsupportedFileError("This PDF is password-protected. Remove the password and upload it again.");
    }
    throw new UnsupportedFileError("This PDF couldn't be read. It may be damaged; try exporting it again.");
  }
  if (totalPages > MAX_PDF_PAGES) {
    throw new UnsupportedFileError(
      `This PDF has ${totalPages} pages; the limit is ${MAX_PDF_PAGES}. Split it (by chapter, say) and upload the parts.`,
    );
  }
  const pages = text.map((t, i) => ({ n: i + 1, text: tidy(t) }));
  const chars = pages.reduce((sum, p) => sum + p.text.length, 0);
  return {
    kind: "pdf",
    mimeType: "application/pdf",
    pageCount: totalPages,
    pages,
    // Scans and photos-as-PDF have little or no text layer.
    scanned: chars < Math.max(40, totalPages * 25),
    upload: { data, mimeType: "application/pdf", name: fileName },
  };
}

// ---------- Office files ----------

function decodeXml(s: string) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, "&");
}

function unzip(data: Buffer, keep: (name: string) => boolean): Unzipped {
  try {
    return unzipSync(new Uint8Array(data), { filter: (f) => keep(f.name) });
  } catch {
    throw new UnsupportedFileError("This file couldn't be opened. It may be damaged; try saving it again.");
  }
}

/** Text of DrawingML paragraphs (<a:p>), skipping fields such as slide numbers. */
function drawingText(xml: string) {
  const paragraphs: string[] = [];
  for (const [p] of xml.matchAll(/<a:p>[\s\S]*?<\/a:p>|<a:p [\s\S]*?<\/a:p>/g)) {
    const withoutFields = p.replace(/<a:fld\b[\s\S]*?<\/a:fld>/g, "");
    const runs = [...withoutFields.matchAll(/<a:t>([\s\S]*?)<\/a:t>|<a:t [^>]*>([\s\S]*?)<\/a:t>/g)].map(
      (m) => decodeXml(m[1] ?? m[2] ?? ""),
    );
    const line = runs.join("").trim();
    if (line) paragraphs.push(line);
  }
  return paragraphs.join("\n");
}

function relTargets(relsXml: string | undefined) {
  const map = new Map<string, { target: string; type: string }>();
  if (!relsXml) return map;
  for (const [tag] of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    const type = /\bType="([^"]+)"/.exec(tag)?.[1] ?? "";
    if (id && target) map.set(id, { target, type });
  }
  return map;
}

function resolvePath(base: string, target: string) {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/").slice(0, -1);
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

function extractPptx(data: Buffer): Extracted {
  const files = unzip(
    data,
    (n) =>
      n === "ppt/presentation.xml" ||
      n === "ppt/_rels/presentation.xml.rels" ||
      /^ppt\/(slides|notesSlides)\/(_rels\/)?[^/]+\.xml(\.rels)?$/.test(n),
  );
  const read = (path: string) => (files[path] ? strFromU8(files[path]) : undefined);

  // Slide order comes from presentation.xml, not file names (decks get reordered).
  const presentation = read("ppt/presentation.xml") ?? "";
  const rels = relTargets(read("ppt/_rels/presentation.xml.rels"));
  let slidePaths = [...presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)]
    .map((m) => rels.get(m[1])?.target)
    .filter((t): t is string => Boolean(t))
    .map((t) => resolvePath("ppt/presentation.xml", t));
  if (slidePaths.length === 0) {
    slidePaths = Object.keys(files)
      .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
      .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1]));
  }
  if (slidePaths.length === 0) throw new UnsupportedFileError("No slides were found in this file.");

  const pages = slidePaths.map((path, i) => {
    const xml = read(path) ?? "";
    const parts = [drawingText(xml)];
    const pictures = (xml.match(/<p:pic\b/g) ?? []).length;
    const slideRels = relTargets(read(path.replace(/slides\/([^/]+)$/, "slides/_rels/$1.rels")));
    const notesRel = [...slideRels.values()].find((r) => r.type.endsWith("/notesSlide"));
    const notes = notesRel ? drawingText(read(resolvePath(path, notesRel.target)) ?? "") : "";
    if (notes) parts.push(`Speaker notes: ${notes}`);
    if (pictures > 0) parts.push(`[${pictures} image${pictures === 1 ? "" : "s"} on this slide not included]`);
    return { n: i + 1, text: tidy(parts.filter(Boolean).join("\n\n")) };
  });

  return {
    kind: "slides",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    pageCount: pages.length,
    pages,
  };
}

function extractDocx(data: Buffer): Extracted {
  const files = unzip(data, (n) => n === "word/document.xml");
  const xml = files["word/document.xml"] ? strFromU8(files["word/document.xml"]) : "";
  if (!xml) throw new UnsupportedFileError("This doesn't look like a Word document.");

  const paragraphs: string[] = [];
  for (const [p] of xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)) {
    // Text runs, plus run-level tabs and line breaks.
    const line = [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab)\/>|<w:(br)\/>/g)]
      .map((m) => (m[1] !== undefined ? decodeXml(m[1]) : m[2] ? "\t" : "\n"))
      .join("")
      .trim();
    if (!line) continue;
    const heading = /<w:pStyle w:val="(?:Heading|Title)(\d?)"/.exec(p);
    paragraphs.push(heading ? `${"#".repeat(Math.min(Number(heading[1] || 1), 4))} ${line}` : line);
  }
  return textSections(paragraphs, {
    kind: "doc",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

// ---------- Plain text ----------

function extractPlainText(data: Buffer): Extracted {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(data);
  if (text.includes("\u0000")) throw new UnsupportedFileError("This file doesn't contain readable text.");
  return textSections(tidy(text).split(/\n{2,}/), { kind: "text", mimeType: "text/plain" });
}

/** Splits long text into ~4,000-character sections on paragraph boundaries. */
function textSections(
  paragraphs: string[],
  meta: { kind: MaterialKind; mimeType: string },
): Extracted {
  const pages: MaterialPage[] = [];
  let current = "";
  const flush = () => {
    if (current.trim()) pages.push({ n: pages.length + 1, text: tidy(current) });
    current = "";
  };
  for (const para of paragraphs) {
    if (current && current.length + para.length > SECTION_CHARS) flush();
    current += (current ? "\n\n" : "") + para;
  }
  flush();
  if (pages.length === 0) throw new UnsupportedFileError("No text was found in this file.");
  return { ...meta, pageCount: pages.length, pages };
}

// ---------- Images ----------

async function extractImage(data: Buffer, fileName: string, ext: string): Promise<Extracted> {
  let meta: Metadata;
  try {
    meta = await sharp(data, { failOn: "none" }).metadata();
  } catch {
    throw new UnsupportedFileError(
      ext === "heic" || ext === "heif"
        ? "HEIC photos aren't supported here yet. Export the photo as JPEG (or upload it from your phone's browser, which converts it)."
        : "This image couldn't be read.",
    );
  }

  // Phone photos carry their orientation in EXIF; bake it in, then fit within the size limit.
  const base = () =>
    sharp(data, { failOn: "none" })
      .rotate()
      .resize({ width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE, fit: "inside", withoutEnlargement: true });

  // Screenshots stay PNG (crisp text); photos become JPEG.
  let output: Buffer;
  let mimeType: string;
  if (meta.format === "png") {
    // Transparent diagrams are drawn for a white page.
    const img = meta.hasAlpha ? base().flatten({ background: "#ffffff" }) : base();
    output = await img.png({ compressionLevel: 9 }).toBuffer();
    mimeType = "image/png";
  } else {
    output = await base().flatten({ background: "#ffffff" }).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
    mimeType = "image/jpeg";
  }
  if (output.length > 4.5 * 1024 * 1024) {
    output = await base().flatten({ background: "#ffffff" }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
    mimeType = "image/jpeg";
  }

  const thumb = await sharp(output)
    .resize({ width: 240, height: 240, fit: "cover" })
    .jpeg({ quality: 72 })
    .toBuffer();

  const outName = fileName.replace(/\.[a-z0-9]+$/i, "") + (mimeType === "image/png" ? ".png" : ".jpg");
  return {
    kind: "image",
    mimeType,
    pageCount: 1,
    pages: [],
    upload: { data: output, mimeType, name: outName },
    thumbnail: `data:image/jpeg;base64,${thumb.toString("base64")}`,
  };
}
