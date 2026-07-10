import { useEffect, useRef, type ReactNode } from 'react';

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
  titleClassName = '',
  bodyClassName = '',
}: {
  /** Plain gold cursive title text… */
  title?: string;
  /** …or a custom title node (e.g. a composite SVG logo) shown in its place. */
  titleNode?: ReactNode;
  body: string;
  /** Optional next-chapter asset warm-up; lock holds until it resolves. */
  preload?: () => Promise<unknown>;
  /** Optional Tailwind classes baked onto the title / body (position + scale). */
  titleClassName?: string;
  bodyClassName?: string;
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

  return (
    <section ref={sectionRef} className="relative h-[160vh] w-full bg-black">
      <div className="sticky top-0 h-[100dvh] flex items-center justify-center px-6">
        {/* wide enough for the desktop wordmark (1211px at the 1440px design width) */}
        <div className="text-center max-w-[1215px]">
          <div
            ref={titleRef}
            style={{ opacity: 0 }}
            /* 72px below the mark at 1440 — the Figma slide's logo→caption gap */
            className={`mb-[min(72px,5vw)] max-sm:mb-7 ${titleClassName}`}
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
          {/* Desktop type is the design's: 34px / 40px-leading (1.176) at the 1440px frame.
              max-w is in em so the caption keeps the design's line breaks at every width. */}
          <p
            ref={bodyRef}
            style={{ fontFamily: 'var(--font-struve)' }}
            className={`mx-auto text-fg max-w-[23.33em] text-[clamp(16px,2.361vw,34px)] leading-[1.176] max-sm:max-w-[480px] max-sm:text-[clamp(16px,1.5vw,20px)] max-sm:leading-[1.3] ${bodyClassName}`}
          />
        </div>
      </div>
    </section>
  );
}
