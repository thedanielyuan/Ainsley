"use client";

import { Download, Ellipsis, ExternalLink, FileQuestion, LoaderCircle, Minus, Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { pageUnit, useLibrary } from "@/lib/library";
import { getSlidePreview } from "@/lib/slide-preview";
import { loadFile } from "@/lib/storage";
import type { Material } from "@/lib/types";
import { usePagedScroll, type PageJump } from "@/lib/use-paged-scroll";
import { cn } from "@/lib/utils";
import { fileSummary } from "./attachments";
import { Menu } from "./menu";
import { clampZoom, MAX_ZOOM, MIN_ZOOM, PdfPages } from "./pdf-pages";
import { IconButton } from "./ui";

type LoadedFile =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; blob: Blob; downloadUrl: string; previewUrl?: string };

type View = "preview" | "text";
/** Where the student is, as last reported by the view that's showing (`view`). */
type Position = { page: number; count: number; view: View | null };

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const TOOL_BUTTON =
  "grid size-7 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-ink/[0.06] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

function PreviewNotice({ children, loading = false }: { children: ReactNode; loading?: boolean }) {
  return (
    <div className="flex min-h-48 flex-1 flex-col items-center justify-center gap-3 px-8 py-12 text-center" role="status">
      {loading ? (
        <LoaderCircle className="size-6 animate-spin text-accent-soft" />
      ) : (
        <FileQuestion className="size-7 text-subtle" />
      )}
      <div className="max-w-sm text-sm leading-6 text-muted">{children}</div>
    </div>
  );
}

/**
 * A student's local file, opened inside a workspace tab without leaving the chat. All of its
 * pages scroll in one column; `revision` changes when a citation asks for `page` again.
 */
export function MaterialPreview({
  materialId,
  page = 1,
  revision = 0,
}: {
  materialId: string;
  page?: number;
  revision?: number;
}) {
  const library = useLibrary();
  const material = library.materials[materialId];

  if (!library.ready) return <PreviewNotice loading>Loading your file…</PreviewNotice>;
  if (!material) return <PreviewNotice>This file is no longer in your materials.</PreviewNotice>;

  return <PreviewBody key={materialId} material={material} requestedPage={page} revision={revision} />;
}

function PreviewBody({
  material,
  requestedPage,
  revision,
}: {
  material: Material;
  requestedPage: number;
  revision: number;
}) {
  const [file, setFile] = useState<LoadedFile>({ status: "loading" });
  const [view, setView] = useState<View>("preview");
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState<Position>({ page: requestedPage, count: 0, view: null });
  const [jump, setJump] = useState<PageJump>({ page: requestedPage, seq: 0 });
  // A citation for this file asks again (even for the same page): scroll there.
  const [seenRevision, setSeenRevision] = useState(revision);
  if (revision !== seenRevision) {
    setSeenRevision(revision);
    setJump({ page: requestedPage, seq: jump.seq + 1 });
  }

  const { id, kind } = material;
  const isPdf = kind === "pdf";
  const isSlides = kind === "slides";
  const isImage = kind === "image";
  const unit = pageUnit(kind);
  const hasText = material.pages.some((p) => p.text.trim());
  const original = file.status === "ready" ? file.blob : undefined;
  const previewUrl = file.status === "ready" ? file.previewUrl : undefined;

  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];

    void loadFile(id)
      .then((blob) => {
        if (cancelled) return;
        if (!blob) {
          setFile({ status: "missing" });
          return;
        }
        // Only PDFs and browser-supported raster images get a viewable URL. In particular,
        // documents and text files never run as an HTML document in a same-origin tab.
        const previewType = kind === "pdf" ? "application/pdf" : kind === "image" && IMAGE_TYPES.has(blob.type) ? blob.type : null;
        const downloadUrl = URL.createObjectURL(new Blob([blob], { type: "application/octet-stream" }));
        urls.push(downloadUrl);
        const previewUrl = previewType ? URL.createObjectURL(new Blob([blob], { type: previewType })) : undefined;
        if (previewUrl) urls.push(previewUrl);
        setFile({ status: "ready", blob, downloadUrl, previewUrl });
      })
      .catch(() => {
        if (!cancelled) setFile({ status: "missing" });
      });

    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [id, kind]);

  // PDFs and slides show their original pages; documents, text files and files whose original
  // isn't on this device show the extracted text.
  const drawable = (isPdf || isSlides) && file.status !== "missing";
  const showText = !isImage && (!drawable || view === "text");
  const canSwitch = drawable && hasText && file.status === "ready";
  // Page and zoom controls appear once the view showing has laid its pages out.
  const shown = !isImage && position.view === (showText ? "text" : "preview") ? position : null;

  const switchView = (next: View) => {
    if (next === view) return;
    setView(next);
    setJump({ page: position.page, seq: jump.seq + 1 });
  };
  const goTo = (page: number) => setJump({ page, seq: jump.seq + 1 });
  const reporter = (view: View) => (page: number, count: number) =>
    setPosition((current) =>
      current.page === page && current.count === count && current.view === view ? current : { page, count, view },
    );
  const pagesViewer = { jump, onPage: reporter("preview") };
  const textViewer = { jump, onPage: reporter("text") };
  const toText = hasText ? { label: "Show text instead", onSelect: () => switchView("text") } : undefined;

  const fileItems =
    file.status === "ready"
      ? [
          ...(previewUrl
            ? [
                {
                  key: "open",
                  label: "Open in new tab",
                  icon: <ExternalLink className="size-4" />,
                  onSelect: () => openLink(isPdf ? `${previewUrl}#page=${position.page}` : previewUrl),
                },
              ]
            : []),
          {
            key: "download",
            label: "Download original",
            icon: <Download className="size-4" />,
            onSelect: () => openLink(file.downloadUrl, file.blob instanceof File ? file.blob.name : material.name),
          },
        ]
      : [];

  let content: ReactNode;
  if (isImage) {
    content = <ImageView material={material} file={file} url={previewUrl} />;
  } else if (showText) {
    content = hasText ? (
      <TextPages key="text" material={material} {...textViewer} />
    ) : (
      <PreviewNotice>
        {material.scanned
          ? file.status === "missing"
            ? "This scanned PDF has no saved text, and its original isn’t available on this device. Add the file again to preview it."
            : "This is a scanned PDF without selectable text."
          : file.status === "missing"
            ? "The original file isn’t available on this device. Add it to your materials again to preview it."
            : `No text was extracted from this file. Download the original to see its full layout.`}
      </PreviewNotice>
    );
  } else if (!original) {
    content = <PreviewNotice loading>Loading your file…</PreviewNotice>;
  } else if (isSlides) {
    content = (
      <RenderedSlides key="slides" material={material} original={original} zoom={zoom} onZoom={setZoom} fallback={toText} {...pagesViewer} />
    );
  } else {
    content = (
      <PdfPages key="pages" pdf={original} title={material.name} unit={unit} zoom={zoom} onZoom={setZoom} fallback={toText} {...pagesViewer} />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-2.5">
        {canSwitch ? (
          <div role="group" aria-label="View" className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-ink/[0.05] p-0.5">
            {(["preview", "text"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={value === (showText ? "text" : "preview")}
                onClick={() => switchView(value)}
                className={cn(
                  "h-6 rounded-md px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                  value === (showText ? "text" : "preview")
                    ? "bg-elevated text-fg shadow-[0_1px_2px_rgb(0_0_0/0.12)]"
                    : "text-subtle hover:text-fg",
                )}
              >
                {value === "preview" ? "Preview" : "Text"}
              </button>
            ))}
          </div>
        ) : (
          <span className="min-w-0 truncate px-1 text-xs text-subtle">{fileSummary(kind, material.pageCount)}</span>
        )}

        <div className="ms-auto flex shrink-0 items-center gap-0.5">
          {shown && shown.count > 1 && <PageField position={shown} unit={unit} onJump={goTo} />}
          {shown?.view === "preview" && (
            <>
              <span aria-hidden="true" className="mx-1 h-4 w-px bg-line" />
              <ZoomControls zoom={zoom} onZoom={setZoom} />
            </>
          )}
          {fileItems.length > 0 && (
            <Menu
              label="File options"
              width={208}
              triggerClassName={cn(TOOL_BUTTON, "ms-1")}
              trigger={<Ellipsis className="size-4" />}
              items={fileItems}
            />
          )}
        </div>
      </div>

      {file.status === "missing" && !isImage && hasText && (
        <p role="status" className="shrink-0 border-b border-line px-4 py-2.5 text-xs leading-5 text-subtle">
          The original file isn’t available on this device. Showing the saved text.
        </p>
      )}

      {content}
    </div>
  );
}

/** Opens a link from a menu item: a new tab, or a download when given a file name. */
function openLink(href: string, download?: string) {
  const link = document.createElement("a");
  link.href = href;
  if (download) link.download = download;
  else {
    link.target = "_blank";
    link.rel = "noreferrer noopener";
  }
  link.click();
}

/** "3 / 24": the page in view. Type a number to go straight to it. */
function PageField({ position, unit, onJump }: { position: Position; unit: string; onJump: (page: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancel = useRef(false);
  const { page, count } = position;

  const commit = () => {
    const value = Number.parseInt(draft ?? "", 10);
    if (!cancel.current && Number.isFinite(value)) onJump(Math.min(count, Math.max(1, value)));
    cancel.current = false;
    setDraft(null);
  };

  return (
    <label className="flex items-center gap-1 text-xs tabular-nums text-subtle">
      <input
        inputMode="numeric"
        aria-label={`${unit.charAt(0).toUpperCase() + unit.slice(1)} number, of ${count}`}
        value={draft ?? String(page)}
        onFocus={(e) => {
          setDraft(String(page));
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 5))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            cancel.current = true;
            e.currentTarget.blur();
          }
        }}
        style={{ width: `${Math.max(2, String(count).length) + 1.5}ch` }}
        className="h-7 rounded-md bg-transparent text-center text-xs text-fg outline-none transition-colors hover:bg-ink/[0.06] focus:bg-ink/[0.06]"
      />
      <span aria-hidden="true">/ {count}</span>
    </label>
  );
}

function ZoomControls({ zoom, onZoom }: { zoom: number; onZoom: (zoom: number) => void }) {
  // Steps of 25%, from wherever pinching left the zoom.
  const step = (direction: 1 | -1) =>
    onZoom(clampZoom(direction > 0 ? (Math.floor(zoom * 4 + 0.01) + 1) / 4 : (Math.ceil(zoom * 4 - 0.01) - 1) / 4));
  const fit = Math.abs(zoom - 1) < 0.005;
  return (
    <div role="group" aria-label="Zoom" className="flex items-center">
      <IconButton label="Zoom out" className="size-7 rounded-lg" disabled={zoom <= MIN_ZOOM + 0.001} onClick={() => step(-1)}>
        <Minus className="size-3.5" />
      </IconButton>
      <button
        type="button"
        aria-label={fit ? "Fit to width" : `Zoom ${Math.round(zoom * 100)}%, fit to width`}
        title="Fit to width"
        onClick={() => onZoom(1)}
        className="h-7 min-w-11 rounded-lg px-1 text-xs tabular-nums text-muted transition-colors hover:bg-ink/[0.06] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        {fit ? "Fit" : `${Math.round(zoom * 100)}%`}
      </button>
      <IconButton label="Zoom in" className="size-7 rounded-lg" disabled={zoom >= MAX_ZOOM - 0.001} onClick={() => step(1)}>
        <Plus className="size-3.5" />
      </IconButton>
    </div>
  );
}

/** A document's extracted text, every page in one scroll with its page number above it. */
function TextPages({
  material,
  jump,
  onPage,
}: {
  material: Material;
  jump: PageJump;
  onPage: (page: number, count: number) => void;
}) {
  const unit = pageUnit(material.kind);
  const count = Math.max(1, material.pageCount, ...material.pages.map((p) => p.n));
  const text = new Map(material.pages.map((p) => [p.n, p.text]));
  const { scrollRef, register, onScroll } = usePagedScroll({
    count,
    jump,
    // Text rewraps at a new width, so the width is the layout.
    layout: (width) => (width > 0 ? String(width) : null),
    onPage,
  });

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      tabIndex={0}
      role="region"
      aria-label={`${material.name}, text`}
      className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain outline-none [overflow-anchor:none] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
    >
      <div className="mx-auto max-w-[720px] px-5 pb-10 sm:px-7">
        {Array.from({ length: count }, (_, index) => {
          const body = text.get(index + 1)?.trim();
          return (
            <section
              key={index}
              ref={(element) => register(index, element)}
              aria-label={`${unit} ${index + 1}`}
              className="border-t border-line pb-2 pt-6 first:border-t-0 first:pt-5"
            >
              <p className="mb-3 text-[11px] font-medium uppercase tracking-wider text-subtle">
                {unit} {index + 1}
              </p>
              {body ? (
                <div className="whitespace-pre-wrap break-words text-sm leading-7 text-fg">{body}</div>
              ) : (
                <p className="text-sm text-subtle">No text on this {unit}.</p>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ImageView({ material, file, url }: { material: Material; file: LoadedFile; url?: string }) {
  const [failed, setFailed] = useState<string[]>([]);
  const imageUrl = [url, material.thumbnail].find((candidate) => candidate && !failed.includes(candidate));

  if (file.status === "loading") return <PreviewNotice loading>Loading your file…</PreviewNotice>;
  if (!imageUrl) {
    return (
      <PreviewNotice>
        {file.status === "missing"
          ? "The original file isn’t available on this device. Add it to your materials again to preview it."
          : "This image format can’t be previewed here. Download the original to open it."}
      </PreviewNotice>
    );
  }
  return (
    <>
      {file.status === "missing" && (
        <p role="status" className="shrink-0 border-b border-line px-4 py-2.5 text-xs leading-5 text-subtle">
          The original file isn’t available on this device. Showing the saved image preview.
        </p>
      )}
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto overscroll-contain bg-well p-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- device-local blob or saved thumbnail */}
        <img
          src={imageUrl}
          alt={material.name}
          onError={() => setFailed((current) => [...current, imageUrl])}
          className="my-auto block max-w-full rounded-lg object-contain shadow-[0_1px_3px_rgb(0_0_0/0.2)]"
        />
      </div>
    </>
  );
}

/** Slides drawn from their PDF rendering (made once by Ainsley's server, then kept on this device). */
function RenderedSlides({
  material,
  original,
  jump,
  zoom,
  onZoom,
  onPage,
  fallback,
}: {
  material: Material;
  original: Blob;
  jump: PageJump;
  zoom: number;
  onZoom: (zoom: number) => void;
  onPage: (page: number, count: number) => void;
  fallback?: { label: string; onSelect: () => void };
}) {
  const [result, setResult] = useState<{ pdf: Blob } | { error: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { id } = material;

  useEffect(() => {
    let cancelled = false;
    void getSlidePreview(id, original).then(
      (pdf) => {
        if (!cancelled) setResult({ pdf });
      },
      (error: unknown) => {
        if (!cancelled) setResult({ error: error instanceof Error ? error.message : "Couldn't preview these slides." });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [id, original, attempt]);

  if (!result) {
    return (
      <PreviewNotice loading>
        Preparing your slides…
        <span className="mt-1 block text-xs text-subtle">This may take a moment the first time.</span>
      </PreviewNotice>
    );
  }
  if ("error" in result) {
    return (
      <PreviewNotice>
        <p>{result.error}</p>
        <span className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setAttempt((current) => current + 1);
            }}
            className="inline-flex h-8 items-center rounded-xl border border-line px-3 text-sm text-fg transition-colors hover:bg-ink/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            Try again
          </button>
          {fallback && (
            <button
              type="button"
              onClick={fallback.onSelect}
              className="inline-flex h-8 items-center rounded-xl border border-line px-3 text-sm text-fg transition-colors hover:bg-ink/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {fallback.label}
            </button>
          )}
        </span>
      </PreviewNotice>
    );
  }
  return (
    <PdfPages
      pdf={result.pdf}
      title={material.name}
      unit="slide"
      jump={jump}
      zoom={zoom}
      onZoom={onZoom}
      onPage={onPage}
      fallback={fallback}
    />
  );
}
