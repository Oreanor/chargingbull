import { useEffect, useRef, type ReactNode } from 'react';
import { onScroll as onPageScroll } from '../engine/scroller';
import { viewportH } from '../engine/viewport';

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
  phoneMeasure,
  phoneGap,
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
  /**
   * Phone caption measure and mark→caption gap, in px, off the slide's own frame. Per-slide
   * and so not fixable here: the two dividers that use this component are drawn to different
   * measures — 355.41 for «BEARS vs Bulls», 341.34 for «CRISIS Curve» — and the measure is
   * what decides where each caption breaks. Passed as CSS variables rather than class strings
   * because two conflicting arbitrary utilities would be resolved by Tailwind's own output
   * order, not by which one the caller handed in.
   */
  phoneMeasure?: number;
  phoneGap?: number;
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
      if (r.top <= 2 && r.bottom > viewportH() * 0.5) {
        fired = true;
        if (preload) preload().catch(() => {});
      }
    };
    const detach = onPageScroll(onScroll);
    onScroll();
    return detach;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative h-[160svh] w-full bg-black"
      style={{
        ...(phoneMeasure != null ? { '--br-measure': phoneMeasure + 'px' } : {}),
        ...(phoneGap != null ? { '--br-gap': phoneGap + 'px' } : {}),
      } as React.CSSProperties}
    >
      {/* px-5 on the phone: the design gutters are 20-23, and 24 would squeeze the fixed
          caption measure below its own width. */}
      <div className="sticky top-0 h-[100svh] flex items-center justify-center px-5 sm:px-6">
        {/* wide enough for the desktop wordmark (1211px at the 1440px design width) */}
        <div className="text-center max-w-[1215px]">
          <div
            ref={titleRef}
            style={{ opacity: 0 }}
            /* 72px below the mark at 1440 — the Figma slide's logo→caption gap. On the phone
               frame that gap is 29.5px measured INK to ink; a CSS margin joins boxes, and the
               caption's line box carries ~7px of ascent above its glyphs, so the margin that
               produces it is 22px. */
            className={`mb-[min(72px,5vw)] max-sm:mb-[var(--br-gap,22px)] ${titleClassName}`}
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
          {/* Desktop: design 34/40 @ 1440, centred block. Phone: 24/32 Struve off
              «iPhone 17 - 38» (402×874) with a 341.34 measure — the design's own ink width,
              which is what makes it break into the same three lines. Fixed, not scaled. */}
          <p
            ref={bodyRef}
            style={{ fontFamily: 'var(--font-struve)', opacity: 1 }}
            className={`mx-auto text-center text-fg max-w-[23.33em] text-[clamp(16px,2.361vw,34px)] leading-[1.176] max-sm:w-[var(--br-measure,341.34px)] max-sm:max-w-[var(--br-measure,341.34px)] max-sm:text-[24px] max-sm:leading-[32px] ${bodyClassName}`}
          >
            {body}
          </p>
        </div>
      </div>
    </section>
  );
}
