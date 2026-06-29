import { useEffect, useRef, type ReactNode } from 'react';
import { tuneStore } from '../engine/tuneEditor';

/**
 * BreakReveal — a chapter divider that appears FROM DARKNESS in place (not
 * scrolling up from below): once it pins, the gold cursive title fades up, then
 * the body types out letter-by-letter (~a line per second, same feel as the
 * opener intro). Page scroll is locked during the reveal — and, if given, a
 * `preload` is kicked off so the next chapter's assets (e.g. the map) load during
 * the lull; the lock releases once both the reveal AND the preload are done.
 */

export function BreakReveal({
  title,
  titleNode,
  body,
  preload,
  tuneKey,
}: {
  /** Plain gold cursive title text… */
  title?: string;
  /** …or a custom title node (e.g. a composite SVG logo) shown in its place. */
  titleNode?: ReactNode;
  body: string;
  /** Optional next-chapter asset warm-up; lock holds until it resolves. */
  preload?: () => Promise<unknown>;
  /** When set, the title block + body become draggable via the ✎ layout editor
   *  (`<tuneKey>.title` / `<tuneKey>.body`), with offsets persisted + re-applied. */
  tuneKey?: string;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    // Text just APPEARS (typing effect removed): populate the body with line breaks
    // and show title + body. The next chapter's assets are still warmed up via
    // `preload` when this section pins (never blocks scroll).
    if (bodyRef.current) {
      const frag = document.createDocumentFragment();
      body.split('\n').forEach((line, idx) => {
        if (idx > 0) frag.appendChild(document.createElement('br'));
        frag.appendChild(document.createTextNode(line));
      });
      bodyRef.current.replaceChildren(frag);
      bodyRef.current.style.opacity = '1';
    }
    if (titleRef.current) titleRef.current.style.opacity = '1';

    let fired = false;
    const onScroll = () => {
      if (fired) return;
      const r = section.getBoundingClientRect();
      if (r.top <= 2 && r.bottom > window.innerHeight * 0.5) {
        fired = true;
        if (preload) preload().catch(() => {});
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bake the saved (or live-dragged) layout-editor offsets into the title + body
  // transforms each frame, so the ✎ editor can nudge them and the saved positions
  // also show with the editor off. (Opacity is owned by the reveal loop above.)
  useEffect(() => {
    if (!tuneKey) return;
    let raf = 0;
    const apply = (el: HTMLElement | null, id: string) => {
      if (!el) return;
      const [ox, oy] = tuneStore.get(id);
      const s = tuneStore.getScale(id);
      el.style.transform = ox || oy || s !== 1 ? `translate(${ox}vh, ${oy}vh) scale(${s})` : '';
    };
    const tick = () => {
      raf = requestAnimationFrame(tick);
      apply(titleRef.current, `${tuneKey}.title`);
      apply(bodyRef.current, `${tuneKey}.body`);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [tuneKey]);

  return (
    <section ref={sectionRef} className="relative h-[160vh] w-full bg-black">
      <div className="sticky top-0 h-[100dvh] flex items-center justify-center px-6">
        <div className="text-center max-w-[820px]">
          <div
            ref={titleRef}
            style={{ opacity: 0 }}
            className="mb-7"
            data-tune={tuneKey ? `${tuneKey}.title` : undefined}
            data-tune-mode={tuneKey ? 'store' : undefined}
          >
            {titleNode ?? (
              <span
                style={{ fontFamily: 'var(--font-ayer)', fontStyle: 'italic', fontWeight: 900, color: '#c9a961' }}
                className="block leading-[1.0] text-[clamp(52px,9vw,120px)]"
              >
                {title}
              </span>
            )}
          </div>
          <p
            ref={bodyRef}
            style={{ fontFamily: 'var(--font-struve)' }}
            className="mx-auto max-w-[480px] text-[clamp(16px,1.5vw,20px)] leading-[1.3] text-fg/80"
            data-tune={tuneKey ? `${tuneKey}.body` : undefined}
            data-tune-mode={tuneKey ? 'store' : undefined}
          />
        </div>
      </div>
    </section>
  );
}
