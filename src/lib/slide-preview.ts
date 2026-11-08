"use client";

import { getLibrary } from "./library";
import { loadSlidePreview, saveSlidePreview } from "./storage";

// Multiple citations/tabs can request the same deck while its first render is in flight.
const pending = new Map<string, Promise<Blob>>();

/** Render once through Ainsley's own server, then reuse the PDF on this device. */
export function getSlidePreview(materialId: string, original: Blob): Promise<Blob> {
  const existing = pending.get(materialId);
  if (existing) return existing;
  const task = renderSlides(materialId, original).finally(() => pending.delete(materialId));
  pending.set(materialId, task);
  return task;
}

async function renderSlides(materialId: string, original: Blob): Promise<Blob> {
  const cached = await loadSlidePreview(materialId).catch(() => undefined);
  if (cached) return cached;

  let response: Response;
  try {
    response = await fetch("/api/materials/preview", {
      method: "POST",
      headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
      body: original,
      signal: AbortSignal.timeout(110_000),
    });
  } catch {
    throw new Error("Couldn't prepare the slides. Check your connection and try again.");
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(detail?.error ?? "Couldn't prepare a preview of this presentation. Try again.");
  }
  if (!response.headers.get("content-type")?.startsWith("application/pdf")) {
    throw new Error("The slide preview couldn't be read. Try again.");
  }
  const pdf = await response.blob();
  if (pdf.size === 0 || pdf.size > 64 * 1024 * 1024 || !(await pdf.slice(0, 5).text()).startsWith("%PDF-")) {
    throw new Error("The slide preview couldn't be read. Try again.");
  }
  // A file can be deleted while conversion runs. Never bring its cache back afterwards.
  if (getLibrary().materials[materialId]) await saveSlidePreview(materialId, pdf).catch(() => undefined);
  return pdf;
}
