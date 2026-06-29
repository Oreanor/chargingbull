import { useState } from 'react';

/**
 * Colophon — the pink closing slide (Desktop-62). Two columns: left labels
 * ("Published", "Reading list ——"), right content (the date aligned with the list,
 * a white-outlined "Copy URL", and the numbered reading list — titles italic +
 * underlined). Everything is WHITE on the pink ground. NOTE: link targets weren't in
 * the design — hrefs are placeholders ("#").
 */
type Ref = { n: string; authors: string; title: string; source: string; href: string };
const READING: Ref[] = [
  { n: '1', authors: 'Osama Jamil, AnnMarie Brennan.', title: 'Immersive heritage through Gaussian Splatting: a new visual aesthetic for reality capture', source: 'Frontiers in Computer Science, 2025.', href: '#' },
  { n: '2', authors: 'Michael Rubloff.', title: 'Gaussian Splatting at the New Yorker', source: 'Radiance Fields, 2025.', href: '#' },
  { n: '3', authors: 'Andy Gstoll.', title: 'Explore The Magical 3D Gaussian Splats Museum', source: 'Mixed Reality, 2025.', href: '#' },
  { n: '4', authors: 'AJ Chavar et al.', title: 'Pushing the Limits of Gaussian Splatting for Spatial Storytelling', source: 'The New York Times Research & Development, 2024.', href: '#' },
  { n: '', authors: 'Char Stiles.', title: 'Splat Sketches', source: 'MIT Media Lab, 2024.', href: '#' },
  { n: '5', authors: 'Stanford Lee et al.', title: '3D Gaussian Splatting: Performant 3D Scene Reconstruction at Scale', source: 'AWS Spatial Computing Blog, 2024.', href: '#' },
  { n: '6', authors: 'Guanjun Wu et al.', title: '4D Gaussian Splatting for Real-Time Dynamic Scene Rendering', source: '2024.', href: '#' },
];

function LinkIcon() {
  return (
    <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

export function Colophon() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const struve = { fontFamily: 'var(--font-struve)' };
  const serif = { fontFamily: 'var(--font-martina)' };
  const COL = 'lg:w-[300px] lg:shrink-0';
  const GAP = 'gap-x-[clamp(40px,6vw,90px)]';

  return (
    <section className="w-full min-h-[100dvh] flex flex-col justify-center bg-[#F14268] text-white px-6 md:px-[97px] py-20">
      <div className="max-w-[1246px] mx-auto text-[clamp(15px,1.4vw,24px)] leading-[1.45]">
        {/* Published | date (aligned with the list) · Copy URL */}
        <div className={`flex flex-col lg:flex-row ${GAP} gap-y-3 mb-16`}>
          <div className={COL} style={struve}>Published</div>
          <div className="flex-1 flex flex-wrap items-baseline gap-x-6 gap-y-3">
            <span className="italic" style={serif}>8 May 2026</span>
            <button
              type="button"
              onClick={copy}
              className="lg:ml-auto inline-flex items-center gap-2 rounded-[5px] border border-white/80 px-4 py-1.5 hover:bg-white hover:text-[#F14268] transition-colors"
              style={{ fontFamily: 'var(--font-grotesk)' }}
            >
              <LinkIcon /> {copied ? 'Copied!' : 'Copy URL'}
            </button>
          </div>
        </div>

        {/* Reading list —— | numbered refs */}
        <div className={`flex flex-col lg:flex-row gap-y-6 ${GAP}`}>
          <div className={`${COL} flex items-center gap-4`} style={struve}>
            <span className="whitespace-nowrap">Reading list</span>
            <span className="hidden lg:block h-px flex-1 bg-white/70" />
          </div>
          <ol className="flex-1 lg:max-w-[770px] space-y-2" style={serif}>
            {READING.map((r, i) => (
              <li key={i} className="flex gap-4">
                <span className="w-6 shrink-0 text-right tabular-nums opacity-70">{r.n ? r.n + '.' : ''}</span>
                <span>
                  {r.authors}{' '}
                  <a href={r.href} className="italic underline hover:opacity-70">{r.title}</a>. {r.source}
                </span>
              </li>
            ))}
            <li className="flex gap-4">
              <span className="w-6 shrink-0" />
              <button type="button" className="inline-flex items-center gap-1 text-black underline hover:opacity-70" style={struve}>
                Show all <span aria-hidden>&#x2198;</span>
              </button>
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}
