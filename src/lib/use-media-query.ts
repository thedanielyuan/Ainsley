"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Whether a CSS media query matches, kept in sync as the window changes. */
export function useMediaQuery(query: string, serverValue = true) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", listener);
      return () => mq.removeEventListener("change", listener);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => serverValue);
}
