import { useCallback, useSyncExternalStore } from "react";

// Per-device preferences (sidebar collapsed, sections hidden, the student's name) kept in
// localStorage. If storage is unavailable (private mode), the value lives in memory.
const memory = new Map<string, string>();
const listeners = new Map<string, Set<() => void>>();

function read(key: string) {
  const known = memory.get(key);
  if (known !== undefined) return known;
  let value = "";
  try {
    value = localStorage.getItem(key) ?? "";
  } catch {
    // Storage unavailable: start from the default.
  }
  memory.set(key, value);
  return value;
}

function write(key: string, value: string) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable; the in-memory value still works for this visit.
  }
  listeners.get(key)?.forEach((listener) => listener());
}

/** The current value of a text preference, read outside of rendering. Defaults to "". */
export function readLocalText(key: string) {
  return read(key);
}

/** A text preference shared by every component that reads the same key. Defaults to "". */
export function useLocalText(key: string): [string, (value: string) => void] {
  const subscribe = useCallback(
    (listener: () => void) => {
      const set = listeners.get(key) ?? new Set<() => void>();
      listeners.set(key, set);
      set.add(listener);
      return () => {
        set.delete(listener);
      };
    },
    [key],
  );
  const value = useSyncExternalStore(subscribe, () => read(key), () => "");
  const setValue = useCallback((next: string) => write(key, next), [key]);
  return [value, setValue];
}

/** An on/off preference shared by every component that reads the same key. Defaults to off. */
export function useLocalFlag(key: string): [boolean, (value: boolean) => void] {
  const [raw, setRaw] = useLocalText(key);
  const setValue = useCallback((next: boolean) => setRaw(next ? "1" : "0"), [setRaw]);
  return [raw === "1", setValue];
}
