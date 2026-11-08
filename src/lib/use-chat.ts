"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { runTool, toolActivity } from "./agent-tools";
import { closeTurns, messageContent, nameThought, streamChat, toApiMessages } from "./chat-client";
import { summarizeReply } from "./citations";
import { SIMULATION_TOOL, simulationMarker, withoutSimulations } from "./simulation/marker";
import { buildContext, lastContextState, resolveScope } from "./course-context";
import {
  claimForConversation,
  deleteChatOnlyMaterials,
  getLibrary,
  loadLibrary,
  pruneOrphanMaterials,
} from "./library";
import {
  loadConversations,
  removeAllConversations,
  removeConversation,
  saveConversation,
} from "./storage";
import type {
  Activity,
  ApiBlock,
  ApiTurn,
  AttachmentMeta,
  ChatMessage,
  ChatScope,
  Conversation,
  Material,
  MessageStatus,
} from "./types";
import { createId, omit, titleFromText } from "./utils";

type ConversationMap = Record<string, Conversation>;

/** Fired after the app changes the URL itself (pushState doesn't fire popstate). */
export const NAVIGATE_EVENT = "ainsley:navigate";

/** Upper bound on API requests in one reply (tool rounds plus pause_turn resumes). */
const MAX_STEPS = 12;

/**
 * A thought is named once this much of its reasoning summary has arrived (or when it ends, if
 * sooner), and a long stretch of thinking becomes a new step after this much more, so the
 * timeline keeps moving while Ainsley thinks, as Grok's does.
 */
const NAME_THOUGHT_AFTER = 400;
const NEW_THOUGHT_AFTER = 1600;

function idFromPath(pathname: string) {
  return /^\/c\/([A-Za-z0-9_-]+)\/?$/.exec(pathname)?.[1] ?? null;
}

/** A response interrupted by a reload is shown — and replayed — as stopped. */
function settle(conversation: Conversation): Conversation {
  if (!conversation.messages.some((m) => m.status === "streaming")) return conversation;
  return {
    ...conversation,
    messages: conversation.messages.map((m) => {
      if (m.status !== "streaming") return m;
      const turns = m.turns ? closeTurns(m.turns) : undefined;
      return {
        ...m,
        status: "stopped",
        blocks: undefined,
        turns,
        activity: m.activity?.map((a) => (a.status === "running" ? { ...a, status: "done" } : a)),
      };
    }),
  };
}

function attachmentMeta(m: Material): AttachmentMeta {
  return {
    materialId: m.id,
    name: m.name,
    kind: m.kind,
    mimeType: m.mimeType,
    pageCount: m.pageCount,
    thumbnail: m.thumbnail,
  };
}

/** A student's message, with the course context to append after it if anything changed. */
function buildUserMessage(
  conversation: Conversation,
  history: ChatMessage[],
  text: string,
  materials: Material[],
): ChatMessage {
  const context = buildContext(
    getLibrary(),
    { courseId: conversation.courseId ?? null },
    lastContextState(history),
  );
  return {
    id: createId(),
    role: "user",
    text,
    createdAt: Date.now(),
    ...(materials.length
      ? { attachments: materials.map(attachmentMeta), content: messageContent(text, materials) }
      : {}),
    ...(context ? { context: context.text, contextState: context.state } : {}),
  };
}

export interface SendInput {
  text: string;
  /** Ready materials to attach. */
  attachmentIds: string[];
  /** Course scope for a new chat. */
  scope?: ChatScope;
}

export function useChat() {
  const [conversations, setConversations] = useState<ConversationMap>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [streaming, setStreaming] = useState<Record<string, true>>({});

  const conversationsRef = useRef(conversations);
  const activeIdRef = useRef(activeId);
  const controllers = useRef(new Map<string, AbortController>());
  const saved = useRef(new Map<string, Conversation>());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // Load saved conversations and the course library, then open the chat in the URL.
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadConversations().catch(() => [] as Conversation[]), loadLibrary()]).then(([list]) => {
      if (cancelled) return;
      const map: ConversationMap = {};
      for (const raw of list) {
        const conversation = settle(raw);
        map[conversation.id] = conversation;
        if (conversation === raw) saved.current.set(conversation.id, conversation);
      }
      setConversations(map);
      pruneOrphanMaterials(new Set(Object.keys(map)));
      const id = idFromPath(window.location.pathname);
      if (id && map[id]) setActiveId(id);
      else if (id) window.history.replaceState(null, "", "/");
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Back/forward buttons.
  useEffect(() => {
    const onPopState = () => {
      const id = idFromPath(window.location.pathname);
      setActiveId(id && conversationsRef.current[id] ? id : null);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Persist changed conversations at most twice a second (also mid-stream, so a reload
  // keeps the student's message and the partial reply).
  useEffect(() => {
    if (!ready || saveTimer.current) return;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      for (const conversation of Object.values(conversationsRef.current)) {
        if (saved.current.get(conversation.id) === conversation) continue;
        saved.current.set(conversation.id, conversation);
        void saveConversation(settle(conversation));
      }
    }, 500);
  }, [conversations, ready]);

  /** Opens a chat (or the new-chat screen). "none" leaves the URL to the caller (course pages). */
  const navigate = useCallback((id: string | null, mode: "push" | "replace" | "none" = "push") => {
    setActiveId(id);
    if (mode === "none") return;
    const url = id ? `/c/${id}` : "/";
    if (window.location.pathname === url) return;
    if (mode === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
    window.dispatchEvent(new Event(NAVIGATE_EVENT));
  }, []);

  const updateConversation = useCallback(
    (id: string, update: (c: Conversation) => Conversation) => {
      setConversations((prev) => (prev[id] ? { ...prev, [id]: update(prev[id]) } : prev));
    },
    [],
  );

  const updateMessage = useCallback(
    (conversationId: string, messageId: string, patch: Partial<ChatMessage>) => {
      updateConversation(conversationId, (c) => ({
        ...c,
        messages: c.messages.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
      }));
    },
    [updateConversation],
  );

  /**
   * Replaces the conversation with `history` and streams a reply onto it. A reply can take
   * several requests: when Ainsley calls a course tool, the tool runs here (the library is in
   * the browser) and the result goes back in a new request; a `pause_turn` from a long web
   * search is resumed the same way.
   */
  const generate = useCallback(
    async (conversationId: string, history: ChatMessage[]) => {
      controllers.current.get(conversationId)?.abort();
      const controller = new AbortController();
      controllers.current.set(conversationId, controller);
      setStreaming((s) => ({ ...s, [conversationId]: true }));

      const startedAt = Date.now();
      const assistantId = createId();
      updateConversation(conversationId, (c) => ({
        ...c,
        updatedAt: startedAt,
        messages: [
          ...history,
          { id: assistantId, role: "assistant", text: "", status: "streaming", createdAt: startedAt },
        ],
      }));

      const base = toApiMessages(history, getLibrary());
      const turns: ApiTurn[] = [];
      let activity: Activity[] = [];
      let text = "";
      let stepText = "";
      let thinkingMs: number | undefined;
      let container: string | null = null;
      let status: MessageStatus = "done";
      let error: string | undefined;
      let frame: number | null = null;
      let exhausted = false;

      const patch = (p: Partial<ChatMessage>) => updateMessage(conversationId, assistantId, p);
      const flush = () => {
        frame = null;
        patch({ text, thinkingMs, activity, turns: [...turns] });
      };
      const scheduleFlush = () => {
        frame ??= requestAnimationFrame(flush);
      };
      const cancelFlush = () => {
        if (frame !== null) cancelAnimationFrame(frame);
        frame = null;
      };
      const setActivity = (id: string, update: Partial<Activity>) => {
        activity = activity.map((a) => (a.id === id ? { ...a, ...update } : a));
      };

      // Whether the answer has begun since Ainsley's last step; until it has, Ainsley is working.
      let answering = false;
      // Set once the reply is saved: a thought named after that updates the saved reply.
      let finished = false;

      /** A new step in the timeline (a thought or a tool call): Ainsley is working again. */
      const addStep = (item: Activity) => {
        activity = [...activity, item];
        answering = false;
        thinkingMs = undefined;
      };

      const nameStep = (id: string, reasoning: string) => {
        void nameThought(reasoning).then((title) => {
          // A thought that couldn't be named says nothing: leave it out.
          const rename = (list: Activity[]) =>
            title ? list.map((a) => (a.id === id ? { ...a, label: title } : a)) : list.filter((a) => a.id !== id);
          if (!finished) {
            activity = rename(activity);
            scheduleFlush();
            return;
          }
          updateConversation(conversationId, (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantId && m.activity ? { ...m, activity: rename(m.activity) } : m,
            ),
          }));
        });
      };

      try {
        let step = 0;
        for (; step < MAX_STEPS; step++) {
          const prefix = text;
          stepText = "";
          let done: { content: ApiBlock[]; stopReason: string | null; container: string | null } | null = null;
          let streamError: string | null = null;
          // The thought being summarized in this response, if any.
          let thought: { id: string; reasoning: string; named: boolean } | null = null;

          await streamChat(
            { messages: [...base, ...turns], container },
            (event) => {
              switch (event.type) {
                case "text":
                  if (!answering) {
                    answering = true;
                    thinkingMs = Date.now() - startedAt;
                  }
                  stepText += event.text;
                  text = prefix && stepText && !prefix.endsWith("\n") ? `${prefix}\n\n${stepText}` : prefix + stepText;
                  scheduleFlush();
                  break;
                case "thinking": {
                  if (!thought) {
                    thought = { id: createId(), reasoning: "", named: false };
                    addStep({ id: thought.id, kind: "thought", label: "", status: "running" });
                  }
                  thought.reasoning += event.text;
                  if (!thought.named && thought.reasoning.length >= NAME_THOUGHT_AFTER) {
                    thought.named = true;
                    nameStep(thought.id, thought.reasoning);
                  } else if (thought.named && thought.reasoning.length >= NEW_THOUGHT_AFTER) {
                    setActivity(thought.id, { status: "done" });
                    thought = null;
                  }
                  scheduleFlush();
                  break;
                }
                case "thinking_stop":
                  if (thought) {
                    if (!thought.named) nameStep(thought.id, thought.reasoning);
                    setActivity(thought.id, { status: "done" });
                    thought = null;
                    scheduleFlush();
                  }
                  break;
                case "tool": {
                  const item = toolActivity(event.name, event.input, event.id);
                  if (item) {
                    addStep(item);
                    scheduleFlush();
                  }
                  break;
                }
                case "tool_result":
                  setActivity(event.id, {
                    status: event.ok ? "done" : "error",
                    detail: event.ok
                      ? event.count !== undefined
                        ? `${event.count} result${event.count === 1 ? "" : "s"}`
                        : undefined
                      : "Failed",
                  });
                  scheduleFlush();
                  break;
                case "done":
                  done = event;
                  break;
                case "error":
                  streamError = event.message;
                  break;
              }
            },
            controller.signal,
          );

          if (streamError || !done) {
            status = "error";
            error = streamError ?? "Something went wrong.";
            break;
          }
          const result: { content: ApiBlock[]; stopReason: string | null; container: string | null } = done;
          turns.push({ role: "assistant", content: result.content });
          stepText = "";
          container = result.container ?? container;

          if (result.stopReason === "refusal") {
            status = "refused";
            break;
          }
          if (result.stopReason === "pause_turn") continue;
          if (result.stopReason === "tool_use") {
            const conversation = conversationsRef.current[conversationId];
            const library = getLibrary();
            const scope = resolveScope(library, { courseId: conversation?.courseId ?? null });
            const calls = result.content.filter(
              (b): b is Extract<ApiBlock, { type: "tool_use" }> => b.type === "tool_use",
            );
            if (calls.length === 0) break;
            // The files on the student's message this reply answers: the work an answer check looks at.
            const attachments = (history.at(-1)?.attachments ?? [])
              .map((a) => library.materials[a.materialId])
              .filter((m): m is Material => Boolean(m));
            // Run the calls together (an answer check takes a while) and return every result in
            // one message, in call order.
            const outcomes = await Promise.all(
              calls.map(async (call) => {
                const outcome = await runTool(call, { ...scope, conversationId, attachments }, controller.signal);
                setActivity(call.id, { status: outcome.ok ? "done" : "error", detail: outcome.detail });
                scheduleFlush();
                return outcome;
              }),
            );
            // A simulation appears where Ainsley showed it, after what it wrote before the call.
            calls.forEach((call, i) => {
              if (call.name !== SIMULATION_TOOL || !outcomes[i].ok) return;
              if (text && !text.endsWith("\n")) text += "\n\n";
              text += `${simulationMarker(call.input)}\n`;
            });
            turns.push({ role: "user", content: outcomes.map((o) => o.result) });
            scheduleFlush();
            continue;
          }
          if (result.stopReason === "max_tokens") status = "truncated";
          break;
        }
        if (step === MAX_STEPS) {
          status = "truncated";
          exhausted = true;
        }
      } catch (err) {
        if (controller.signal.aborted) {
          status = "stopped";
        } else {
          status = "error";
          error = err instanceof Error ? err.message : "Something went wrong.";
        }
      } finally {
        cancelFlush();
        activity = activity.map((a) => (a.status === "running" ? { ...a, status: "done" } : a));
        thinkingMs ??= Date.now() - startedAt;

        if (status === "refused") {
          // Partial output from a declined response is discarded.
          patch({ text: "", turns: [], display: undefined, sources: undefined, activity, thinkingMs, status });
        } else if (status === "error") {
          patch({ text: withoutSimulations(text), turns: [...turns], activity, thinkingMs, status, error });
        } else {
          const finalTurns = closeTurns(
            stepText.trim() ? [...turns, { role: "assistant", content: [{ type: "text", text: stepText }] }] : turns,
          );
          const summary = summarizeReply(finalTurns, getLibrary());
          patch({
            text: summary.text || withoutSimulations(text),
            display: summary.display || undefined,
            sources: summary.sources.length ? summary.sources : undefined,
            turns: finalTurns,
            activity,
            thinkingMs,
            status,
            error: exhausted ? "Ainsley stopped after too many steps." : undefined,
          });
        }
        finished = true;

        if (controllers.current.get(conversationId) === controller) {
          controllers.current.delete(conversationId);
          setStreaming((s) => omit(s, conversationId));
        }
      }
    },
    [updateConversation, updateMessage],
  );

  /** Sends a message (with any attachments) to the open chat, or starts a new one. */
  const send = useCallback(
    (input: SendInput): boolean => {
      const library = getLibrary();
      if (!library.ready) return false;
      const text = input.text.trim();
      const materials = input.attachmentIds
        .map((id) => library.materials[id])
        .filter((m): m is Material => Boolean(m));
      if (!text && materials.length === 0) return false;

      const currentId = activeIdRef.current;
      let conversation = currentId ? conversationsRef.current[currentId] : undefined;
      if (conversation && controllers.current.has(conversation.id)) return false;

      if (!conversation) {
        const now = Date.now();
        const scope = resolveScope(library, input.scope ?? { courseId: null });
        conversation = {
          id: createId(),
          title: titleFromText(text || materials[0]?.name || ""),
          messages: [],
          createdAt: now,
          updatedAt: now,
          courseId: scope.courseId,
        };
        const created = conversation;
        setConversations((prev) => ({ ...prev, [created.id]: created }));
        navigate(created.id);
      }

      claimForConversation(input.attachmentIds, conversation.id);
      const message = buildUserMessage(conversation, conversation.messages, text, materials);
      void generate(conversation.id, [...conversation.messages, message]);
      return true;
    },
    [generate, navigate],
  );

  /** Puts a chat in a course (or takes it out). Ainsley is told on the next message. */
  const setScope = useCallback(
    (conversationId: string, scope: ChatScope) => {
      updateConversation(conversationId, (c) => ({ ...c, courseId: scope.courseId }));
    },
    [updateConversation],
  );

  const stop = useCallback((conversationId: string) => {
    controllers.current.get(conversationId)?.abort();
  }, []);

  const regenerate = useCallback(
    (conversationId: string) => {
      const c = conversationsRef.current[conversationId];
      if (!c || controllers.current.has(conversationId)) return;
      let end = c.messages.length;
      while (end > 0 && c.messages[end - 1].role === "assistant") end--;
      if (end > 0) void generate(conversationId, c.messages.slice(0, end));
    },
    [generate],
  );

  /** Edits a student message and regenerates from there; later turns are discarded. */
  const editMessage = useCallback(
    (conversationId: string, messageId: string, input: string) => {
      const c = conversationsRef.current[conversationId];
      const text = input.trim();
      if (!c || controllers.current.has(conversationId)) return;
      const index = c.messages.findIndex((m) => m.id === messageId && m.role === "user");
      if (index === -1) return;
      const library = getLibrary();
      const materials = (c.messages[index].attachments ?? [])
        .map((a) => library.materials[a.materialId])
        .filter((m): m is Material => Boolean(m));
      if (!text && materials.length === 0) return;
      const history = c.messages.slice(0, index);
      void generate(conversationId, [...history, buildUserMessage(c, history, text, materials)]);
    },
    [generate],
  );

  const rename = useCallback(
    (id: string, title: string) => {
      const clean = title.replace(/\s+/g, " ").trim();
      if (clean) updateConversation(id, (c) => ({ ...c, title: clean }));
    },
    [updateConversation],
  );

  const remove = useCallback(
    (id: string) => {
      controllers.current.get(id)?.abort();
      saved.current.delete(id);
      setConversations((prev) => omit(prev, id));
      void removeConversation(id);
      deleteChatOnlyMaterials(id);
      if (activeIdRef.current === id) navigate(null, "replace");
    },
    [navigate],
  );

  const removeAll = useCallback(() => {
    for (const controller of controllers.current.values()) controller.abort();
    saved.current.clear();
    setConversations({});
    void removeAllConversations();
    deleteChatOnlyMaterials();
    navigate(null, "replace");
  }, [navigate]);

  const select = useCallback((id: string) => navigate(id), [navigate]);
  const newChat = useCallback(() => navigate(null), [navigate]);

  const list = useMemo(
    () => Object.values(conversations).sort((a, b) => b.updatedAt - a.updatedAt),
    [conversations],
  );

  return {
    ready,
    conversations: list,
    active: activeId ? (conversations[activeId] ?? null) : null,
    activeId,
    streaming,
    send,
    setScope,
    stop,
    regenerate,
    editMessage,
    rename,
    remove,
    removeAll,
    select,
    newChat,
    navigate,
  };
}
