import type { ToolOutcome } from "./course-tools";
import { EVALUATE_TOOL, SOLVE_TOOL } from "./tool-names";
import type { AnswerVerdict, ChatMessage, HelpRung, ReplyTutoring, TutoringEvent } from "./types";

/**
 * The tutoring policy: guiding principles 1 and 2 (learning over answers; the student's own
 * thinking comes before Ainsley's) as rules the app applies, not only words in the system prompt.
 *
 * For each problem Ainsley works out with solve_problem, the app tracks whether the student has
 * attempted it (an evaluate_answer check of their work) and the most help they've had, as a rung of
 * the help ladder. Before each request it works out the most help allowed this turn and tells
 * Ainsley in a system message after the student's message, appended like course context, so the
 * history stays append-only and the system prompt never changes. The results of solve_problem and
 * evaluate_answer carry the policy too, since they change it mid-turn. After each reply, a review
 * (/api/review) records the rung the reply used, so help rises one rung a turn.
 *
 * The state is folded from what each reply recorded (ChatMessage.tutoring), so editing a message or
 * regenerating a reply rewinds it with the conversation. A learner model can later lower the rung
 * allowed as mastery grows: decideHelp is the one place that decides it.
 */

/** The help ladder, from least help to most. */
export const HELP_RUNGS: readonly HelpRung[] = ["nudge", "hint", "step", "example", "solution"];

/** How many rungs up: 0 for no help. */
export const rungLevel = (rung: HelpRung | null | undefined) => (rung ? HELP_RUNGS.indexOf(rung) + 1 : 0);
const rungAt = (level: number): HelpRung => HELP_RUNGS[Math.min(Math.max(level, 1), HELP_RUNGS.length) - 1];
const higher = (a: HelpRung | null, b: HelpRung | null) => (rungLevel(b) > rungLevel(a) ? b : a);

/** Before their first attempt, help stops here: worked steps, examples and solutions wait for one. */
const BEFORE_ATTEMPT: HelpRung = "hint";

const RUNG_NAMES: Record<HelpRung, string> = {
  nudge: "a nudge",
  hint: "a specific hint",
  step: "a worked step",
  example: "a worked example of a similar problem",
  solution: "the full solution",
};

// What each rung allows, as the policy states it to Ainsley (the system prompt defines the ladder).
const RUNG_RULES: Record<HelpRung, string> = {
  nudge: "a nudge: a question or pointer toward the key idea or where to look, without naming the method",
  hint: "a specific hint: the method or next step, named but not carried out",
  step: "a worked step: carry out the next step of their problem, short of the final answer",
  example: "a worked example: work a similar problem in full, not this one, then have them return to theirs",
  solution:
    "the full solution, only if seeing it worked will serve their learning more than another hint; then have them try a similar problem on their own",
};

const VERDICT_NAMES: Record<AnswerVerdict, string> = {
  correct: "correct",
  partially_correct: "partly correct",
  incorrect: "not correct yet",
  incomplete: "incomplete",
  cannot_evaluate: "couldn't be checked",
};

// ---------- State ----------

export interface ProblemState {
  id: string;
  /** The problem as Ainsley gave it to solve_problem or evaluate_answer (clipped). */
  problem: string;
  /** evaluate_answer checks of the student's work on it. */
  attempts: number;
  /** The latest check's verdict. */
  verdict?: AnswerVerdict;
  /** The most help given on it so far. */
  rung: HelpRung | null;
  /** A similar problem worked out for a worked example, not one the student is on. */
  example?: boolean;
  /** The reply (counting from 1) that last worked on it. */
  touched: number;
}

export interface TutoringState {
  problems: Record<string, ProblemState>;
  /** The problem the student worked on last. */
  focus: string | null;
  /** Ainsley's replies so far. */
  replies: number;
}

/** A problem left for a detour (a prerequisite, a practice question) is resumed if it's this recent. */
const RESUME_WITHIN = 8;

const MAX_PROBLEM_TEXT = 1_000;
const clip = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
};

/** Applies what a reply established; `reply` counts the replies from 1. */
function applyEvent(state: TutoringState, event: TutoringEvent, reply: number) {
  let p = state.problems[event.problemId];
  if (!p) {
    p = { id: event.problemId, problem: event.problem ?? "", attempts: 0, rung: null, touched: reply };
    if (event.type === "solved" && event.example) p.example = true;
    state.problems[p.id] = p;
  }
  if (event.type === "solved") {
    if (event.example) return; // A worked example doesn't take the student's problem's place.
  } else {
    p.attempts++;
    p.verdict = event.verdict;
  }
  delete p.example;
  p.touched = reply;
  state.focus = p.id;
}

/**
 * The problem in progress: the one the student worked on last, or, once that's solved, the one
 * they left for it (a prerequisite detour, a practice question) if it's recent and unsolved.
 */
export function problemInProgress(state: TutoringState): { problem: ProblemState; solved?: ProblemState } | null {
  const last = state.focus ? state.problems[state.focus] : undefined;
  if (!last) return null;
  if (last.verdict !== "correct") return { problem: last };
  const left = Object.values(state.problems)
    .filter((p) => p !== last && !p.example && p.verdict !== "correct" && state.replies - p.touched < RESUME_WITHIN)
    .sort((a, b) => b.touched - a.touched)[0];
  return left ? { problem: left, solved: last } : { problem: last };
}

/** The most help a reply gave on its problem: as reviewed, or, if it couldn't be, as much as it was allowed. */
function helpGiven(m: ChatMessage): HelpRung | null {
  const t = m.tutoring;
  if (!t) return null;
  if (t.used !== undefined) return t.used;
  return m.status === "done" || m.status === "truncated" || m.status === "stopped" ? (t.allowed ?? null) : null;
}

/** Each problem's state, folded from what Ainsley's replies recorded. */
export function tutoringState(history: ChatMessage[]): TutoringState {
  const state: TutoringState = { problems: {}, focus: null, replies: 0 };
  for (const m of history) {
    if (m.role !== "assistant") continue;
    state.replies++;
    const t = m.tutoring;
    if (!t) continue;
    for (const event of t.events) applyEvent(state, event, state.replies);
    const p = t.problemId ? state.problems[t.problemId] : undefined;
    if (p) p.rung = higher(p.rung, helpGiven(m));
  }
  return state;
}

// ---------- What the student's messages signal ----------

export interface TurnSignals {
  /** An exam or test within about a day, mentioned in this chat in the last day. */
  examSoon: boolean;
  /** Their latest message says they're stuck. */
  saysStuck: boolean;
}

const EXAM = String.raw`(?:exam|midterm|test|quiz|final exam|finals|(?:my|our) final)s?`;
const SOON = String.raw`(?:tomorrow|tonight|today|this (?:morning|afternoon|evening)|in (?:an?|one|two|three|a few|\d+) hours?)`;
const EXAM_SOON = new RegExp(
  String.raw`\b${EXAM}\b[^.!?\n]{0,40}?\b${SOON}\b|\b${SOON}(?:'s)?\b[^.!?\n]{0,25}?\b${EXAM}\b`,
  "i",
);
const STUCK =
  /\b(?:stuck|confused|no idea|no clue|give up|giving up|makes no sense|(?:i'?m|i am|totally|completely|still) lost|(?:don'?t|do not|can'?t|cannot|still don'?t) (?:know|get|understand|see|figure|do|solve|work))\b/i;
const DAY = 24 * 60 * 60 * 1000;

const plain = (text: string) => text.replace(/[‘’]/g, "'");

export function turnSignals(history: ChatMessage[], now = Date.now()): TurnSignals {
  const students = history.filter((m) => m.role === "user");
  const latest = students.at(-1);
  return {
    examSoon: students.some((m) => now - m.createdAt < DAY && EXAM_SOON.test(plain(m.text))),
    saysStuck: Boolean(latest && STUCK.test(plain(latest.text))),
  };
}

// ---------- The policy ----------

export interface HelpDecision {
  /** The most help allowed this turn. */
  allowed: HelpRung;
  /** Why help may rise two rungs this turn, when it may. */
  faster?: string;
}

/**
 * The most help allowed on a problem this turn: one rung above the help given so far, no further
 * than a specific hint before the student has attempted it, and two rungs when they're stuck after
 * a real attempt or have an exam within a day. Once their answer checks correct, anything goes.
 */
export function decideHelp(p: ProblemState, signals: TurnSignals): HelpDecision {
  if (p.verdict === "correct") return { allowed: "solution" };
  const given = rungLevel(p.rung);
  if (p.attempts === 0) return { allowed: rungAt(Math.min(given + 1, rungLevel(BEFORE_ATTEMPT))) };
  const faster =
    p.attempts >= 2 || signals.saysStuck
      ? "they're stuck after a real attempt"
      : signals.examSoon
        ? "they have an exam within a day"
        : undefined;
  return faster ? { allowed: rungAt(given + 2), faster } : { allowed: rungAt(given + 1) };
}

function label(p: ProblemState) {
  return `${p.id} (“${clip(p.problem, 90) || "a problem"}”)`;
}

/** The problem's state and what this turn allows, as Ainsley reads it. */
function describeState(p: ProblemState, d: HelpDecision): string {
  if (p.verdict === "correct") {
    return "Their answer checked correct: they've solved it. Confirm what they got right; you may now show the full solution or a cleaner method, then offer a similar problem to try on their own.";
  }
  const given = p.rung ? `Help so far: up to ${RUNG_NAMES[p.rung]}.` : "No help given yet.";
  if (p.attempts === 0) {
    return [
      `No attempt yet. ${given}`,
      p.rung
        ? "Ask again for their attempt or plan: what they've tried, or how they'd start."
        : "Ask for their attempt or plan before you help.",
      `The most help allowed this turn is ${RUNG_RULES[d.allowed]}.`,
      d.allowed === BEFORE_ATTEMPT ? "Worked steps, examples and the solution wait until they've attempted it." : "",
      `If they share any working or a plan, check it with evaluate_answer (problem_id "${p.id}"): that records their attempt.`,
    ]
      .filter(Boolean)
      .join(" ");
  }
  const tries = p.attempts === 1 ? "once" : `${p.attempts} times`;
  const verdict = p.verdict ? `; last check: ${VERDICT_NAMES[p.verdict]}` : "";
  return [
    `Attempted ${tries}${verdict}. ${given}`,
    `The most help allowed this turn is ${RUNG_RULES[d.allowed]}${d.faster ? ` (two rungs, since ${d.faster})` : ""}.`,
    "Give less if less will do.",
  ].join(" ");
}

/** The system message for this turn: the problem in progress and the most help allowed. */
export function policyMessage(p: ProblemState, d: HelpDecision, solved?: ProblemState): string {
  return [
    solved
      ? `Tutoring policy: they've solved ${label(solved)}. Back to the problem they were on before it, ${label(p)}:`
      : `Tutoring policy for the problem in progress, ${label(p)}:`,
    describeState(p, d),
    "If they've moved on to a different problem, this doesn't apply to it: start that one by asking for their attempt or plan, with at most a nudge.",
  ].join("\n");
}

type ToolResult = ToolOutcome["result"];

function withLine(result: ToolResult, line: string): ToolResult {
  if (typeof result.content === "string") return { ...result, content: `${result.content}\n\n${line}` };
  if (Array.isArray(result.content)) return { ...result, content: [...result.content, { type: "text", text: line }] };
  return { ...result, content: line };
}

const sameText = (a: string, b: string) => clip(a, MAX_PROBLEM_TEXT).toLowerCase() === clip(b, MAX_PROBLEM_TEXT).toLowerCase();

/**
 * One reply's tutoring: the policy it starts with, what its tool calls establish (with the policy
 * added to their results), and what to record on it.
 */
export class TurnTutor {
  /** The system message to send after the student's message; null when there's nothing to say. */
  readonly policy: string | null;
  private readonly state: TutoringState;
  private readonly signals: TurnSignals;
  private readonly events: TutoringEvent[] = [];

  /** `history` ends with the student's message this reply answers. */
  constructor(history: ChatMessage[], now = Date.now()) {
    this.state = tutoringState(history);
    this.signals = turnSignals(history, now);
    const current = problemInProgress(this.state);
    const p = current?.problem;
    const text = p ? policyMessage(p, decideHelp(p, this.signals), current.solved) : null;
    // A solved problem is said once; one still in progress is restated every turn.
    const previous = history.slice(0, -1).findLast((m) => m.role === "user" && m.policy)?.policy;
    this.policy = p?.verdict === "correct" && text === previous ? null : text;
  }

  /** The problem in progress. */
  focus(): ProblemState | null {
    return problemInProgress(this.state)?.problem ?? null;
  }

  /** Records what a solve_problem or evaluate_answer call established; returns its result with the policy added. */
  afterTool(name: string, outcome: ToolOutcome): ToolResult {
    const info = outcome.problem;
    if (!outcome.ok || !info) return outcome.result;

    if (name === SOLVE_TOOL) {
      const current = this.focus();
      // A new problem worked out while a worked example is allowed on the one in progress is
      // taken to be that example: it doesn't become the problem in progress.
      const example = Boolean(
        current &&
          !this.state.problems[info.id] &&
          current.verdict !== "correct" &&
          rungLevel(decideHelp(current, this.signals).allowed) >= rungLevel("example"),
      );
      this.apply({ type: "solved", problemId: info.id, problem: clip(info.text, MAX_PROBLEM_TEXT), ...(example ? { example } : {}) });
      if (example && current) {
        return withLine(
          outcome.result,
          `Tutoring policy: a worked example is allowed on the problem in progress, ${label(current)}, so this is taken to be that similar problem, not one the student is working on. If the student brought it as a new problem instead, ask for their attempt or plan first, with at most a nudge.`,
        );
      }
      const p = this.state.problems[info.id];
      return withLine(outcome.result, `Tutoring policy for this problem: ${describeState(p, decideHelp(p, this.signals))}`);
    }

    if (name === EVALUATE_TOOL && info.verdict) {
      const known =
        this.state.problems[info.id] ?? Object.values(this.state.problems).find((p) => sameText(p.problem, info.text));
      const id = known?.id ?? info.id;
      this.apply({
        type: "checked",
        problemId: id,
        verdict: info.verdict,
        ...(known ? {} : { problem: clip(info.text, MAX_PROBLEM_TEXT) }),
      });
      const p = this.state.problems[id];
      return withLine(
        outcome.result,
        `Tutoring policy: this check records their attempt at ${label(p)}. ${describeState(p, decideHelp(p, this.signals))}`,
      );
    }
    return outcome.result;
  }

  private apply(event: TutoringEvent) {
    this.events.push(event);
    applyEvent(this.state, event, this.state.replies + 1);
  }

  /**
   * What to store on the reply; undefined when no problem is involved. `helps` is false for a
   * reply that isn't help to the student (a correction the app asked for): its events count, but
   * it doesn't move the problem up the ladder.
   */
  record(helps = true): ReplyTutoring | undefined {
    const p = helps ? this.focus() : null;
    if (!this.events.length && !p) return undefined;
    return {
      events: [...this.events],
      ...(p ? { problemId: p.id, allowed: decideHelp(p, this.signals).allowed } : {}),
    };
  }
}
