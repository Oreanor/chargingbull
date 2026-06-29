import type { ReactNode } from 'react';
import ProgressRail from './ProgressRail';
import DevToolbar from './DevToolbar';
import { SmoothScroll } from './smoothScroll';

export default function Longread({ children }: { children: ReactNode }) {
  return (
    <>
      {/* The rail tracks the native thumb and stays viewport-fixed, so it lives
          OUTSIDE the smooth-scroll wrapper (whose transform would re-anchor it). */}
      <ProgressRail />
      {/* Dev-only opener tuning rail — also fixed, so likewise outside SmoothScroll. */}
      {import.meta.env.DEV ? <DevToolbar /> : null}
      <SmoothScroll>
        <main className="relative">{children}</main>
      </SmoothScroll>
    </>
  );
}
