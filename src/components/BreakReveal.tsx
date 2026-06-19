import { useEffect, useRef, type ReactNode } from 'react';

/**
 * BreakReveal — a chapter divider that appears FROM DARKNESS in place (not
 * scrolling up from below): once it pins, the gold cursive title fades up, then
 * the body types out letter-by-letter (~a line per second, same feel as the
 * opener intro). Page scroll is locked during the reveal — and, if given, a
 * `preload` is kicked off so the next chapter's assets (e.g. the map) load during
 * the lull; the lock releases once both the reveal AND the preload are done.
 */

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);

export function BreakReveal({
  title,
  titleNode,
  body,
  preload,
}: {
  /** Plain gold cursive title text… */
  title?: string;
  /** …or a custom title node (e.g. a composite SVG logo) shown in its place. */
  titleNode?: ReactNode;
  body: string;
  /** Optional next-chapter asset warm-up; lock holds until it resolves. */
  preload?: () => Promise<unknown>;
}) {
  const sectionRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    // build body char spans (hidden), typed in the loop
    const chars: { el: HTMLSpanElement; delay: number }[] = [];
    const BODY_START = 900;
    const perChar = 1000 / 55; // ~a line (≈55 chars) per second
    if (bodyRef.current) {
      bodyRef.current.textContent = '';
      [...body].forEach((ch, i) => {
        const s = document.createElement('span');
        s.textContent = ch;
        s.style.opacity = ch === ' ' ? '1' : '0';
        bodyRef.current!.appendChild(s);
        chars.push({ el: s, delay: BODY_START + i * perChar });
      });
    }
    const REVEAL_END = BODY_START + body.length * perChar + 300;

    let triggered = false;
    let t0 = 0;
    let raf = 0;

    const loop = () => {
      const t = performance.now() - t0;
      if (titleRef.current) titleRef.current.style.opacity = clamp01(t / 600).toFixed(3);
      for (const c of chars) c.el.style.opacity = clamp01((t - c.delay) / 150).toFixed(3);
      if (t < REVEAL_END) raf = requestAnimationFrame(loop);
    };

    const trigger = () => {
      if (triggered) return;
      triggered = true;
      t0 = performance.now();
      // warm up the next chapter's assets during the reveal lull — but never block
      // scroll on it: the reader can scroll on through while it streams in back.
      if (preload) preload().catch(() => {});
      raf = requestAnimationFrame(loop);
    };

    // trigger when the section pins to the top of the viewport
    const onScroll = () => {
      if (triggered) return;
      const r = section.getBoundingClientRect();
      if (r.top <= 2 && r.bottom > window.innerHeight * 0.5) trigger();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section ref={sectionRef} className="relative h-[160vh] w-full bg-black">
      <div className="sticky top-0 h-[100dvh] flex items-center justify-center px-6">
        <div className="text-center max-w-[820px]">
          <div ref={titleRef} style={{ opacity: 0 }} className="mb-7">
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
            className="mx-auto max-w-[560px] text-[clamp(16px,1.5vw,20px)] leading-[1.55] text-fg/80"
          />
        </div>
      </div>
    </section>
  );
}
