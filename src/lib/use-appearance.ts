import { useLayoutEffect } from "react";
import {
  ACCENT_KEY,
  THEME_BACKGROUNDS,
  THEME_KEY,
  toAccent,
  toThemePreference,
  type AccentKey,
  type ThemePreference,
} from "./appearance";
import { readLocalText, useLocalText } from "./local-flag";
import { useMediaQuery } from "./use-media-query";

const PREFERS_LIGHT = "(prefers-color-scheme: light)";

/** The student's theme and accent (Settings → Appearance), saved on this device. */
export function useAppearance() {
  const [theme, setTheme] = useLocalText(THEME_KEY);
  const [accent, setAccent] = useLocalText(ACCENT_KEY);
  return {
    theme: toThemePreference(theme),
    accent: toAccent(accent),
    setTheme: setTheme as (value: ThemePreference) => void,
    setAccent: setAccent as (value: AccentKey) => void,
  };
}

/**
 * Keeps <html data-theme data-accent> in step with the saved preferences and, for "system", with
 * the device's light or dark mode. The pre-paint script in app/layout.tsx sets them on load; this
 * applies later changes (and re-applies them after React's development remount clears them).
 */
export function useAppearanceSync() {
  const { theme, accent } = useAppearance();
  const prefersLight = useMediaQuery(PREFERS_LIGHT, false);

  useLayoutEffect(() => {
    // Read the saved values directly: while hydrating, the hooks above still hold the defaults.
    const preference = toThemePreference(readLocalText(THEME_KEY));
    const resolved =
      preference === "system" ? (window.matchMedia(PREFERS_LIGHT).matches ? "light" : "dark") : preference;
    const chosen = toAccent(readLocalText(ACCENT_KEY));
    const root = document.documentElement;
    if (root.dataset.theme === resolved && root.dataset.accent === chosen) return;

    // Switch every color at once instead of through each element's own color transition.
    const freeze = document.createElement("style");
    freeze.textContent = "*,*::before,*::after{transition:none!important}";
    document.head.appendChild(freeze);
    root.dataset.theme = resolved;
    root.dataset.accent = chosen;
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute("content", THEME_BACKGROUNDS[resolved]);
    }
    void window.getComputedStyle(root).color;
    requestAnimationFrame(() => freeze.remove());
  }, [theme, accent, prefersLight]);
}
