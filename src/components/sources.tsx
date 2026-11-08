"use client";

import { BookOpen, Globe } from "lucide-react";
import { createContext, useContext, useState } from "react";
import { parseMarkerHref } from "@/lib/citations";
import { pageUnit, useLibrary, type LibraryState } from "@/lib/library";
import type { MaterialKind, Source } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FileKindIcon } from "./attachments";
import { useWorkspace } from "./workspace-context";

function hostname(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A site's short name for a chip: "en.wikipedia.org" → "wikipedia", "bbc.co.uk" → "bbc". */
function siteName(url: string) {
  const parts = hostname(url).split(".");
  if (parts.length < 2) return parts[0];
  const secondLevel = parts.length > 2 && parts.at(-1)!.length === 2 && /^(co|com|ac|edu|gov|org|net)$/.test(parts.at(-2)!);
  return parts.at(secondLevel ? -3 : -2)!;
}

const SHORT_UNITS: Record<MaterialKind, string> = { pdf: "p.", slides: "slide", doc: "section", text: "section", image: "" };

function materialFor(source: Source, s: LibraryState) {
  return source.type === "material" && source.materialId ? s.materials[source.materialId] : undefined;
}

/** What a chip says: the site, or the file (without its extension) and page. */
function chipLabel(source: Source, s: LibraryState) {
  if (source.type === "web") return { name: siteName(source.url), page: "" };
  const material = materialFor(source, s);
  const name = (material?.name ?? source.title).replace(/\.[a-z0-9]{1,5}$/i, "");
  const unit = material ? SHORT_UNITS[material.kind] : "p.";
  return { name, page: source.page && unit ? `${unit} ${source.page}` : "" };
}

function sourceTitle(source: Source, s: LibraryState) {
  if (source.type === "web") return `${source.title} (${hostname(source.url)})`;
  const material = materialFor(source, s);
  const name = material?.name ?? source.title;
  return source.page ? `${name}, ${material ? pageUnit(material.kind) : "page"} ${source.page}` : name;
}

// ---------- Citations in a reply ----------

/** The sources of the reply being rendered, for its chips. */
export const ReplySourcesContext = createContext<{ messageId: string; sources: Source[] } | null>(null);

/** Each cited source opens directly: local files in the workspace, web pages in a new tab. */
export function CitationChip({ href }: { href: string }) {
  const reply = useContext(ReplySourcesContext);
  const workspace = useWorkspace();
  const library = useLibrary();
  if (!reply) return null;
  const refs = (parseMarkerHref(href) ?? []).filter((r) => reply.sources[r.n - 1]);
  const active = workspace.activeTab;

  return (
    <>
      {refs.map(({ n }) => {
        const source = reply.sources[n - 1];
        const { name, page } = chipLabel(source, library);
        const title = sourceTitle(source, library);
        const selected = workspace.isOpen && active?.kind === "material" && source.type === "material" &&
          active.materialId === source.materialId && (active.page ?? 1) === (source.page ?? 1);
        const className = cn(
          "ms-1 inline-flex h-5 max-w-[240px] -translate-y-px items-center gap-1 rounded-full px-2 align-middle text-xs font-medium leading-none transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
          selected ? "bg-accent/30 text-fg" : "bg-ink/[0.08] text-muted hover:bg-ink/[0.14] hover:text-fg",
        );
        const label = (
          <>
            {source.type === "material" && <BookOpen className="size-3 shrink-0 text-accent-soft" />}
            <span className="truncate">{name}</span>
            {page && <span className="shrink-0">{page}</span>}
          </>
        );
        return source.type === "web" ? (
          <a key={n} data-citation href={source.url} target="_blank" rel="noreferrer noopener" title={title} aria-label={`Source: ${title}`} className={className}>
            {label}
          </a>
        ) : (
          <button key={n} type="button" title={title} aria-label={`Source: ${title}`} aria-pressed={selected}
            onClick={() => workspace.openMaterial(source.materialId, source.page)} className={className}>
            {label}
          </button>
        );
      })}
    </>
  );
}

// ---------- Source details in the chat ----------

function Favicon({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Globe className="size-4 shrink-0 text-subtle" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- third-party favicons, 16px
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname(url))}&sz=32`}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="size-4 shrink-0 rounded-full bg-ink/[0.08]"
    />
  );
}

const CARD =
  "block w-full rounded-xl px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

/** A source in the chat: where it's from, its title, and the passage Ainsley cited. */
function SourceCard({ source, quote }: { source: Source; quote?: string }) {
  const library = useLibrary();
  const workspace = useWorkspace();

  const look = cn(CARD, "hover:bg-ink/[0.04]");
  const snippet = quote && (
    <span className="mt-1 block text-[13px] leading-5 text-muted">
      “{quote}”
    </span>
  );

  if (source.type === "web") {
    return (
      <li>
        <a href={source.url} target="_blank" rel="noreferrer noopener" className={look}>
          <span className="flex items-center gap-2 text-xs text-subtle">
            <Favicon url={source.url} />
            <span className="truncate">{hostname(source.url)}</span>
          </span>
          <span className="mt-1.5 line-clamp-2 block text-sm font-medium leading-5 text-fg">{source.title}</span>
          {snippet}
        </a>
      </li>
    );
  }

  const material = materialFor(source, library);
  const course = material?.courseId ? library.courses[material.courseId] : undefined;
  const where = [
    course?.name ?? "Your files",
    source.page && material?.kind !== "image" ? `${material ? pageUnit(material.kind) : "page"} ${source.page}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <li>
      <button
        type="button"
        disabled={!material}
        onClick={() => material && workspace.openMaterial(material.id, source.page)}
        className={cn(look, "disabled:cursor-default")}
      >
        <span className="flex items-center gap-2 text-xs text-subtle">
          <span className="grid size-4 shrink-0 place-items-center rounded bg-accent/20 text-accent-soft">
            <FileKindIcon kind={material?.kind ?? "pdf"} className="size-2.5" />
          </span>
          <span className="truncate">{where}</span>
        </span>
        <span className="mt-1.5 line-clamp-2 block text-sm font-medium leading-5 text-fg">{material?.name ?? source.title}</span>
        {snippet}
        {!material && <span className="mt-1 block text-xs text-subtle">No longer in your materials</span>}
      </button>
    </li>
  );
}

/** A reply's cited materials and web pages, followed by further reading, kept in the chat. */
export function SourcesContent({ sources }: { sources: Source[] }) {
  const numbered = sources.map((source, n) => ({ source, n: n + 1 }));
  const cited = [
    ...numbered.filter((x) => x.source.type === "material"),
    ...numbered.filter((x) => x.source.type === "web" && !x.source.uncited),
  ];
  const more = numbered.filter((x) => x.source.type === "web" && x.source.uncited);

  const list = (items: typeof numbered) => (
    <ul className="flex flex-col gap-0.5">
      {items.map(({ source, n }) => (
        <SourceCard key={n} source={source} quote={source.quotes?.join("” · “")} />
      ))}
    </ul>
  );

  return (
    <div className="py-2">
      {sources.length === 0 && <p className="px-3 py-4 text-sm text-muted">This response no longer has any sources.</p>}
      {cited.length > 0 && (
        <section aria-label="Citations">
          <h3 className="px-3 pb-1.5 pt-1 text-sm font-medium text-subtle">
            Citations
          </h3>
          {list(cited)}
        </section>
      )}
      {more.length > 0 && (
        <section aria-label="More sources" className={cn(cited.length > 0 && "pt-5")}>
          <h3 className="px-3 pb-1.5 pt-1 text-sm font-medium text-subtle">
            More
          </h3>
          {list(more)}
        </section>
      )}
    </div>
  );
}
