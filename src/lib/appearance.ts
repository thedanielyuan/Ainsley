// Theme and accent preferences. Shared by the root layout's pre-paint script (server) and the
// Settings dialog (client), so this module has no React or browser-only imports.

export type ThemePreference = "light" | "dark" | "system";

export const THEME_KEY = "ainsley:theme";
export const ACCENT_KEY = "ainsley:accent";
export const DEFAULT_THEME: ThemePreference = "dark";

/** The accents a student can pick. Their colors live in globals.css under [data-accent]. */
export const ACCENTS = [
  { key: "purple", label: "Purple", swatch: "#8b5cf6", on: "#ffffff" },
  { key: "blue", label: "Blue", swatch: "#3b82f6", on: "#ffffff" },
  { key: "green", label: "Green", swatch: "#16a34a", on: "#ffffff" },
  { key: "yellow", label: "Yellow", swatch: "#eab308", on: "#1a1400" },
  { key: "orange", label: "Orange", swatch: "#ea580c", on: "#ffffff" },
  { key: "pink", label: "Pink", swatch: "#ec4899", on: "#ffffff" },
  // Black in light mode, where white wouldn't show (see globals.css).
  { key: "white", label: "White", swatch: "#ffffff", on: "#0d0d0d" },
] as const;

export type AccentKey = (typeof ACCENTS)[number]["key"];
export const DEFAULT_ACCENT: AccentKey = "purple";

/** The page background for each theme, for the browser's theme-color. */
export const THEME_BACKGROUNDS = { dark: "#191919", light: "#ffffff" } as const;

export function toThemePreference(value: string | null | undefined): ThemePreference {
  return value === "light" || value === "dark" || value === "system" ? value : DEFAULT_THEME;
}

export function toAccent(value: string | null | undefined): AccentKey {
  return ACCENTS.find((accent) => accent.key === value)?.key ?? DEFAULT_ACCENT;
}

/**
 * Runs in <head> before the first paint: applies the saved theme ("system" follows the device)
 * and accent to <html>, so a light-mode student never sees a flash of the dark default.
 */
export const APPEARANCE_SCRIPT = `(function(){try{var d=document.documentElement,t=localStorage.getItem(${JSON.stringify(
  THEME_KEY,
)})||${JSON.stringify(DEFAULT_THEME)},a=localStorage.getItem(${JSON.stringify(
  ACCENT_KEY,
)});if(t==="system")t=window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";d.setAttribute("data-theme",t==="light"?"light":"dark");if(${JSON.stringify(
  ACCENTS.map((accent) => accent.key),
)}.indexOf(a)>=0)d.setAttribute("data-accent",a)}catch(e){}})()`;
