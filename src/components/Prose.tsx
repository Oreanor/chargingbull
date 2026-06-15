import type { ReactNode } from 'react';

export function Prose({
  children,
  variant = 'default',
}: {
  children: ReactNode;
  variant?: 'default' | 'dark';
}) {
  return (
    <section
      className={`py-32 px-6 ${variant === 'dark' ? 'bg-gradient-to-b from-white/[0.012] to-transparent' : ''}`}
    >
      <div className="prose-inner mx-auto max-w-[720px] space-y-6 text-[clamp(15px,1.25vw,18px)] leading-[1.75] text-fg/85">
        {children}
      </div>
    </section>
  );
}

export function Break({
  numeral,
  title,
  children,
}: {
  numeral: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <section className="relative min-h-[100dvh] flex items-center justify-center px-6 py-20">
      <span className="absolute left-1/2 -translate-x-1/2 top-0 w-px h-16 bg-gradient-to-b from-transparent to-gold/45" />
      <span className="absolute left-1/2 -translate-x-1/2 bottom-0 w-px h-16 bg-gradient-to-t from-transparent to-gold/45" />
      <div className="text-center max-w-[720px]">
        <div className="font-serif italic font-semibold text-gold leading-[0.9] mb-4 text-[clamp(96px,14vw,200px)]">
          {numeral}
        </div>
        <div className="mx-auto mb-8 h-px w-14 bg-gold" />
        <h2 className="font-serif font-semibold leading-[1.05] tracking-tight mb-6 text-[clamp(36px,5vw,64px)]">
          {title}
        </h2>
        {children ? (
          <div className="font-light text-fg/70 mx-auto max-w-[560px] text-[clamp(14px,1.2vw,17px)] leading-[1.7]">
            {children}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export function Outro({
  lines,
  credit,
}: {
  lines: { text: string; emphasis?: boolean }[];
  credit?: ReactNode;
}) {
  return (
    <section className="min-h-[90dvh] flex items-center justify-center px-6 py-20">
      <div className="text-center max-w-[720px]">
        <div className="mx-auto mb-12 h-px w-14 bg-gold" />
        {lines.map((l, i) => (
          <p
            key={i}
            className={`font-serif leading-[1.15] text-[clamp(36px,5vw,64px)] ${
              l.emphasis ? 'italic text-gold mb-16' : 'text-fg/80 font-medium'
            }`}
          >
            {l.text}
          </p>
        ))}
        {credit ? (
          <div className="uppercase text-[11px] tracking-[1.6px] text-fg/55 leading-[2]">
            {credit}
          </div>
        ) : null}
      </div>
    </section>
  );
}
