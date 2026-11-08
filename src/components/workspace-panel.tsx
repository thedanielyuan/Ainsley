"use client";

import { FileText, Maximize2, Minimize2, PanelRight, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { replyCitations } from "@/lib/citations";
import { useLibrary } from "@/lib/library";
import { useLocalText } from "@/lib/local-flag";
import type { Conversation } from "@/lib/types";
import { cn } from "@/lib/utils";
import { FileKindIcon } from "./attachments";
import { Markdown } from "./markdown";
import { MaterialPreview } from "./material-preview";
import { ReplySourcesContext } from "./sources";
import { CopyButton, IconButton } from "./ui";
import { DOCK_MIN_WIDTH, useWorkspace, type WorkspaceTab } from "./workspace-context";

const DEFAULT_WIDTH = 520;
const MIN_WIDTH = 360;
const MIN_CHAT_WIDTH = 380;
const tabId = (id: string) => `workspace-tab-${id}`;
const contentId = (id: string) => `workspace-content-${id}`;

function TabIcon({ tab }: { tab: WorkspaceTab }) {
  const library = useLibrary();
  if (tab.kind === "material") return <FileKindIcon kind={library.materials[tab.materialId]?.kind ?? "text"} className="size-3.5 shrink-0" />;
  return <FileText className="size-3.5 shrink-0" />;
}

function TabContent({ tab, conversation }: { tab: WorkspaceTab; conversation?: Conversation }) {
  const library = useLibrary();
  // Kept mounted across citations to the same file: a new revision scrolls to the cited page.
  if (tab.kind === "material") return <MaterialPreview materialId={tab.materialId} page={tab.page} revision={tab.revision} />;
  const message = conversation?.messages.find((item) => item.id === tab.messageId);
  if (!message) {
    return <div className="p-6 text-sm leading-6 text-muted">This response is no longer in the conversation. Open a newer response to continue.</div>;
  }
  if (message.status === "streaming") {
    return <div role="status" className="p-6 text-sm leading-6 text-muted">Ainsley is updating this response…</div>;
  }
  const citations = replyCitations(message, library);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-line pe-2.5 ps-3.5">
        <span className="truncate text-xs text-subtle">Ainsley’s response</span>
        <CopyButton label="Copy response" getText={() => message.text} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-7 sm:px-8">
        <div className="mx-auto max-w-[760px]">
          <ReplySourcesContext.Provider value={{ messageId: message.id, sources: citations.sources ?? [] }}>
            <Markdown text={citations.display ?? message.text} />
          </ReplySourcesContext.Provider>
        </div>
      </div>
    </div>
  );
}

/** A chat's companion workspace, docked when there is room and modal on smaller screens. */
export function WorkspacePanel({
  containerWidth,
  conversation,
}: {
  /** The width of the area the workspace shares with the page. */
  containerWidth: number;
  conversation?: Conversation;
}) {
  const workspace = useWorkspace();
  const { isOpen, expanded, activeId, tabs, closePanel, restoreFocus } = workspace;
  const [storedWidth, setStoredWidth] = useLocalText("ainsley:workspace-width:v1");
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const tablistRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ startX: number; startWidth: number; width: number } | null>(null);
  const maxWidth = Math.max(MIN_WIDTH, Math.min(960, containerWidth - MIN_CHAT_WIDTH));
  const preferredWidth = Number(storedWidth) || DEFAULT_WIDTH;
  const width = Math.max(MIN_WIDTH, Math.min(maxWidth, dragWidth ?? preferredWidth));
  const overlay = containerWidth < DOCK_MIN_WIDTH || expanded;

  // Keep one mounted dialog in both layouts so pages, view modes and scroll survive
  // expanding, resizing and hiding. Only the overlay uses native modal focus handling.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!isOpen) { dialog.close(); return; }
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog.open && dialog.matches(":modal") !== overlay) dialog.close();
    if (!dialog.open) {
      if (overlay) dialog.showModal();
      else dialog.show();
    }
    if (overlay) dialog.querySelector<HTMLButtonElement>("[data-close-panel]")?.focus({ preventScroll: true });
    else previous?.focus({ preventScroll: true });
  }, [isOpen, overlay]);

  useEffect(() => {
    if (!isOpen) return;
    return () => restoreFocus();
  }, [isOpen, restoreFocus]);

  useEffect(() => {
    if (!isOpen || overlay) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      // Let a menu or another dialog handle its own Escape first.
      if (event.defaultPrevented || event.key !== "Escape" || document.querySelector('[aria-modal="true"], [role="menu"], dialog[open]:not([data-workspace-panel])')) return;
      event.preventDefault();
      closePanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePanel, isOpen, overlay]);

  useEffect(() => {
    const selected = tablistRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (selected) {
      const list = tablistRef.current!;
      const item = selected.parentElement!;
      if (item.offsetLeft < list.scrollLeft) list.scrollLeft = item.offsetLeft;
      else if (item.offsetLeft + item.offsetWidth > list.scrollLeft + list.clientWidth) list.scrollLeft = item.offsetLeft + item.offsetWidth - list.clientWidth;
    }
  }, [activeId, isOpen, overlay]);

  const focusTab = (id: string) => requestAnimationFrame(() => document.getElementById(tabId(id))?.focus());
  const closeTab = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    const remaining = tabs.filter((tab) => tab.id !== id);
    workspace.closeTab(id);
    if (remaining.length) focusTab(id === activeId ? remaining[Math.min(index, remaining.length - 1)].id : activeId!);
  };

  const navigateTabs = (event: KeyboardEvent, id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    let next: number;
    switch (event.key) {
      case "ArrowRight": next = (index + 1) % tabs.length; break;
      case "ArrowLeft": next = (index + tabs.length - 1) % tabs.length; break;
      case "Home": next = 0; break;
      case "End": next = tabs.length - 1; break;
      case "Delete": event.preventDefault(); closeTab(id); return;
      default: return;
    }
    event.preventDefault();
    workspace.selectTab(tabs[next].id);
    focusTab(tabs[next].id);
  };

  const resizeStart = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { startX: event.clientX, startWidth: width, width };
    setDragWidth(width);
  };
  const resizeMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = Math.max(MIN_WIDTH, Math.min(maxWidth, drag.current.startWidth + drag.current.startX - event.clientX));
    drag.current.width = next;
    setDragWidth(next);
  };
  const resizeEnd = () => {
    if (!drag.current) return;
    setStoredWidth(String(Math.round(drag.current.width)));
    drag.current = null;
    setDragWidth(null);
  };

  const content = (
    <>
      <div className="flex h-14 min-w-0 shrink-0 items-center gap-1 border-b border-line px-2">
        <div ref={tablistRef} role="tablist" aria-label="Workspace tabs" className="relative flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
          {tabs.length === 0 && <span className="px-3 text-sm font-medium">Workspace</span>}
          {tabs.map((tab) => (
            <div key={tab.id} className={cn("group/tab flex max-w-52 shrink-0 items-center rounded-xl border", tab.id === activeId ? "border-ink/[0.08] bg-ink/[0.07] text-fg" : "border-transparent text-subtle hover:bg-ink/[0.04] hover:text-muted")}>
              <button
                type="button" role="tab" id={tabId(tab.id)} aria-selected={tab.id === activeId}
                aria-controls={contentId(tab.id)} tabIndex={tab.id === activeId ? 0 : -1}
                title={tab.title} onClick={() => workspace.selectTab(tab.id)} onKeyDown={(event) => navigateTabs(event, tab.id)}
                className="flex h-9 min-w-0 items-center gap-2 rounded-lg py-1 pe-1 ps-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60"
              >
                <TabIcon tab={tab} /><span className="truncate">{tab.title}</span>
              </button>
              <button type="button" aria-label={`Close ${tab.title} tab`} onClick={() => closeTab(tab.id)}
                className="me-1 grid size-6 shrink-0 place-items-center rounded-md text-subtle hover:bg-ink/[0.08] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
        <div className="flex shrink-0 items-center gap-0.5 ps-1">
          <div className="hidden sm:flex">
            <IconButton label={expanded ? "Collapse" : "Expand"} tooltip={overlay ? undefined : "bottom"} onClick={workspace.toggleExpanded}>
              {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </IconButton>
          </div>
          <IconButton label="Close" tooltip={overlay ? undefined : "bottom"} data-close-panel onClick={closePanel}>
            <X className="size-[18px]" />
          </IconButton>
        </div>
      </div>
      <div className="relative min-h-0 min-w-0 flex-1">
        {tabs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-8 pb-14 text-center">
            <div className="mb-5 grid size-12 place-items-center rounded-2xl border border-line bg-ink/[0.03]"><PanelRight className="size-5 text-muted" /></div>
            <h2 className="text-base font-medium">A little more room to explore</h2>
            <p className="mt-2 max-w-64 text-sm leading-6 text-muted">Open a file, a citation, or a response to view it here alongside your chat.</p>
          </div>
        ) : tabs.map((tab) => (
          <section key={tab.id} role="tabpanel" id={contentId(tab.id)} aria-labelledby={tabId(tab.id)} tabIndex={0}
            hidden={tab.id !== activeId} className={cn("h-full min-h-0 overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40", tab.id !== activeId && "hidden")}>
            <TabContent tab={tab} conversation={conversation} />
          </section>
        ))}
        {dragWidth !== null && <div className="absolute inset-0 cursor-col-resize" />}
      </div>
    </>
  );

  return (
    <div className={isOpen && !overlay ? "relative h-full min-h-0 shrink-0" : "contents"} style={isOpen && !overlay ? { width } : undefined}>
      <dialog ref={dialogRef} id="workspace-panel" data-workspace-panel aria-label="Workspace" aria-modal={overlay ? true : undefined}
        onCancel={(event) => {
          event.preventDefault();
          // Escape in a confirmation or rename opened from inside the panel closes just that.
          if (!event.currentTarget.querySelector('[aria-modal="true"]')) closePanel();
        }}
        onClick={(event) => { if (overlay && event.target === event.currentTarget) closePanel(); }}
        className={cn("m-0 max-h-none max-w-none border-0 bg-sidebar p-0 text-fg backdrop:bg-scrim",
          overlay ? "sheet-in fixed inset-y-0 left-auto right-0 h-dvh w-full shadow-2xl" : "relative h-full w-full overflow-visible border-s border-line",
          overlay && !expanded && "sm:max-w-[640px]")}>
      {!overlay && <div role="separator" tabIndex={0} aria-label="Resize workspace" aria-orientation="vertical" aria-valuemin={MIN_WIDTH} aria-valuemax={maxWidth} aria-valuenow={Math.round(width)} aria-valuetext={`${Math.round(width)} pixels wide`} aria-controls="workspace-panel"
        onPointerDown={resizeStart} onPointerMove={resizeMove} onPointerUp={resizeEnd} onPointerCancel={resizeEnd} onLostPointerCapture={resizeEnd}
        onDoubleClick={() => setStoredWidth(String(DEFAULT_WIDTH))}
        onKeyDown={(event) => {
          let next: number;
          if (event.key === "ArrowLeft") next = width + (event.shiftKey ? 80 : 20);
          else if (event.key === "ArrowRight") next = width - (event.shiftKey ? 80 : 20);
          else if (event.key === "Home") next = MIN_WIDTH;
          else if (event.key === "End") next = maxWidth;
          else return;
          event.preventDefault(); setStoredWidth(String(Math.max(MIN_WIDTH, Math.min(maxWidth, next))));
        }}
        className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none outline-none before:absolute before:inset-y-0 before:left-[3px] before:w-0.5 before:bg-transparent hover:before:bg-accent/60 focus-visible:before:bg-accent" />}
      <div className="flex h-full min-w-0 flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]">{content}</div>
      </dialog>
    </div>
  );
}
