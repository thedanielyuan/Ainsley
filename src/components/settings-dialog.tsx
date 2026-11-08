"use client";

import { Check, Database, Keyboard, Paintbrush, UserRound, X, type LucideIcon } from "lucide-react";
import { Fragment, useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";
import { ACCENTS, type ThemePreference } from "@/lib/appearance";
import { useProfileName } from "@/lib/profile";
import { useAppearance } from "@/lib/use-appearance";
import { cn } from "@/lib/utils";
import { Avatar } from "./ui";

type SectionKey = "profile" | "appearance" | "shortcuts" | "data";

// Grouped like Grok's settings: a labelled list on the left, the chosen section on the right.
const SECTIONS: Array<{ group: string; items: Array<{ key: SectionKey; label: string; Icon: LucideIcon }> }> = [
  {
    group: "General",
    items: [
      { key: "profile", label: "Profile", Icon: UserRound },
      { key: "appearance", label: "Appearance", Icon: Paintbrush },
      { key: "shortcuts", label: "Shortcuts", Icon: Keyboard },
    ],
  },
  { group: "Data", items: [{ key: "data", label: "Data controls", Icon: Database }] },
];
const ITEMS = SECTIONS.flatMap((section) => section.items);

const SHORTCUTS: Array<[string, string[]]> = [
  ["New chat", ["⇧", "⌘", "O"]],
  ["Search chats", ["⌘", "K"]],
  ["Show or hide the workspace", ["⇧", "⌘", "\\"]],
  ["Send message", ["Enter"]],
  ["New line", ["Shift", "Enter"]],
];

const OUTLINE_BUTTON =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-ink/10 px-2.5 text-sm font-medium transition-colors hover:bg-ink/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

/** The student's settings, laid out like Grok's: profile, appearance, shortcuts and their data. */
export function SettingsDialog({ onDeleteAll, onClose }: { onDeleteAll: () => void; onClose: () => void }) {
  const [section, setSection] = useState<SectionKey>("profile");
  const titleId = useId();
  const headingId = useId();
  const current = ITEMS.find((item) => item.key === section) ?? ITEMS[0];

  // Escape closes Settings, unless it's answering a confirmation opened on top of it.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector('[role="alertdialog"]')) return;
      onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-scrim sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog-in relative flex h-dvh w-full flex-col overflow-hidden bg-panel text-fg sm:h-[min(640px,calc(100dvh-2rem))] sm:max-w-[1000px] sm:flex-row sm:rounded-2xl sm:border sm:border-line sm:shadow-dialog"
      >
        <h2 id={titleId} className="flex h-14 shrink-0 items-center px-4 text-base font-semibold sm:sr-only">
          Settings
        </h2>

        <nav
          aria-label="Settings sections"
          className="shrink-0 border-line max-sm:border-b sm:w-[204px] sm:overflow-y-auto sm:border-e sm:px-1 sm:pb-3 sm:pt-2"
        >
          <div className="flex gap-1 overflow-x-auto px-3 pb-2.5 [scrollbar-width:none] sm:flex-col sm:gap-0 sm:overflow-visible sm:p-0">
            {SECTIONS.map(({ group, items }) => (
              <Fragment key={group}>
                <div className="hidden px-2 pb-1 pt-3.5 text-[13px] text-subtle first:pt-1.5 sm:block">{group}</div>
                {items.map(({ key, label, Icon }) => {
                  const active = key === section;
                  return (
                    <button
                      key={key}
                      type="button"
                      autoFocus={active}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setSection(key)}
                      className={cn(
                        "flex shrink-0 items-center gap-2.5 text-fg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                        "h-9 rounded-full px-3 text-sm sm:h-8 sm:w-full sm:rounded-[10px] sm:px-2 sm:text-[15px]",
                        active ? "bg-ink/[0.08]" : "hover:bg-ink/[0.05]",
                      )}
                    >
                      <Icon className="size-4 shrink-0 text-muted" />
                      <span className="truncate">{label}</span>
                    </button>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </nav>

        <section aria-labelledby={headingId} className="flex min-h-0 min-w-0 flex-1 flex-col">
          <h3 id={headingId} className="shrink-0 px-4 pb-1 pt-4 text-[15px] font-[550] max-sm:sr-only sm:px-5 sm:pe-14 sm:pt-[22px]">
            {current.label}
          </h3>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-5">
            {section === "profile" && <ProfileSection />}
            {section === "appearance" && <AppearanceSection />}
            {section === "shortcuts" && <ShortcutsSection />}
            {section === "data" && <DataSection onDeleteAll={onDeleteAll} />}
          </div>
        </section>

        <button
          type="button"
          aria-label="Close"
          title="Close"
          onClick={onClose}
          className="absolute end-3 top-3 grid size-8 place-items-center rounded-xl text-muted transition-colors hover:bg-ink/[0.06] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 sm:end-2.5 sm:top-2.5"
        >
          <X className="size-[18px]" />
        </button>
      </div>
    </div>
  );
}

/** A setting: what it is on the left, its control on the right (below it when there's no room). */
function Row({
  title,
  description,
  leading,
  align = "center",
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  align?: "center" | "start";
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap justify-between gap-x-6 gap-y-3 py-3.5",
        align === "start" ? "items-start" : "items-center",
      )}
    >
      <div className="flex min-w-0 flex-[1_1_14rem] items-center gap-3">
        {leading}
        <div className="min-w-0">
          <div className="text-[15px] leading-6 text-fg">{title}</div>
          {description && <p className="mt-0.5 max-w-[32rem] text-sm leading-5 text-muted">{description}</p>}
        </div>
      </div>
      {children && <div className="flex shrink-0 items-center">{children}</div>}
    </div>
  );
}

function Divider() {
  return <div role="separator" className="my-2 h-px bg-line" />;
}

function ProfileSection() {
  const { name, setName, initial } = useProfileName();
  const nameId = useId();
  return (
    <Row
      leading={<Avatar initial={initial} className="size-10 text-sm" />}
      title={<label htmlFor={nameId}>Name</label>}
      description="Shown in the sidebar on this device."
    >
      <input
        id={nameId}
        value={name}
        maxLength={60}
        placeholder="Guest"
        autoComplete="name"
        onChange={(e) => setName(e.target.value)}
        className="h-9 w-56 rounded-xl border border-line bg-transparent px-3 text-sm text-fg outline-none placeholder:text-subtle"
      />
    </Row>
  );
}

const THEMES: Array<{ key: ThemePreference; label: string }> = [
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
  { key: "system", label: "System" },
];

function AppearanceSection() {
  const { theme, setTheme, accent, setAccent } = useAppearance();
  const accentLabel = accent === "white" ? "White, or black in light mode" : ACCENTS.find((a) => a.key === accent)?.label;
  return (
    <>
      <Row title="Theme" description="System follows your device’s light or dark mode." align="start">
        <div
          role="radiogroup"
          aria-label="Theme"
          className="flex gap-2.5"
          onKeyDown={(e) => moveRadio(e, THEMES.map((t) => t.key), theme, setTheme)}
        >
          {THEMES.map(({ key, label }) => {
            const selected = key === theme;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => setTheme(key)}
                className="group flex w-[98px] flex-col items-center gap-1.5 rounded-xl outline-none"
              >
                <span
                  className={cn(
                    "relative block h-16 w-full overflow-hidden rounded-[10px] transition-shadow",
                    selected
                      ? "ring-2 ring-fg/85 ring-offset-2 ring-offset-panel"
                      : "ring-1 ring-line group-hover:ring-ink/25",
                    "group-focus-visible:ring-2 group-focus-visible:ring-accent group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-panel",
                  )}
                >
                  <ThemePreview theme={key} />
                </span>
                <span className={cn("text-[13px] leading-5", selected ? "text-fg" : "text-muted")}>{label}</span>
              </button>
            );
          })}
        </div>
      </Row>
      <Divider />
      <Row title="Accent color" description={`${accentLabel}. Used for buttons, links and highlights.`}>
        <div
          role="radiogroup"
          aria-label="Accent color"
          className="flex items-center gap-1"
          onKeyDown={(e) => moveRadio(e, ACCENTS.map((a) => a.key), accent, setAccent)}
        >
          {ACCENTS.map(({ key, label, swatch, on }) => {
            const selected = key === accent;
            // The white swatch gets an outline (and a dark selection ring) so it shows on a light panel.
            const white = key === "white";
            const ring = white ? "var(--color-fg)" : swatch;
            return (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={label}
                title={label}
                tabIndex={selected ? 0 : -1}
                onClick={() => setAccent(key)}
                className="grid size-8 place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-fg/50"
              >
                <span
                  className="grid size-6 place-items-center rounded-full transition-transform hover:scale-110"
                  style={{
                    backgroundColor: swatch,
                    boxShadow: selected
                      ? `0 0 0 2px var(--color-panel), 0 0 0 4px ${ring}`
                      : white
                        ? "inset 0 0 0 1px var(--color-line)"
                        : undefined,
                  }}
                >
                  {selected && <Check className="size-3.5" strokeWidth={3} style={{ color: on }} />}
                </span>
              </button>
            );
          })}
        </div>
      </Row>
    </>
  );
}

/** Arrow keys move through a radio group, choosing as they go. */
function moveRadio<T extends string>(e: KeyboardEvent<HTMLElement>, keys: readonly T[], value: T, choose: (key: T) => void) {
  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const next = (keys.indexOf(value) + step + keys.length) % keys.length;
  choose(keys[next]);
  e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
}

// Claude's backgrounds, with the sidebar's step from the page a little stronger so it shows at this size.
const PREVIEW_COLORS = {
  light: { bg: "#ffffff", side: "#f1f1f1", line: "#e1e1e1", box: "#ffffff", edge: "#e3e3e3" },
  dark: { bg: "#191919", side: "#242424", line: "#383838", box: "#303030", edge: "#3a3a3a" },
} as const;

/** A miniature Ainsley in the given theme, with the current accent on its send button. */
function MiniApp({ colors }: { colors: (typeof PREVIEW_COLORS)[keyof typeof PREVIEW_COLORS] }) {
  return (
    <span className="absolute inset-0 flex" style={{ backgroundColor: colors.bg }}>
      <span className="flex h-full w-[27%] flex-col gap-1 px-1.5 pt-2" style={{ backgroundColor: colors.side }}>
        <span className="block h-1 w-4/5 rounded-full" style={{ backgroundColor: colors.line }} />
        <span className="block h-1 w-3/5 rounded-full" style={{ backgroundColor: colors.line }} />
        <span className="block h-1 w-2/3 rounded-full" style={{ backgroundColor: colors.line }} />
      </span>
      <span className="flex flex-1 flex-col items-center justify-center gap-1.5 px-2">
        <span className="block h-1 w-1/2 rounded-full" style={{ backgroundColor: colors.line }} />
        <span
          className="flex h-3.5 w-full items-center justify-end rounded-full border pe-0.5"
          style={{ backgroundColor: colors.box, borderColor: colors.edge }}
        >
          <span className="block size-2.5 rounded-full bg-accent" />
        </span>
      </span>
    </span>
  );
}

function ThemePreview({ theme }: { theme: ThemePreference }) {
  if (theme !== "system") return <MiniApp colors={PREVIEW_COLORS[theme]} />;
  return (
    <>
      <MiniApp colors={PREVIEW_COLORS.light} />
      <span className="absolute inset-0" style={{ clipPath: "inset(0 0 0 50%)" }}>
        <MiniApp colors={PREVIEW_COLORS.dark} />
      </span>
    </>
  );
}

function ShortcutsSection() {
  return (
    <div>
      {SHORTCUTS.map(([label, keys]) => (
        <Row key={label} title={label}>
          <span className="flex gap-1">
            {keys.map((key) => (
              <kbd
                key={key}
                className="min-w-7 rounded-lg border border-line bg-ink/[0.04] px-1.5 py-0.5 text-center font-sans text-xs leading-5 text-muted"
              >
                {key}
              </kbd>
            ))}
          </span>
        </Row>
      ))}
    </div>
  );
}

function DataSection({ onDeleteAll }: { onDeleteAll: () => void }) {
  const usage = useStorageUsage();
  return (
    <>
      <Row title="Storage" description="Your chats, courses and files are kept in this browser, on this device.">
        <span className="text-sm text-muted">{usage ?? "—"}</span>
      </Row>
      <Divider />
      <Row
        title="Delete all chats"
        description="Every conversation on this device is permanently deleted. Your courses and their materials stay."
      >
        <button type="button" onClick={onDeleteAll} className={cn(OUTLINE_BUTTON, "text-danger")}>
          Delete all
        </button>
      </Row>
    </>
  );
}

/** How much this browser is storing for Ainsley, e.g. "48.2 MB used". */
function useStorageUsage() {
  const [usage, setUsage] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    navigator.storage
      ?.estimate?.()
      .then(({ usage: bytes }) => {
        if (!cancelled && bytes !== undefined) setUsage(`${formatBytes(bytes)} used`);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return usage;
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
