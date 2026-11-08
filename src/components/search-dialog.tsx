"use client";

import { MessageSquare, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Conversation } from "@/lib/types";
import { cn, formatShortDate } from "@/lib/utils";

interface Result {
  conversation: Conversation;
  snippet: string | null;
}

function excerpt(text: string, query: string) {
  const flat = text.replace(/\s+/g, " ");
  const at = flat.toLowerCase().indexOf(query);
  const start = Math.max(0, at - 32);
  return `${start > 0 ? "…" : ""}${flat.slice(start, at + query.length + 64)}`;
}

export function SearchDialog({
  conversations,
  onSelect,
  onClose,
}: {
  conversations: Conversation[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const results = useMemo<Result[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations.slice(0, 30).map((conversation) => ({ conversation, snippet: null }));
    const out: Result[] = [];
    for (const conversation of conversations) {
      if (conversation.title.toLowerCase().includes(q)) {
        out.push({ conversation, snippet: null });
      } else {
        const hit = conversation.messages.find((m) => m.text.toLowerCase().includes(q));
        if (hit) out.push({ conversation, snippet: excerpt(hit.text, q) });
      }
      if (out.length >= 50) break;
    }
    return out;
  }, [conversations, query]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  const choose = (i: number) => {
    const result = results[i];
    if (!result) return;
    onSelect(result.conversation.id);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-scrim px-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search chats"
        className="dialog-in w-full max-w-[560px] overflow-hidden rounded-2xl border border-line bg-panel shadow-dialog"
      >
        <div className="flex h-14 items-center gap-3 border-b border-line px-4">
          <Search className="size-[18px] shrink-0 text-subtle" />
          <input
            autoFocus
            value={query}
            placeholder="Search chats"
            aria-label="Search chats"
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(index);
              } else if (e.key === "Escape") {
                onClose();
              }
            }}
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-subtle"
          />
          <kbd className="rounded-md border border-line px-1.5 py-0.5 font-sans text-[11px] text-subtle">
            Esc
          </kbd>
        </div>

        <ul ref={listRef} role="listbox" className="max-h-[min(60vh,420px)] overflow-y-auto p-2">
          {results.length === 0 ? (
            <li className="px-3 py-10 text-center text-sm text-subtle">
              {conversations.length ? "No chats match your search." : "No chats yet."}
            </li>
          ) : (
            results.map((result, i) => (
              <li key={result.conversation.id} data-index={i} role="option" aria-selected={i === index}>
                <button
                  type="button"
                  onMouseMove={() => setIndex(i)}
                  onClick={() => choose(i)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
                    i === index && "bg-ink/[0.06]",
                  )}
                >
                  <MessageSquare className="size-4 shrink-0 text-subtle" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{result.conversation.title}</span>
                    {result.snippet && (
                      <span className="mt-0.5 block truncate text-xs text-subtle">{result.snippet}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-subtle">
                    {formatShortDate(result.conversation.updatedAt)}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
