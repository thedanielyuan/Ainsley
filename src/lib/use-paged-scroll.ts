import { useCallback, useLayoutEffect, useRef, useState } from "react";

/** A request to show a page; a new `seq` asks again, even for the same page. */
export interface PageJump {
  page: number;
  seq: number;
}

/** Space kept above a page when jumping to it, matching the viewers' padding. */
const TOP_MARGIN = 16;

/**
 * Scrolling through a column of pages: reports the page being read, jumps to a page on request,
 * and keeps the reader's place when the pages change size (zoom, a resized panel) or the view is
 * hidden and shown again (another tab, closing the panel), since a hidden scroller loses its spot.
 */
export function usePagedScroll({
  count,
  jump,
  layout,
  onPage,
}: {
  count: number;
  jump: PageJump;
  /**
   * Describes the pages' layout for a view width: a string that changes whenever their sizes
   * change, or null while they can't be laid out yet.
   */
  layout: (width: number) => string | null;
  onPage: (page: number, count: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pages = useRef<Array<HTMLElement | null>>([]);
  // The spot to come back to: a page and how far down it the top of the view is.
  const anchor = useRef<{ index: number; offset: number; left: number } | null>(null);
  const reported = useRef(0);
  const handled = useRef<number | null>(null);
  const frame = useRef(0);
  const onPageRef = useRef(onPage);
  const [width, setWidth] = useState(0);
  const geometry = layout(width);
  const ready = geometry !== null;

  useLayoutEffect(() => {
    onPageRef.current = onPage;
  });

  const register = useCallback((index: number, element: HTMLElement | null) => {
    pages.current[index] = element;
  }, []);

  /** The last page whose top is at or above `y` (in scroll coordinates). */
  const indexAt = useCallback(
    (y: number) => {
      let low = 0;
      let high = count - 1;
      let found = 0;
      while (low <= high) {
        const mid = (low + high) >> 1;
        const top = pages.current[mid]?.offsetTop ?? Number.POSITIVE_INFINITY;
        if (top <= y) {
          found = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      return found;
    },
    [count],
  );

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.clientWidth === 0 || count === 0) return;
    const line = el.scrollTop + TOP_MARGIN;
    const index = indexAt(line);
    const page = pages.current[index];
    if (page) {
      const spare = el.scrollWidth - el.clientWidth;
      anchor.current = {
        index,
        offset: (line - page.offsetTop) / Math.max(1, page.offsetHeight),
        left: spare > 0 ? el.scrollLeft / spare : 0.5,
      };
    }
    // The page being read is the one taking up most of the view (the last, once the student has
    // scrolled to the end).
    const top = el.scrollTop;
    const bottom = top + el.clientHeight;
    let current = indexAt(top);
    if (top > 0 && bottom >= el.scrollHeight - 2) {
      current = count - 1;
    } else {
      let most = -1;
      for (let i = current; i < count; i++) {
        const candidate = pages.current[i];
        if (!candidate || candidate.offsetTop >= bottom) break;
        const visible =
          Math.min(bottom, candidate.offsetTop + candidate.offsetHeight) - Math.max(top, candidate.offsetTop);
        if (visible > most + 1) {
          most = visible;
          current = i;
        }
      }
    }
    current += 1;
    if (current !== reported.current) {
      reported.current = current;
      onPageRef.current(current, count);
    }
  }, [count, indexAt]);

  const restore = useCallback(() => {
    const el = scrollRef.current;
    const spot = anchor.current;
    const page = spot && pages.current[spot.index];
    if (!el || !spot || !page || el.clientWidth === 0) return;
    el.scrollTop = page.offsetTop + spot.offset * page.offsetHeight - TOP_MARGIN;
    const spare = el.scrollWidth - el.clientWidth;
    if (spare > 0) el.scrollLeft = spot.left * spare;
  }, []);

  const scrollToPage = useCallback(
    (page: number) => {
      const el = scrollRef.current;
      const target = pages.current[Math.min(count, Math.max(1, page)) - 1];
      if (!el || !target) return;
      el.scrollTop = target.offsetTop - TOP_MARGIN;
      const spare = el.scrollWidth - el.clientWidth;
      if (spare > 0) el.scrollLeft = spare / 2;
      measure();
    },
    [count, measure],
  );

  const onScroll = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      measure();
    });
  }, [measure]);

  // Track the view's width. A hidden view reports zero: keep the last real width (so the pages
  // keep their layout) and put the reader back where they were once it's visible again.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let last = el.clientWidth;
    const observer = new ResizeObserver(() => {
      const next = el.clientWidth;
      if (next > 0) {
        if (last === 0) restore();
        setWidth(next);
      }
      last = next;
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [restore]);

  // New page sizes: stay on the same spot.
  useLayoutEffect(() => {
    restore();
  }, [geometry, restore]);

  // Show the requested page once the pages are laid out.
  useLayoutEffect(() => {
    if (!ready || width === 0 || handled.current === jump.seq) return;
    handled.current = jump.seq;
    scrollToPage(jump.page);
  }, [ready, width, jump.seq, jump.page, scrollToPage]);

  return { scrollRef, pages, register, onScroll, width };
}
