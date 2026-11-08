"use client";

import {
  BookOpen,
  Calculator,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileSearch,
  Globe,
  Layers,
  Lightbulb,
  Link2,
  Network,
  Search,
  ShieldAlert,
  ShieldCheck,
  Shapes,
  SquareFunction,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { auditLabel } from "@/lib/math-check";
import type { Activity, MathAudit } from "@/lib/types";
import { cn, formatDuration } from "@/lib/utils";

/**
 * What Ainsley did before answering, laid out like Grok's thinking. While it works, a timeline
 * grows above a "Working for 12s" row: each stretch of thinking by name ("Planning a hint for
 * part (b)"), and each lookup. When the answer starts, the row turns into "Worked for 28s"; when
 * the reply is done, the steps fold into that line, which opens them again. Beside it, a reply
 * whose math couldn't be verified says "Not verified".
 */

/** Below this, a reply with no steps doesn't say how long it took. */
const MIN_SHOWN_MS = 2000;

type Step = { type: "one"; item: Activity } | { type: "searches"; id: string; items: Activity[] };

const SEARCHES = new Set<Activity["kind"]>(["materials", "web_search"]);

const ICONS: Record<Activity["kind"], LucideIcon> = {
  thought: Lightbulb,
  materials: BookOpen,
  open: FileSearch,
  module: Layers,
  solve: SquareFunction,
  evaluate: ClipboardCheck,
  check: Calculator,
  simulation: Shapes,
  prerequisites: Network,
  web_search: Globe,
  web_fetch: Link2,
};

/** Steps that stand alone even when repeated: thoughts, solves, answer and math checks, simulations and prerequisite maps. */
const STANDALONE = new Set<Activity["kind"]>(["thought", "solve", "evaluate", "check", "simulation", "prerequisites"]);

/** Result filtering can repeat an identical lookup; show it once. */
function dedupe(activity: Activity[]) {
  const seen = new Set<string>();
  return activity.filter((a) => {
    if (STANDALONE.has(a.kind)) return true;
    const key = `${a.kind}:${a.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Back-to-back searches fold into one "Ran 3 searches" step, as in Grok. */
function toSteps(activity: Activity[]): Step[] {
  const steps: Step[] = [];
  for (const item of dedupe(activity)) {
    const last = steps.at(-1);
    if (last && SEARCHES.has(item.kind)) {
      if (last.type === "searches") {
        last.items.push(item);
        continue;
      }
      if (SEARCHES.has(last.item.kind)) {
        steps[steps.length - 1] = { type: "searches", id: last.item.id, items: [last.item, item] };
        continue;
      }
    }
    steps.push({ type: "one", item });
  }
  return steps;
}

function Query({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px] opacity-80">{children}</span>;
}

function describe(a: Activity): ReactNode {
  const now = a.status === "running";
  switch (a.kind) {
    case "thought":
      return a.label || "Thinking";
    case "materials":
      return <>{now ? "Searching" : "Searched"} your materials for <Query>{a.label}</Query></>;
    case "web_search":
      return <>{now ? "Searching" : "Searched"} the web for <Query>{a.label}</Query></>;
    case "open":
      return `${now ? "Opening" : "Opened"} ${a.label}`;
    case "module":
      return `${now ? "Reading" : "Read"} “${a.label}” from your course`;
    case "solve":
      return now ? "Solving the problem" : "Solved the problem";
    case "evaluate":
      return now ? "Checking your answer" : "Checked your answer";
    case "check":
      return now ? "Checking the math" : "Checked the math";
    case "simulation":
      return `${now ? "Drawing" : "Drew"} a ${a.label}`;
    case "prerequisites":
      return `${now ? "Tracing" : "Traced"} what “${a.label}” builds on`;
    case "web_fetch":
      return <>{now ? "Reading" : "Read"} <Query>{a.label}</Query></>;
  }
}

/** The 28px column the step icons (and the line joining them) sit in. */
function IconCell({ children }: { children: ReactNode }) {
  return <span className="flex h-6 w-7 shrink-0 items-center justify-center text-subtle">{children}</span>;
}

function StepRow({ item }: { item: Activity }) {
  const Icon = ICONS[item.kind];
  return (
    <div className="flex min-w-0 items-start gap-0.5 text-sm leading-6">
      <IconCell>
        <Icon className="size-3.5" />
      </IconCell>
      <span className={cn("min-w-0 flex-1 truncate ps-0.5", item.status === "running" ? "shimmer" : "text-subtle")}>
        {describe(item)}
      </span>
      {item.detail && (
        <span className={cn("shrink-0 pe-2 text-xs leading-6", item.status === "error" ? "text-danger" : "text-subtle")}>
          {item.detail}
        </span>
      )}
    </div>
  );
}

function SearchGroup({ items }: { items: Activity[] }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const running = items.some((a) => a.status === "running");
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={listId}
        className="group/searches flex w-full min-w-0 items-start gap-0.5 rounded-md text-left text-sm leading-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <IconCell>
          {open ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <>
              <Search className="size-3.5 group-hover/searches:hidden" />
              <ChevronRight className="hidden size-3.5 group-hover/searches:block" />
            </>
          )}
        </IconCell>
        <span
          className={cn(
            "min-w-0 flex-1 truncate ps-0.5",
            running ? "shimmer" : "text-subtle transition-colors group-hover/searches:text-muted",
          )}
        >
          {running ? `Running ${items.length} searches` : `Ran ${items.length} searches`}
        </span>
      </button>
      {open && (
        <ul id={listId} className="mt-2 flex flex-col gap-2 ps-4">
          {items.map((a) => (
            <li key={a.id}>
              <StepRow item={a} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The check of the reply's math, as the last step in the list. */
function auditStep(audit: MathAudit | undefined): Activity | null {
  const label = audit && auditLabel(audit.status);
  if (!audit || !label) return null;
  const claims = audit.claims ?? [];
  const count = (n: number, what = "claim") => `${n} ${what}${n === 1 ? "" : "s"}`;
  const wrong = claims.filter((c) => c.status === "false").length;
  const unchecked = claims.filter((c) => c.status === "cannot_check").length;
  let text = "Checking the math in this reply";
  if (audit.status === "checked") text = `Checked ${count(claims.length)} by running code`;
  else if (audit.status === "wrong") text = `Found ${count(wrong, "false claim")}${audit.corrected ? ", corrected below" : ""}`;
  else if (audit.status === "unverified") text = `Couldn't verify ${unchecked} of ${count(claims.length)}`;
  else if (audit.status === "failed") text = "Couldn't check the math in this reply";
  return { id: "audit", kind: "check", label: text, status: audit.status === "running" ? "running" : "done" };
}

function StepList({ steps, id, audit }: { steps: Step[]; id?: string; audit?: MathAudit }) {
  const last = auditStep(audit);
  const all: Step[] = last ? [...steps, { type: "one", item: last }] : steps;
  return (
    <ol id={id} aria-label="What Ainsley did" className="flex flex-col gap-2">
      {all.map((step, i) => (
        <li key={step.type === "one" ? step.item.id : step.id} className="relative">
          {/* The line joining this step's icon to the next one's, past any steps folded under it. */}
          {i < all.length - 1 && (
            <span aria-hidden="true" className="absolute -bottom-[9px] left-3.5 top-[23px] w-px -translate-x-1/2 bg-line" />
          )}
          {step.type === "one" ? (
            step.item === last ? <AuditRow audit={audit!} step={last} /> : <StepRow item={step.item} />
          ) : (
            <SearchGroup items={step.items} />
          )}
        </li>
      ))}
    </ol>
  );
}

function AuditRow({ audit, step }: { audit: MathAudit; step: Activity }) {
  const Icon = audit.status === "checked" ? ShieldCheck : audit.status === "running" ? Calculator : ShieldAlert;
  return (
    <div className="flex min-w-0 items-start gap-0.5 text-sm leading-6">
      <IconCell>
        <Icon className="size-3.5" />
      </IconCell>
      <span className={cn("min-w-0 flex-1 truncate ps-0.5", step.status === "running" ? "shimmer" : "text-subtle")}>
        {step.label}
      </span>
    </div>
  );
}

/**
 * What sits beside "Worked for 28s": the check still running, or "Not verified". Math that checked
 * out needs no badge; the step list still ends with what was checked.
 */
function badgeLabel(audit?: MathAudit): string | null {
  if (!audit || audit.status === "checked") return null;
  return auditLabel(audit.status);
}

function AuditBadge({ audit }: { audit?: MathAudit }) {
  const label = badgeLabel(audit);
  if (!audit || !label) return null;
  if (audit.status === "running") {
    return (
      <span role="status" className="inline-flex items-center gap-1.5 text-sm leading-6 text-subtle">
        <span aria-hidden="true" className="work-spinner" />
        <span className="shimmer">{label}</span>
      </span>
    );
  }
  return (
    <span role="status" className="inline-flex items-center gap-1 text-sm leading-6 text-muted">
      <ShieldAlert aria-hidden="true" className="size-3.5" />
      {label}
    </span>
  );
}

function WorkingRow({ startedAt }: { startedAt: number }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const tick = () => setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    const first = requestAnimationFrame(tick);
    const timer = setInterval(tick, 1000);
    return () => {
      cancelAnimationFrame(first);
      clearInterval(timer);
    };
  }, [startedAt]);

  return (
    <div role="status" className="flex items-start gap-0.5 text-sm leading-6 text-subtle">
      <IconCell>
        <span aria-hidden="true" className="work-spinner" />
      </IconCell>
      <span className="ps-0.5">{seconds > 0 ? `Working for ${formatDuration(seconds * 1000)}` : "Working"}</span>
    </div>
  );
}

export function WorkTimeline({
  activity,
  live,
  startedAt,
  workMs,
  audit,
}: {
  activity: Activity[];
  /** The reply is still streaming. */
  live: boolean;
  startedAt: number;
  /** How long Ainsley worked before answering; undefined while it's still working. */
  workMs?: number;
  /** The check of the reply's math, once it's finished. */
  audit?: MathAudit;
}) {
  const steps = useMemo(() => toSteps(activity), [activity]);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const worked = workMs !== undefined ? `Worked for ${formatDuration(workMs)}` : "Worked";
  const workedLine = <p className="text-sm leading-6 text-subtle">{worked}</p>;

  if (live) {
    const working = workMs === undefined;
    if (!steps.length && !working) return workMs >= MIN_SHOWN_MS ? workedLine : null;
    return (
      <div className="flex flex-col gap-3">
        {steps.length > 0 && <StepList steps={steps} />}
        {working ? <WorkingRow startedAt={startedAt} /> : workedLine}
      </div>
    );
  }

  const badge = <AuditBadge audit={audit} />;
  if (!steps.length) {
    const showWorked = workMs !== undefined && workMs >= MIN_SHOWN_MS;
    if (!showWorked && !badgeLabel(audit)) return null;
    return (
      <div className="flex flex-wrap items-center gap-x-3">
        {showWorked && workedLine}
        {badge}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls={listId}
          className="flex w-fit items-center gap-1 rounded-md text-sm leading-6 text-subtle transition-colors hover:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          {worked}
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
        </button>
        {badge}
      </div>
      {open && <StepList id={listId} steps={steps} audit={audit} />}
    </div>
  );
}
