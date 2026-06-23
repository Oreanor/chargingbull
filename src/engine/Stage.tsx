import { createContext, useContext, useRef, type ReactNode } from 'react';
import { type MotionValue } from 'motion/react';
import { useSmoothProgress } from './smoothScroll';

const StageProgressContext = createContext<MotionValue<number> | null>(null);

// Lives with <Stage> (its context provider); the fast-refresh hint is dev-only.
// eslint-disable-next-line react-refresh/only-export-components
export function useStageProgress(): MotionValue<number> {
  const v = useContext(StageProgressContext);
  if (!v) throw new Error('useStageProgress must be used inside <Stage>');
  return v;
}

export default function Stage({
  stages = 2,
  children,
  className = '',
}: {
  stages?: number;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollYProgress = useSmoothProgress(ref);

  return (
    <section
      ref={ref}
      style={{ height: `${stages * 100}dvh` }}
      className={`relative w-full ${className}`}
    >
      <div className="sticky top-0 h-[100dvh] w-full overflow-hidden">
        <StageProgressContext.Provider value={scrollYProgress}>
          {children}
        </StageProgressContext.Provider>
      </div>
    </section>
  );
}
