"use client";

import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileSearch,
  Globe,
  Layers,
  Lightbulb,
  Link2,
  Search,
  Shapes,
  SquareFunction,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import type { Activity } from "@/lib/types";
import { cn, formatDuration } from "@/lib/utils";

/**
 * What Ainsley did before answering, laid out like Grok's thinking. While it works, a timeline
 * grows above a "Working for 12s" row: each stretch of thinking by name ("Planning a hint for
 * part (b)"), and each lookup. When the answer starts, the row turns into "Worked for 28s"; when
 * the reply is done, the steps fold into that line, which opens them again.
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
  simulation: Shapes,
  web_search: Globe,
  web_fetch: Link2,
};

/** Result filtering can repeat an identical lookup; show it once. Thoughts, solves, answer checks and simulations stand alone. */
function dedupe(activity: Activity[]) {
  const seen = new Set<string>();
  return activity.filter((a) => {
    if (a.kind === "thought" || a.kind === "solve" || a.kind === "evaluate" || a.kind === "simulation") return true;
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
    case "simulation":
      return `${now ? "Drawing" : "Drew"} a ${a.label}`;
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

function StepList({ steps, id }: { steps: Step[]; id?: string }) {
  return (
    <ol id={id} aria-label="What Ainsley did" className="flex flex-col gap-2">
      {steps.map((step, i) => (
        <li key={step.type === "one" ? step.item.id : step.id} className="relative">
          {/* The line joining this step's icon to the next one's, past any steps folded under it. */}
          {i < steps.length - 1 && (
            <span aria-hidden="true" className="absolute -bottom-[9px] left-3.5 top-[23px] w-px -translate-x-1/2 bg-line" />
          )}
          {step.type === "one" ? <StepRow item={step.item} /> : <SearchGroup items={step.items} />}
        </li>
      ))}
    </ol>
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
}: {
  activity: Activity[];
  /** The reply is still streaming. */
  live: boolean;
  startedAt: number;
  /** How long Ainsley worked before answering; undefined while it's still working. */
  workMs?: number;
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

  if (!steps.length) return workMs !== undefined && workMs >= MIN_SHOWN_MS ? workedLine : null;
  return (
    <div className="flex flex-col gap-2">
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
      {open && <StepList id={listId} steps={steps} />}
    </div>
  );
}
