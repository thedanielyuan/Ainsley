"use client";

import { Menu as MenuIcon, PanelRight, Paperclip, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { resolveScope } from "@/lib/course-context";
import { linkFolder, unlinkFolder } from "@/lib/folders";
import {
  createCourse,
  getLibrary,
  renameCourse,
  setCourseLook,
  uploadMaterial,
  useLibrary,
  type UploadTarget,
} from "@/lib/library";
import { useLocalFlag } from "@/lib/local-flag";
import { useAppearanceSync } from "@/lib/use-appearance";
import type { ChatScope } from "@/lib/types";
import { NAVIGATE_EVENT, useChat } from "@/lib/use-chat";
import { draftStatus, useDrafts } from "@/lib/use-drafts";
import { Composer } from "./composer";
import { ConfirmDialog, type ConfirmRequest } from "./confirm-dialog";
import { ConversationView } from "./conversation-view";
import { CoursePicker } from "./course-picker";
import { hasFiles } from "./course-materials";
import { courseDeleteRequest, CourseView } from "./course-view";
import { CoursesView } from "./courses-view";
import { CourseDialog, MaterialPickerDialog, type CourseDialogValues } from "./dialogs";
import { EmptyState } from "./empty-state";
import { SearchDialog } from "./search-dialog";
import { SettingsDialog } from "./settings-dialog";
import { Sidebar } from "./sidebar";
import { IconButton } from "./ui";
import { WorkspaceContext, useElementWidth, useWorkspaceController } from "./workspace-context";
import { WorkspacePanel } from "./workspace-panel";

// The URL, for the courses page (/courses) and course pages (/courses/:id). Chats (/c/:id)
// are routed by useChat.
function subscribePath(listener: () => void) {
  window.addEventListener("popstate", listener);
  window.addEventListener(NAVIGATE_EVENT, listener);
  return () => {
    window.removeEventListener("popstate", listener);
    window.removeEventListener(NAVIGATE_EVENT, listener);
  };
}

function setPath(url: string, mode: "push" | "replace" = "push") {
  if (window.location.pathname === url) return;
  if (mode === "push") window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

function courseFromPath(pathname: string) {
  return /^\/courses\/([A-Za-z0-9_-]+)\/?$/.exec(pathname)?.[1] ?? null;
}

const NO_SCOPE: ChatScope = { courseId: null };

export function ChatApp() {
  useAppearanceSync();
  const chat = useChat();
  const library = useLibrary();
  const drafts = useDrafts();
  const { active, activeId, conversations, newChat, select, send, stop, remove, removeAll, navigate } = chat;
  const [collapsed, setCollapsed] = useLocalFlag("ainsley:sidebar-collapsed");
  const pathname = useSyncExternalStore(subscribePath, () => window.location.pathname, () => "/");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  // The course dialog: a new course (for the draft whose chip asked for it, if any), or
  // editing an existing one.
  const [courseDialog, setCourseDialog] = useState<{ courseId: string | null; forDraft: string | null } | null>(
    null,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [picker, setPicker] = useState<{ key: string; courseId: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const workspaceContainerRef = useRef<HTMLDivElement | null>(null);
  const workspaceWidth = useElementWidth(workspaceContainerRef);

  const requestedCourse = courseFromPath(pathname);
  const courseView = requestedCourse && library.courses[requestedCourse] ? requestedCourse : null;
  const course = courseView ? library.courses[courseView] : undefined;
  const coursesPage = !courseView && !active && /^\/courses\/?$/.test(pathname);

  // A course page for a course that doesn't exist (deleted, or another device's link).
  useEffect(() => {
    if (chat.ready && library.ready && requestedCourse && !library.courses[requestedCourse]) {
      setPath("/courses", "replace");
    }
  }, [chat.ready, library.ready, library.courses, requestedCourse]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const draftKey = courseView ? `course:${courseView}` : (activeId ?? "new");
  const workspace = useWorkspaceController(coursesPage ? "courses" : draftKey);
  const { togglePanel, closePanel } = workspace;
  // The right workspace sits beside chats (and the new-chat screen). Like a Claude project, a
  // course page keeps its materials in a dialog instead, so it has no workspace.
  const hasWorkspace = !courseView && !coursesPage;
  const draft = drafts.get(draftKey);
  const streaming = active && !courseView ? Boolean(chat.streaming[active.id]) : false;

  // Which course this message will draw on.
  const rawScope: ChatScope = courseView
    ? { courseId: courseView }
    : active
      ? { courseId: active.courseId ?? null }
      : (draft.scope ?? NO_SCOPE);
  const scope = resolveScope(library, rawScope);
  const status = draftStatus(draft, library);

  const { get: getDraft, setScope: setDraftScope } = drafts;

  // "Chat" starts a chat in no course, unless an unsent message is waiting on the new-chat screen.
  const startNewChat = useCallback(() => {
    const waiting = getDraft("new");
    if (!waiting.text.trim() && waiting.attachments.length === 0) setDraftScope("new", NO_SCOPE);
    newChat();
    setMobileOpen(false);
  }, [getDraft, setDraftScope, newChat]);

  const openChat = useCallback(
    (id: string) => {
      select(id);
      setMobileOpen(false);
    },
    [select],
  );

  const openCourse = useCallback(
    (id: string) => {
      navigate(null, "none");
      setPath(`/courses/${id}`);
      setMobileOpen(false);
    },
    [navigate],
  );

  const openCourses = useCallback(() => {
    navigate(null, "none");
    setPath("/courses");
    setMobileOpen(false);
  }, [navigate]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && !e.shiftKey && key === "k") {
        e.preventDefault();
        if (document.querySelector("dialog[data-workspace-panel]:modal")) closePanel();
        setSearchOpen((open) => !open);
      } else if (mod && e.shiftKey && key === "o") {
        e.preventDefault();
        startNewChat();
      } else if (mod && e.shiftKey && e.code === "Backslash" && hasWorkspace) {
        e.preventDefault();
        togglePanel();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [startNewChat, togglePanel, closePanel, hasWorkspace]);

  const focusComposer = () =>
    requestAnimationFrame(() => {
      const el = composerRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });

  const handleSend = () => {
    if (!status.canSubmit) return;
    if (send({ text: draft.text, attachmentIds: status.readyIds, scope })) drafts.clear(draftKey);
  };

  const addFiles = (files: File[]) => {
    const target: UploadTarget = {
      ...scope,
      conversationId: active && !courseView ? active.id : undefined,
    };
    const errors = drafts.addFiles(draftKey, files, target);
    if (errors.length) setNotice(errors.length > 1 ? `${errors[0]} (and ${errors.length - 1} more)` : errors[0]);
  };

  const changeScope = (next: ChatScope) => {
    if (active && !courseView) chat.setScope(active.id, next);
    else drafts.setScope(draftKey, next);
  };

  const pickSuggestion = (prompt: string) => {
    drafts.setText("new", prompt);
    focusComposer();
  };

  /** A course's + in the sidebar: the new-chat screen, already in that course. */
  const startCourseChat = (courseId: string) => {
    setDraftScope("new", { courseId });
    newChat();
    setMobileOpen(false);
    focusComposer();
  };

  const askAbout = (materialId: string) => {
    if (!courseView) return;
    drafts.addFromLibrary(`course:${courseView}`, [materialId]);
    focusComposer();
  };

  const requestDelete = useCallback(
    (id: string, title: string) => {
      setConfirm({
        title: "Delete chat?",
        description: `“${title}” will be permanently deleted.`,
        confirmLabel: "Delete",
        onConfirm: () => remove(id),
      });
    },
    [remove],
  );

  const requestDeleteAll = useCallback(() => {
    setConfirm({
      title: "Delete all chats?",
      description:
        "Every conversation on this device will be permanently deleted, with files attached in chats that aren't in a course. Your courses and their materials stay. This can’t be undone.",
      confirmLabel: "Delete all",
      onConfirm: removeAll,
    });
  }, [removeAll]);

  const requestDeleteCourse = useCallback((id: string) => {
    const request = courseDeleteRequest(id, () => {
      if (courseFromPath(window.location.pathname) === id) setPath("/courses", "replace");
    });
    if (request) setConfirm(request);
  }, []);

  const closeConfirm = useCallback(() => setConfirm(null), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const toggleCollapsed = useCallback(() => setCollapsed(!collapsed), [collapsed, setCollapsed]);
  const openSearch = useCallback(() => {
    setSearchOpen(true);
    setMobileOpen(false);
  }, []);
  const openNewCourse = useCallback(() => {
    setCourseDialog({ courseId: null, forDraft: null });
    setMobileOpen(false);
  }, []);
  const openEditCourse = useCallback((id: string) => {
    setCourseDialog({ courseId: id, forDraft: null });
    setMobileOpen(false);
  }, []);
  const openSettings = useCallback(() => {
    setSettingsOpen(true);
    setMobileOpen(false);
  }, []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  /** Uploads files picked in the course dialog; reports the first one that can't be used. */
  const uploadToCourse = (courseId: string, files: File[]) => {
    const errors = files.flatMap((file) => {
      const result = uploadMaterial(file, { courseId });
      return "error" in result ? [result.error] : [];
    });
    if (errors.length) setNotice(errors[0]);
  };

  const submitCourseDialog = (values: CourseDialogValues) => {
    if (!courseDialog) return;
    const { name, look, folder, files } = values;
    const editing = courseDialog.courseId ? getLibrary().courses[courseDialog.courseId] : undefined;
    if (editing) {
      if (name !== editing.name) renameCourse(editing.id, name);
      if (look.icon !== (editing.icon ?? "folder") || look.color !== editing.color) setCourseLook(editing.id, look);
      if (folder) void linkFolder(editing.id, folder);
      else if (values.unlinkFolder) void unlinkFolder(editing.id);
      uploadToCourse(editing.id, files);
      return;
    }
    const created = createCourse(name, look);
    if (folder) void linkFolder(created.id, folder);
    uploadToCourse(created.id, files);
    const { forDraft } = courseDialog;
    if (forDraft === null) {
      openCourse(created.id);
    } else if (active && !courseView && forDraft === active.id) {
      chat.setScope(active.id, { courseId: created.id });
    } else {
      drafts.setScope(forDraft, { courseId: created.id });
    }
  };

  const scopedCourse = scope.courseId ? library.courses[scope.courseId] : undefined;
  const canBrowse =
    scope.courseId !== null && Object.values(library.materials).some((m) => m.courseId === scope.courseId);
  // Follow-ups get the one-row composer; home and course pages keep the full one.
  const compact = Boolean(active) && !courseView;
  // Course pages and chats in a course already know their course: only other chats get the chip.
  const showCoursePicker = !courseView && !(active && scope.courseId);

  const composer = (
    <Composer
      key={draftKey}
      ref={composerRef}
      value={draft.text}
      onChange={(value) => drafts.setText(draftKey, value)}
      onSubmit={handleSend}
      onStop={() => {
        if (active) stop(active.id);
      }}
      streaming={streaming}
      placeholder={
        course
          ? `Ask about ${course.name}`
          : active
            ? "Ask Ainsley"
            : scopedCourse
              ? `Ask about ${scopedCourse.name}`
              : "Ask anything, or attach slides, a PDF or a photo of a problem"
      }
      autoFocus
      compact={compact}
      attachments={status.views}
      onFiles={addFiles}
      onRemoveAttachment={(id) => drafts.removeAttachment(draftKey, id)}
      onBrowseLibrary={canBrowse && scope.courseId ? () => setPicker({ key: draftKey, courseId: scope.courseId as string }) : undefined}
      scopeControl={
        showCoursePicker ? (
          <CoursePicker
            scope={scope}
            onChange={changeScope}
            onNewCourse={() => setCourseDialog({ courseId: null, forDraft: draftKey })}
            compact={compact}
          />
        ) : undefined
      }
      canSubmit={status.canSubmit && library.ready}
    />
  );

  // Drop files anywhere in the chat area to attach them.
  const dropHandlers = {
    onDragEnter: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    },
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      addFiles([...e.dataTransfer.files]);
    },
  };

  return (
    <WorkspaceContext.Provider value={workspace}>
    <div className="flex h-dvh w-full overflow-hidden bg-bg text-fg">
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        activeCourseId={courseView}
        streaming={chat.streaming}
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onToggleCollapsed={toggleCollapsed}
        onCloseMobile={closeMobile}
        onNewChat={startNewChat}
        onSelect={openChat}
        onSearch={openSearch}
        onRename={chat.rename}
        onDelete={requestDelete}
        onOpenCourse={openCourse}
        onOpenCourses={openCourses}
        onNewCourse={openNewCourse}
        onNewCourseChat={startCourseChat}
        onEditCourse={openEditCourse}
        onDeleteCourse={requestDeleteCourse}
        onOpenSettings={openSettings}
      />

      <div ref={workspaceContainerRef} className="flex min-w-0 flex-1">
      <main className="relative flex min-w-0 flex-1 flex-col" {...(coursesPage ? {} : dropHandlers)}>
        <header className="flex h-14 shrink-0 items-center gap-1 px-2 md:px-4">
          <IconButton label="Open sidebar" className="size-10 md:hidden" onClick={() => setMobileOpen(true)}>
            <MenuIcon className="size-5" />
          </IconButton>
          <div className="min-w-0 flex-1 truncate text-center text-[15px] font-medium md:text-left">
            {course?.name ?? (coursesPage ? "Courses" : active?.title)}
          </div>
          <IconButton label="New chat" className="size-10 md:hidden" onClick={startNewChat}>
            <Plus className="size-5" />
          </IconButton>
          {/* While the workspace is open, its own Close button hides it. */}
          {hasWorkspace && !workspace.isOpen && (
            <IconButton id="workspace-toggle" label="Open workspace" tooltip="bottom" shortcut={"⇧⌘\\"}
              aria-expanded={false} onClick={workspace.togglePanel}>
              <PanelRight className="size-[18px]" />
            </IconButton>
          )}
        </header>

        {chat.ready &&
          (courseView ? (
            <CourseView
              key={courseView}
              courseId={courseView}
              composer={composer}
              conversations={conversations}
              streaming={chat.streaming}
              onOpenChat={openChat}
              onRenameChat={chat.rename}
              onDeleteChat={requestDelete}
              onAllCourses={openCourses}
              onEdit={() => openEditCourse(courseView)}
              onAskAbout={askAbout}
              onNotify={setNotice}
              onDeleted={() => setPath("/courses", "replace")}
            />
          ) : coursesPage ? (
            <CoursesView
              conversations={conversations}
              onOpenCourse={openCourse}
              onNewCourse={openNewCourse}
              onEditCourse={openEditCourse}
              onDeleteCourse={requestDeleteCourse}
            />
          ) : active ? (
            <ConversationView
              key={active.id}
              conversation={active}
              streaming={streaming}
              composer={composer}
              onRegenerate={chat.regenerate}
              onEdit={chat.editMessage}
            />
          ) : (
            <EmptyState composer={composer} onSuggestion={pickSuggestion} />
          ))}

        {dragging && (
          <div className="pointer-events-none absolute inset-3 z-20 grid place-items-center rounded-3xl border-2 border-dashed border-accent/60 bg-bg/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 text-center">
              <Paperclip className="size-6 text-accent-soft" />
              <p className="text-base font-medium text-fg">Drop to attach</p>
              <p className="text-sm text-muted">
                {scope.courseId ? "Saved to your course materials, too" : "PDFs, slides, documents or photos"}
              </p>
            </div>
          </div>
        )}

        {notice && (
          <div
            role="status"
            className="absolute inset-x-4 top-4 z-[55] mx-auto flex max-w-[520px] items-start gap-3 rounded-2xl border border-line bg-elevated px-4 py-3 text-sm leading-6 text-fg shadow-popover md:top-6"
          >
            <p className="flex-1">{notice}</p>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="Dismiss"
              className="-mr-1 mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg text-muted hover:bg-ink/[0.06] hover:text-fg"
            >
              <X className="size-4" />
            </button>
          </div>
        )}
      </main>
      <WorkspacePanel containerWidth={workspaceWidth} conversation={active ?? undefined} />
      </div>

      {searchOpen && <SearchDialog conversations={conversations} onSelect={openChat} onClose={closeSearch} />}
      {confirm && <ConfirmDialog request={confirm} onClose={closeConfirm} />}
      {courseDialog && (!courseDialog.courseId || library.courses[courseDialog.courseId]) && (
        <CourseDialog
          key={courseDialog.courseId ?? "new"}
          course={courseDialog.courseId ? library.courses[courseDialog.courseId] : undefined}
          onClose={() => setCourseDialog(null)}
          onSubmit={submitCourseDialog}
        />
      )}
      {settingsOpen && (
        <SettingsDialog onClose={closeSettings} onDeleteAll={requestDeleteAll} />
      )}
      {picker && (
        <MaterialPickerDialog
          courseId={picker.courseId}
          exclude={drafts.get(picker.key).attachments.map((a) => a.id)}
          onPick={(ids) => {
            drafts.addFromLibrary(picker.key, ids);
            focusComposer();
          }}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
    </WorkspaceContext.Provider>
  );
}

