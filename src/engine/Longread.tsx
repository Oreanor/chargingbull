import { useEffect, useRef, type ReactNode } from 'react';
import ProgressRail from './ProgressRail';
import DevToolbar from './DevToolbar';
import { SmoothScroll } from './smoothScroll';
import { SCROLLER_ID } from './scroller';

export default function Longread({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // The document is not scrollable, so nothing would answer the arrow keys, space or
  // PageDown until the box that IS scrollable holds focus. Focused without scrolling
  // the (already-at-top) box, and it takes no outline — see #lr-scroll in index.css.
  useEffect(() => {
    scrollRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <>
      {/* The rail and the dev rail are viewport-fixed and read the scroll box rather
          than living in it, so they stay outside the scrolling content. */}
      <ProgressRail />
      {import.meta.env.DEV ? <DevToolbar /> : null}
      {/* THE page scroller — see engine/scroller.ts. */}
      <div id={SCROLLER_ID} ref={scrollRef} tabIndex={-1}>
        <SmoothScroll>
          <main className="relative">{children}</main>
        </SmoothScroll>
      </div>
    </>
  );
}
