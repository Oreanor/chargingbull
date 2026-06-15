import { type ReactNode } from 'react';
import { useInViewMount } from './useInViewMount';

/**
 * Wraps a heavy child (3D scene, splat viewer, video, map) and mounts it only
 * when the user is close to scrolling it into view. Tears the child down once
 * the user has scrolled past — so e.g. the Datum SDK gets a real dispose().
 *
 * The host element must occupy real layout space (set `height`/`minHeight`)
 * so it can intersect the viewport while empty.
 */
export default function HeavyBlock({
  children,
  className = '',
  style,
  mountMargin = 1,
  unmountMargin = 1.5,
  mountDelay = 150,
  fallback = null,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  mountMargin?: number;
  unmountMargin?: number;
  /** Dwell (ms) in the mount zone before mounting — a fast flick-through skips
   *  the heavy child and its download entirely. Default: 150. */
  mountDelay?: number;
  fallback?: ReactNode;
}) {
  const { ref, mounted } = useInViewMount<HTMLDivElement>({ mountMargin, unmountMargin, mountDelay });

  return (
    <div ref={ref} className={className} style={style}>
      {mounted ? children : fallback}
    </div>
  );
}
