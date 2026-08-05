import { useState } from 'react';

/**
 * Colophon — the pink closing slide. Two columns: left labels ("Published",
 * "Reading list ——"), right content (the date, a white-outlined "Copy URL", and the
 * numbered reading list — authors bold, titles italic + underlined and carrying the
 * link, source regular). Everything WHITE on the pink ground; only the collapse
 * control is near-black.
 *
 * Sizes are baked per breakpoint off four frames — open «Desktop - 62» (1440×1247) /
 * «iPhone 16 - 15» (402×1794) and collapsed «Desktop - 64» (958) / «iPhone 16 - 16» (897) —
 * which share one rhythm: Martina 24 on a 32px line, uniform from the first entry through
 * the collapse control, with NO extra gap between entries.
 *
 * COLLAPSED is a HEIGHT, not a number of entries. The collapsed frames cut the list in the
 * MIDDLE of a reference — desktop through ref 7's first line, phone through ref 4's last —
 * which is the whole point of the state: a clean cut on an entry boundary reads as a short
 * complete list and gives the reader no reason to press "Show all". Cutting mid-sentence
 * says there is more. The lengths are the frames' own: 13 line-steps of the list on desktop
 * (baselines 368→752), 19 on the phone (204→780).
 */
type Ref = { n: string; authors: string; title: string; source: string; href: string };

/** Numbered in the design; entry 4 carries a second, unnumbered reference (n: ''). */
const READING: Ref[] = [
  { n: '1', authors: 'George Lee, Lucas Greenbaum.', title: 'Tracking trillions: The assumptions shaping the scale of the AI build-out', source: 'Goldman Sachs, 2026', href: 'https://www.goldmansachs.com/insights/articles/tracking-trillions-the-assumptions-shaping-scale-of-the-ai-build-out' },
  { n: '2', authors: 'James Ramsay, Emily Nadal.', title: 'Why do so many people want to touch the Wall Street bull’s testicles?', source: 'Gothamist, 2025', href: 'https://gothamist.com/arts-entertainment/why-do-so-many-people-want-to-touch-the-wall-street-bulls-testicles' },
  { n: '3', authors: 'Lewis Krauskopf.', title: 'Wall Street’s bull market nears three years old; history shows it may still have life', source: 'Reuters, 2025', href: 'https://www.reuters.com/business/wall-streets-bull-market-nears-three-years-old-history-shows-it-may-still-have-2025-10-09/' },
  { n: '4', authors: 'David Randall.', title: 'Whispers of S&P 500 bear market grow louder as U.S. stock decline continues', source: 'Reuters, 2022', href: 'https://www.reuters.com/business/whispers-sp-500-bear-market-grow-louder-us-stock-decline-continues-2022-05-09/' },
  { n: '', authors: '', title: 'The Dotcom Bubble Burst', source: 'International Banker, 2021', href: 'https://internationalbanker.com/history-of-financial-crises/the-dotcom-bubble-burst-2000/' },
  { n: '5', authors: 'Anthony Haden Guest.', title: 'Birth of the Bull', source: 'arturodimodica.com, 2021', href: 'https://arturodimodica.com/works/charging-bull/' },
  { n: '6', authors: 'Anthony Haden-Guest.', title: 'Arturo di Modica: Charging Bull', source: 'Phillips Auctioneers, 2018', href: 'https://www.phillips.com/article/37187333/arturo-di-modica-charging-bull' },
  { n: '7', authors: 'Dean Balsamini.', title: 'Prototype of Wall Street bull statue sells for $37K at auction', source: 'New York Post, 2017', href: 'https://nypost.com/2017/12/09/prototype-of-wall-street-bull-statue-sells-for-37k-at-auction/' },
  { n: '8', authors: 'Tao Tao Holmes.', title: 'Tourists love to rub the bronze balls of Wall Street’s Charging Bull statue', source: 'Atlas Obscura, 2016', href: 'https://www.atlasobscura.com/articles/tourists-love-to-rub-the-bronze-balls-of-wall-streets-charging-bull-statue-why' },
  { n: '9', authors: 'Daniel B. Schneider.', title: 'Bulls and Bears of Yore', source: 'The New York Times, 1997', href: 'https://www.nytimes.com/1997/11/30/nyregion/fyi-328278.html' },
  { n: '10', authors: 'Associated Press.', title: 'Wall St.’s bronze bull moves 2 blocks south', source: 'The New York Times, 1989', href: 'https://www.nytimes.com/1989/12/20/nyregion/wall-st-s-bronze-bull-moves-2-blocks-south.html' },
  { n: '11', authors: 'Robert D. McFadden.', title: 'SoHo gift to Wall St.: A 3 1/2-ton bronze bull', source: 'The New York Times, 1989', href: 'https://www.nytimes.com/1989/12/16/nyregion/soho-gift-to-wall-st-a-3-1-2-ton-bronze-bull.html' },
];

/**
 * Collapsed length — the frames' own line counts: 19 lines on the phone, 13 on desktop.
 * A line CLAMP, not a max-height: the clamp is the one mechanism that both stops the list
 * at the frame's line and sets the ellipsis inline, at the end of that line, where a cut
 * mid-sentence needs it. A height clip can only put it on a line of its own.
 */
const COLLAPSED = 'line-clamp-[19] lg:line-clamp-[13]';

function LinkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="block h-[13.26px] w-[13.26px] shrink-0 lg:h-5 lg:w-5" aria-hidden>
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

export function Colophon() {
  const [copied, setCopied] = useState(false);
  // Collapsed first — «Show all» is the frame the reader lands on.
  const [open, setOpen] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(window.location.href).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const struve = { fontFamily: 'var(--font-struve)', fontWeight: 700 };
  const serif = { fontFamily: 'var(--font-martina)' };

  return (
    /* Frame paddings, not a centred flex box: on the phone the list is twice the
       viewport tall, so there is nothing to centre. 46/175 top off the Copy-URL rect,
       78/165 bottom off the collapse control's line box. */
    <section className="w-full min-h-[100svh] bg-[#F14268] text-white px-5 lg:px-[149px] pt-[46px] pb-[78px] lg:pt-[175px] lg:pb-[165px]">
      {/* One type spec for the whole slide: 24px on a 32px line, +0.01em. The desktop
          frame drops the tracking on the two Struve labels only. */}
      <div className="max-w-[1142px] mx-auto text-[24px] leading-[32px] tracking-[0.01em]">
        {/* Published | date · Copy URL. The button is the row's tallest item, so on desktop
            its 55px sets the row height and baseline alignment seats the label against it;
            on the phone it lifts out to the top-right corner and the label+date stack tightens
            to a 28px step (the frame's, closer than the list's 32). */}
        <div className="relative lg:flex lg:items-baseline mb-[36px] lg:mb-[113px]">
          <div className="max-lg:pt-[3px] leading-[28px] lg:leading-[32px] lg:flex lg:items-baseline lg:flex-1">
            <span className="block lg:w-[406px] lg:shrink-0 lg:tracking-normal" style={struve}>Published</span>
            <span className="block italic lg:tracking-[0.02em]" style={serif}>8 May 2026</span>
          </div>
          <button
            type="button"
            onClick={copy}
            className="absolute right-0 top-0 lg:static lg:ml-auto flex items-center justify-center gap-[5px] lg:gap-[6px] h-[35px] w-[120px] rounded-[7.5px] lg:h-[55px] lg:w-[188px] lg:rounded-[9.5px] border border-white shrink-0 hover:bg-white hover:text-[#F14268] transition-colors"
            style={{ fontFamily: 'var(--font-grotesk)', fontSize: '15px', lineHeight: 1 }}
          >
            <LinkIcon />
            <span className="lg:text-[24px]">{copied ? 'Copied!' : 'Copy URL'}</span>
          </button>
        </div>

        {/* Reading list —— | numbered refs. Desktop: one row, the label column 348 wide so the
            number gutter right-aligns at 532 and the text starts at 567. Phone: stacked, the
            rule is not drawn, and the numbers right-align at 51 with the text at 63. */}
        <div className="lg:flex">
          <div className="flex items-baseline gap-[33px] mb-[7px] lg:mb-0 lg:w-[348px] lg:shrink-0" style={struve}>
            <span className="whitespace-nowrap lg:tracking-normal">Reading list</span>
            {/* Baseline-aligned, and an empty flex item takes its baseline from its bottom
                BORDER edge — a bottom margin moves nothing — so the offset is positional. */}
            <span className="hidden lg:block relative top-[-7.5px] h-px w-[150px] bg-white" />
          </div>
          {/* The frame's measures — 312 on the phone, 723 on desktop — are the TEXT width, so
              the number gutter and its gap sit outside them and the list's own box is
              gutter + gap + measure. Desktop fills the column exactly (794 = content box less
              the label column); the phone frame's box stops 7px short of the gutter, and that
              is what reproduces its line breaks — 362 wraps ref 3 a line early. */}
          <div className="w-[355px] max-w-full lg:w-auto lg:flex-1">
            {/* Every reference is always in the DOM — collapsing only clips the column, so the
                reader (and find-in-page, and a screen reader) still has the whole list. */}
            <ol className={open ? undefined : COLLAPSED} style={serif}>
              {READING.map((r, i) => (
                /* Hanging indent, not a flex row: the number has to sit in the same inline
                   flow as the text for the clamp to count lines through it — and it still
                   right-aligns in the gutter, because an inline-block of the gutter's width
                   aligns its own content. */
                <li key={i} className="pl-[43px] -indent-[43px] lg:pl-[70px] lg:-indent-[70px]">
                  <span className="inline-block w-[31px] lg:w-[35px] mr-[12px] lg:mr-[35px] text-right indent-0">{r.n ? r.n + '.' : ''}</span>
                  {r.authors ? <><span className="font-bold">{r.authors}</span>{' '}</> : null}
                  {/* The full stop after the title belongs to the citation, not the title —
                      ref 2 already ends in a question mark and the frames print «testicles?
                      Gothamist», not «testicles?.». */}
                  <a href={r.href} target="_blank" rel="noreferrer" className="italic underline hover:opacity-70">{r.title}</a>
                  {/[.?!]$/.test(r.title) ? '' : '.'} {r.source}
                </li>
              ))}
            </ol>
            {/* Next line in the same 32px rhythm, but a smaller face — the 2px pad puts its
                baseline back on the grid the 24px lines set. Outside the <ol>: it is the one
                thing the collapse must never clip. */}
            <div className="flex gap-x-[12px] lg:gap-x-[35px] pt-[2px]">
              <span className="w-[31px] lg:w-[35px] shrink-0" />
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="inline-flex items-baseline text-[16px] lg:text-[18px] text-[#292929] hover:opacity-70"
                style={{ fontFamily: 'var(--font-grotesk)' }}
              >
                <span className="underline">{open ? 'Collapse' : 'Show all'}</span>
                <span aria-hidden>{open ? '↗' : '↘'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
