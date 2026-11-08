"use client";

import { ArrowDown } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { Conversation } from "@/lib/types";
import { MessageItem } from "./message";

export function ConversationView({
  conversation,
  streaming,
  composer,
  onRegenerate,
  onEdit,
}: {
  conversation: Conversation;
  streaming: boolean;
  composer: ReactNode;
  onRegenerate: (conversationId: string) => void;
  onEdit: (conversationId: string, messageId: string, text: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const { id, messages } = conversation;
  const lastId = messages[messages.length - 1]?.id;

  // A new turn (send, regenerate, edit) always brings the view back down.
  useLayoutEffect(() => {
    stickToBottom.current = true;
  }, [lastId]);

  // Follow the stream unless the student has scrolled up to read.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
    stickToBottom.current = near;
    setAtBottom((prev) => (prev === near ? prev : near));
  };

  const scrollToBottom = () => {
    stickToBottom.current = true;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  };

  const handleRegenerate = useCallback(() => onRegenerate(id), [onRegenerate, id]);
  const handleEdit = useCallback(
    (messageId: string, text: string) => onEdit(id, messageId, text),
    [onEdit, id],
  );

  return (
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
            <div className="px-4">
              <div className="mx-auto flex w-full max-w-[752px] flex-col gap-8 pb-10 pt-6 md:pt-12">
                {messages.map((message, i) => (
                  <MessageItem
                    key={message.id}
                    message={message}
                    isLast={i === messages.length - 1}
                    busy={streaming}
                    onRegenerate={handleRegenerate}
                    onEdit={handleEdit}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="relative shrink-0 px-4 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
            {!atBottom && (
              <button
                type="button"
                onClick={scrollToBottom}
                aria-label="Scroll to latest message"
                className="absolute -top-14 left-1/2 grid size-9 -translate-x-1/2 place-items-center rounded-full border border-line bg-elevated text-muted shadow-lg transition-colors hover:text-fg"
              >
                <ArrowDown className="size-4" />
              </button>
            )}
            <div className="mx-auto w-full max-w-[752px]">{composer}</div>
            <p className="pt-2 text-center text-xs leading-4 text-subtle">Ainsley is AI and can make mistakes.</p>
          </div>
        </div>

      </div>
  );
}
