import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { isMobileViewport } from './deviceBudget';
import { containFrame, PHONE_FRAME, type FittedFrame, type FrameSize } from './designFrame';

/**
 * A composition laid out at its DESIGN size and scaled to fit the screen.
 *
 * Everything inside is stated in design px — the mockup's own numbers — and the whole
 * thing is scaled by one factor, so the proportions the designer drew survive on a screen
 * that is not the mockup's shape. See the note above for why that is the only way the
 * fraction-of-the-frame parts and the fixed-px parts can agree.
 *
 * It fills its nearest positioned ancestor and measures IT, so a pinned stage stays the
 * thing that decides how big the frame is drawn.
 *
 * Off the phone it does not merely reset its size — it becomes `display: contents` and
 * leaves the layout altogether, so its children lay out as direct children of the stage,
 * exactly as they did before this wrapper existed. That is deliberate: every desktop
 * composition here is authored against its stage's own box (padding, flex centring and
 * all), and a wrapper that stayed in the tree would quietly re-parent that. The display is
 * set inline rather than by class because it has to beat whatever utility classes the
 * caller put on the frame for the phone.
 *
 * `onFit` hands the numbers to a caller that has to agree with them — the charts pass them
 * to their canvas engine so the plot and the HTML chrome share one frame.
 */
/** Layout effect on the client, plain effect during the prerender — where it would only
 *  warn that it cannot run. The markup ships in the OFF state, so there is nothing for the
 *  server to have got wrong. */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export default function FitFrame({
  design = PHONE_FRAME,
  className = '',
  onFit,
  children,
}: {
  /** The mockup this composition is drawn to. Defaults to the phone export, 402×874. */
  design?: FrameSize;
  className?: string;
  /** Called with the fit whenever it changes, and with null off the phone. */
  onFit?: (fit: FittedFrame | null) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onFit);
  cb.current = onFit;

  // Layout effect: the frame must be seated before the first paint, or the composition
  // shows for a frame at its raw design size and jumps.
  useIsoLayoutEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const fit = () => {
      const vw = host.clientWidth, vh = host.clientHeight;
      if (vw <= 0 || vh <= 0) return;
      if (isMobileViewport()) {
        const f = containFrame(vw, vh, design);
        el.style.display = '';
        el.style.width = `${design.w}px`;
        el.style.height = `${design.h}px`;
        el.style.transform = `translate(${f.x.toFixed(2)}px, ${f.y.toFixed(2)}px) scale(${f.k.toFixed(4)})`;
        el.classList.add('fit-frame--on');
        cb.current?.(f);
      } else {
        el.style.display = 'contents';
        el.style.width = '';
        el.style.height = '';
        el.style.transform = '';
        el.classList.remove('fit-frame--on');
        cb.current?.(null);
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    return () => ro.disconnect();
  }, [design]);

  // Ships OFF: until the effect runs (and always, on the desktop) the frame is not in the
  // layout at all, so the prerendered HTML is the plain composition it has always been.
  return (
    <div ref={ref} className={`fit-frame ${className}`} style={{ display: 'contents' }}>
      {children}
    </div>
  );
}
