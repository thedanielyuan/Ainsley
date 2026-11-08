"use client";

import { ArrowUp, Camera, Library, Paperclip, Square, Upload } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import { UPLOAD_ACCEPT } from "@/lib/library";
import { cn } from "@/lib/utils";
import { AttachmentChip, type AttachmentView } from "./attachments";
import { Menu, type MenuEntry } from "./menu";

interface ComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop: () => void;
  streaming: boolean;
  placeholder: string;
  autoFocus?: boolean;
  ref?: Ref<HTMLTextAreaElement>;
  attachments?: AttachmentView[];
  onFiles?: (files: File[]) => void;
  onRemoveAttachment?: (id: string) => void;
  /** Pick files already in the linked course. */
  onBrowseLibrary?: () => void;
  /** The course chip, shown beside the attach button. */
  scopeControl?: ReactNode;
  /** Whether sending is possible (text or ready attachments, nothing still uploading). */
  canSubmit: boolean;
  /**
   * In a conversation: a single row (attach, text, course, send) while the text fits on one
   * line beside the controls, switching to the full layout once it doesn't.
   */
  compact?: boolean;
}

const coarsePointer = (cb: () => void) => {
  const mq = window.matchMedia("(pointer: coarse)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
};

// Two arrangements of the same elements, so switching never remounts the textarea.
const STACKED: CSSProperties = {
  gridTemplateColumns: "auto minmax(0, 1fr) auto",
  gridTemplateAreas: '"files files files" "text text text" "attach course send"',
};
const ROW: CSSProperties = {
  gridTemplateColumns: "auto minmax(0, 1fr) auto auto",
  gridTemplateAreas: '"files files files files" "attach text course send"',
};
// Single-row geometry, matching the classes below: side padding (ms-2/me-2), the three
// column gaps (gap-x-1.5) and the textarea's own padding (px-1).
const ROW_CHROME = 2 * 8 + 3 * 6 + 2 * 4;

/**
 * Grok-proportioned input: 24px radius, 16px/28px text, 14px top padding and a 58px
 * action row — 102px tall when empty, growing with the text up to 40% of the viewport.
 * Attached files sit above the text as chips. `compact` makes it a 58px row in chats.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  streaming,
  placeholder,
  autoFocus,
  ref,
  attachments = [],
  onFiles,
  onRemoveAttachment,
  onBrowseLibrary,
  scopeControl,
  canSubmit,
  compact = false,
}: ComposerProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const attachRef = useRef<HTMLDivElement>(null);
  const courseRef = useRef<HTMLDivElement>(null);
  const sendRef = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const stacked = !compact || overflows;
  const inputId = useId();
  useImperativeHandle(ref, () => textareaRef.current as HTMLTextAreaElement, []);
  const touch = useSyncExternalStore(
    coarsePointer,
    () => window.matchMedia("(pointer: coarse)").matches,
    () => false,
  );

  // Compact: does the text (or placeholder) fit on one line beside the controls? Measured
  // against the single-row width in either arrangement, so the answer can't flip-flop.
  useLayoutEffect(() => {
    const form = formRef.current;
    const probe = probeRef.current;
    if (!compact || !form || !probe) return;
    const measure = () => {
      const controls =
        (attachRef.current?.offsetWidth ?? 0) +
        (courseRef.current?.offsetWidth ?? 0) +
        (sendRef.current?.offsetWidth ?? 0);
      const room = form.clientWidth - ROW_CHROME - controls;
      setOverflows(value.includes("\n") || probe.offsetWidth + 2 > room);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(form);
    if (courseRef.current) observer.observe(courseRef.current);
    return () => observer.disconnect();
  }, [compact, value, placeholder]);

  const fitHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(fitHeight, [value, stacked, fitHeight]);

  // A new width (window resized, sidebar toggled) re-wraps the text: fit the height again.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fitHeight();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fitHeight]);

  useEffect(() => {
    // Skip on touch devices so the keyboard doesn't pop up uninvited.
    if (autoFocus && window.matchMedia("(pointer: fine)").matches) textareaRef.current?.focus();
  }, [autoFocus]);

  const canSend = canSubmit && !streaming;

  // Looked up by id at click time (menu items are built during render).
  const pick = (which: "files" | "camera") => {
    const input = document.getElementById(`${inputId}-${which}`) as HTMLInputElement | null;
    if (!input) return;
    input.value = "";
    input.click();
  };
  const onPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])];
    if (files.length) onFiles?.(files);
    e.target.value = "";
  };

  const attachItems: MenuEntry[] = [
    { key: "upload", label: "Upload files", icon: <Upload className="size-4" />, onSelect: () => pick("files") },
  ];
  if (touch) {
    attachItems.push({
      key: "camera",
      label: "Take a photo",
      icon: <Camera className="size-4" />,
      onSelect: () => pick("camera"),
    });
  }
  if (onBrowseLibrary) {
    attachItems.push({
      key: "library",
      label: "From course materials",
      icon: <Library className="size-4" />,
      onSelect: onBrowseLibrary,
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSubmit();
      }}
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("button, textarea, input")) textareaRef.current?.focus();
      }}
      className="relative w-full cursor-text rounded-[24px] border border-line bg-surface shadow-composer"
    >
      {onFiles && (
        <>
          <input id={`${inputId}-files`} type="file" multiple accept={UPLOAD_ACCEPT} hidden onChange={onPicked} />
          <input
            id={`${inputId}-camera`}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            onChange={onPicked}
          />
        </>
      )}

      {compact && (
        // Same font as the textarea, unwrapped: its width is the text's one-line width.
        <div aria-hidden="true" className="pointer-events-none invisible absolute size-0 overflow-hidden">
          <span ref={probeRef} className="whitespace-pre text-base">
            {value || placeholder}
          </span>
        </div>
      )}

      <div className="grid items-center gap-x-1.5" style={stacked ? STACKED : ROW}>
        {attachments.length > 0 && (
          <div style={{ gridArea: "files" }} className="flex gap-2 overflow-x-auto px-3 pb-0.5 pt-3">
            {attachments.map((item) => (
              <AttachmentChip key={item.id} item={item} onRemove={() => onRemoveAttachment?.(item.id)} />
            ))}
          </div>
        )}

        <div style={{ gridArea: "text" }} className={stacked ? "pe-3.5 ps-2.5" : "my-2"}>
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            placeholder={placeholder}
            aria-label="Message Ainsley"
            onChange={(e) => onChange(e.target.value)}
            onPaste={(e) => {
              // Pasted screenshots become attachments; pasted text stays text.
              const files = [...e.clipboardData.files];
              if (onFiles && files.length && !e.clipboardData.types.includes("text/plain")) {
                e.preventDefault();
                onFiles(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                if (canSend) onSubmit();
              }
            }}
            className={cn(
              "block max-h-[40dvh] w-full resize-none overflow-y-auto bg-transparent text-base leading-7 text-fg outline-none placeholder:text-muted",
              stacked ? "px-2 pt-3.5" : "px-1 py-1.5",
            )}
          />
        </div>

        {/* The controls: under the text when stacked (8px above, 10px below), or either side
            of it on one row (8px all round). */}
        <div ref={attachRef} style={{ gridArea: "attach" }} className={cn("flex", stacked ? "mb-2.5 ms-2.5 mt-2" : "my-2 ms-2")}>
          {onFiles &&
            (attachItems.length === 1 ? (
              <button
                type="button"
                onClick={() => pick("files")}
                aria-label="Attach files"
                title="Attach slides, PDFs or photos"
                className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-ink/[0.06] hover:text-fg"
              >
                <Paperclip className="size-[18px]" />
              </button>
            ) : (
              <Menu
                label="Attach files"
                placement="top-start"
                width={220}
                triggerClassName="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-muted transition-colors hover:bg-ink/[0.06] hover:text-fg"
                trigger={<Paperclip className="size-[18px]" />}
                items={attachItems}
              />
            ))}
        </div>
        <div
          ref={courseRef}
          style={{ gridArea: "course" }}
          className={cn("flex min-w-0 max-w-full justify-self-start", stacked ? "mb-2.5 mt-2" : "my-2")}
        >
          {scopeControl}
        </div>
        <div ref={sendRef} style={{ gridArea: "send" }} className={cn("flex", stacked ? "mb-2.5 me-2.5 mt-2" : "my-2 me-2")}>
          {streaming ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop generating"
              title="Stop"
              className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full bg-fg text-bg transition-opacity hover:opacity-85"
            >
              <Square className="size-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              aria-label="Send message"
              title="Send"
              className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-full bg-accent text-on-accent transition-colors hover:bg-accent-strong disabled:cursor-default disabled:bg-ink/[0.06] disabled:text-subtle"
            >
              <ArrowUp className="size-5" strokeWidth={2.25} />
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
