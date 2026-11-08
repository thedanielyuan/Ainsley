"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type RefObject } from "react";
import { getLibrary } from "@/lib/library";
import type { Source } from "@/lib/types";

export type WorkspaceTab =
  | { kind: "material"; id: string; title: string; materialId: string; page?: number; revision: number }
  | { kind: "reply"; id: string; title: string; messageId: string; text: string; display?: string; sources: Source[] };

/** The workspace docks beside the page from this width of shared area; below it, it's a drawer. */
export const DOCK_MIN_WIDTH = 880;

interface WorkspaceSession {
  tabs: WorkspaceTab[];
  activeId: string | null;
  isOpen: boolean;
  expanded: boolean;
}

const EMPTY: WorkspaceSession = { tabs: [], activeId: null, isOpen: false, expanded: false };

/** Tabs belong to a chat; switching away keeps its workspace for this visit. */
export function useWorkspaceController(scope: string) {
  const [sessions, setSessions] = useState<Record<string, WorkspaceSession>>({});
  const session = sessions[scope] ?? EMPTY;
  const { tabs } = session;
  const activeId = tabs.some((tab) => tab.id === session.activeId) ? session.activeId : (tabs[0]?.id ?? null);
  const opener = useRef<HTMLElement | null>(null);
  const update = useCallback((change: (current: WorkspaceSession) => WorkspaceSession) => {
    setSessions((current) => ({ ...current, [scope]: change(current[scope] ?? EMPTY) }));
  }, [scope]);

  const rememberOpener = useCallback(() => {
    const element = document.activeElement;
    if (element instanceof HTMLElement && !element.closest("[data-workspace-panel]")) opener.current = element;
  }, []);

  const restoreFocus = useCallback(() => {
    requestAnimationFrame(() => {
      if (document.querySelector('[role="dialog"], [role="alertdialog"], dialog:modal')) return;
      const target = opener.current?.isConnected ? opener.current : document.getElementById("workspace-toggle");
      target?.focus({ preventScroll: true });
    });
  }, []);

  const openTab = useCallback((tab: WorkspaceTab) => {
    rememberOpener();
    update((current) => ({
      ...current,
      tabs: current.tabs.some((item) => item.id === tab.id)
        ? current.tabs.map((item) => item.id === tab.id
          ? tab.kind === "material" && item.kind === "material" ? { ...tab, revision: item.revision + 1 } : tab
          : item)
        : [...current.tabs, tab],
      activeId: tab.id,
      isOpen: true,
    }));
  }, [rememberOpener, update]);

  const openMaterial = useCallback((materialId: string, page?: number) => {
    const material = getLibrary().materials[materialId];
    openTab({ kind: "material", id: `material:${materialId}`, title: material?.name ?? "File preview", materialId, page, revision: 0 });
  }, [openTab]);

  const openReply = useCallback((message: { id: string; text: string; display?: string; sources?: Source[] }, title?: string) => {
    const heading = /^#{1,3}\s+(.+)$/m.exec(message.text)?.[1];
    openTab({
      kind: "reply", id: `reply:${message.id}`, title: title ?? heading?.slice(0, 48) ?? "Response",
      messageId: message.id, text: message.text, display: message.display, sources: message.sources ?? [],
    });
  }, [openTab]);

  const closePanel = useCallback(() => {
    update((current) => ({ ...current, isOpen: false, expanded: false }));
    restoreFocus();
  }, [restoreFocus, update]);

  const togglePanel = useCallback(() => {
    rememberOpener();
    update((current) => ({ ...current, isOpen: !current.isOpen, expanded: false }));
  }, [rememberOpener, update]);

  const selectTab = useCallback((id: string) => {
    update((current) => ({ ...current, activeId: id, isOpen: true }));
  }, [update]);

  const closeTab = useCallback((id: string) => {
    update((current) => {
      const index = current.tabs.findIndex((tab) => tab.id === id);
      const rest = current.tabs.filter((tab) => tab.id !== id);
      return {
        ...current,
        tabs: rest,
        activeId: current.activeId === id ? rest[Math.min(index, rest.length - 1)]?.id ?? null : current.activeId,
        isOpen: rest.length > 0,
        expanded: rest.length > 0 && current.expanded,
      };
    });
  }, [update]);

  const toggleExpanded = useCallback(() => {
    update((current) => ({ ...current, expanded: !current.expanded }));
  }, [update]);

  return {
    ...session,
    tabs,
    activeId,
    activeTab: tabs.find((tab) => tab.id === activeId) ?? null,
    openMaterial, openReply, selectTab, closeTab, closePanel, togglePanel, toggleExpanded, restoreFocus,
  };
}

export const WorkspaceContext = createContext<ReturnType<typeof useWorkspaceController> | null>(null);

export function useWorkspace() {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("Workspace controls must be inside WorkspaceContext.");
  return workspace;
}

/** An element's width, kept current as it resizes (0 until it's measured). */
export function useElementWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
