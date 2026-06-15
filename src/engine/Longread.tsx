import type { ReactNode } from 'react';
import ProgressRail from './ProgressRail';

export default function Longread({ children }: { children: ReactNode }) {
  return (
    <>
      <ProgressRail />
      <main className="relative">{children}</main>
    </>
  );
}
