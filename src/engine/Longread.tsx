import type { ReactNode } from 'react';
import ProgressRail from './ProgressRail';
import { SmoothScroll } from './smoothScroll';

export default function Longread({ children }: { children: ReactNode }) {
  return (
    <>
      {/* The rail tracks the native thumb and stays viewport-fixed, so it lives
          OUTSIDE the smooth-scroll wrapper (whose transform would re-anchor it). */}
      <ProgressRail />
      <SmoothScroll>
        <main className="relative">{children}</main>
      </SmoothScroll>
    </>
  );
}
