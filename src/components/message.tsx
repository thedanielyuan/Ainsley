"use client";

import { BookOpen, Pencil, RotateCcw, TriangleAlert } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { replyCitations } from "@/lib/citations";
import { getLibrary } from "@/lib/library";
import type { ChatMessage } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MessageAttachments } from "./attachments";
import { Markdown } from "./markdown";
import { ReplySourcesContext, SourcesContent } from "./sources";
import { CopyButton, IconButton } from "./ui";
import { WorkTimeline } from "./work-timeline";

interface MessageItemProps {
  message: ChatMessage;
  isLast: boolean;
  /** The conversation is generating. */
  busy: boolean;
  onRegenerate: () => void;
  onEdit: (messageId: string, text: string) => void;
}

export const MessageItem = memo(function MessageItem(props: MessageItemProps) {
  return props.message.role === "user" ? <UserMessage {...props} /> : <AssistantMessage {...props} />;
});

function UserMessage({ message, busy, onEdit }: MessageItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.text);

  const hasFiles = Boolean(message.attachments?.length);
  const save = () => {
    if (!draft.trim() && !hasFiles) return;
    setEditing(false);
    if (draft.trim() !== message.text) onEdit(message.id, draft);
  };

  if (editing) {
    return (
      <div className="ml-auto w-full max-w-[85%] rounded-3xl border border-line bg-surface p-3">
        <textarea
          autoFocus
          value={draft}
          aria-label="Edit message"
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.setSelectionRange(draft.length, draft.length)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              save();
            }
            if (e.key === "Escape") setEditing(false);
          }}
          className="block max-h-[40dvh] min-h-14 w-full resize-none bg-transparent px-2 text-base leading-7 text-fg outline-none field-sizing-content"
        />
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="h-9 rounded-full px-4 text-sm font-medium text-muted transition-colors hover:bg-ink/[0.06] hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!draft.trim() && !hasFiles}
            className="h-9 rounded-full bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-strong disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="group flex flex-col items-end gap-1">
      {hasFiles && <MessageAttachments items={message.attachments ?? []} />}
      {message.text && (
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl border border-line bg-surface px-5 py-2.5 text-base leading-7 text-fg">
          {message.text}
        </div>
      )}
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
        {message.text && <CopyButton getText={() => message.text} />}
        {!busy && (
          <IconButton
            label="Edit"
            onClick={() => {
              setDraft(message.text);
              setEditing(true);
            }}
          >
            <Pencil className="size-4" />
          </IconButton>
        )}
      </div>
    </div>
  );
}

function AssistantMessage({ message, isLast, busy, onRegenerate }: MessageItemProps) {
  const { status, text, thinkingMs, activity } = message;
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const streaming = status === "streaming";
  const done = !streaming;
  // Once the reply is finished, cited passages link directly to their files or web pages.
  const cited = done && status !== "refused" ? replyCitations(message, getLibrary()) : null;
  const sources = cited?.sources;
  const replySources = useMemo(
    () => (sources?.length ? { messageId: message.id, sources } : null),
    [message.id, sources],
  );

  return (
    <div className="group flex flex-col gap-2">
      <WorkTimeline activity={activity ?? []} live={streaming} startedAt={message.createdAt} workMs={thinkingMs} />

      {text && (
        <ReplySourcesContext.Provider value={replySources}>
          <Markdown text={cited?.display ?? text} />
        </ReplySourcesContext.Provider>
      )}

      {status === "stopped" && (
        <p className="text-sm text-subtle">{text ? "Stopped." : "You stopped this response."}</p>
      )}
      {status === "truncated" && (
        <p className="text-sm text-subtle">This response reached the length limit.</p>
      )}
      {status === "refused" && (
        <Notice tone="neutral">
          Ainsley can&apos;t help with this request. Try rephrasing it, or ask about something else.
        </Notice>
      )}
      {status === "error" && (
        <Notice tone="error" action={isLast && !busy ? { label: "Retry", onClick: onRegenerate } : undefined}>
          {message.error ?? "Something went wrong."}
        </Notice>
      )}

      {done && status !== "error" && (
        <div
          className={cn(
            "-ml-1.5 flex items-center gap-0.5 transition-opacity",
            isLast
              ? "opacity-100"
              : "opacity-0 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100",
          )}
        >
          {text && <CopyButton getText={() => text} />}
          {isLast && !busy && (
            <IconButton label="Regenerate" onClick={onRegenerate}>
              <RotateCcw className="size-4" />
            </IconButton>
          )}
          {sources && sources.length > 0 && (
            <button
              type="button"
              onClick={() => setSourcesOpen((open) => !open)}
              aria-expanded={sourcesOpen}
              aria-controls={`reply-sources-${message.id}`}
              aria-label={`${sourcesOpen ? "Hide" : "View"} ${sources.length} source${sources.length === 1 ? "" : "s"}`}
              className="ml-1 inline-flex h-8 items-center gap-1.5 rounded-xl px-2 text-xs font-medium text-muted transition-colors hover:bg-ink/[0.06] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <BookOpen className="size-3.5" />
              Sources
            </button>
          )}
        </div>
      )}
      {done && status !== "error" && sources && sources.length > 0 && sourcesOpen && (
        <div id={`reply-sources-${message.id}`} className="rounded-xl border border-line px-2">
          <SourcesContent sources={sources} />
        </div>
      )}
    </div>
  );
}

function Notice({
  tone,
  action,
  children,
}: {
  tone: "error" | "neutral";
  action?: { label: string; onClick: () => void };
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-2xl border px-4 py-3 text-sm leading-6",
        tone === "error"
          ? "border-danger/25 bg-danger/[0.06] text-fg"
          : "border-line bg-ink/[0.03] text-muted",
      )}
    >
      <TriangleAlert
        className={cn("mt-1 size-4 shrink-0", tone === "error" ? "text-danger" : "text-subtle")}
      />
      <p className="flex-1">{children}</p>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="-my-1 shrink-0 rounded-lg px-2.5 py-1 font-medium text-fg transition-colors hover:bg-ink/[0.08]"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
