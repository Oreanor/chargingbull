/**
 * SummaryBlock — the grey credits / acknowledgements band that sits BEFORE the pink
 * colophon. Two columns: an empty first column (desktop) with all copy in the SECOND
 * column, matching summary-block (3).svg (text ranges x≈619→1440 of a 1440 frame).
 *
 * Copy is verbatim from the designer's pair — summary-block (3).svg (desktop 1440×384) and
 * (4).svg (phone 402×327) — which carry the same words at different measures. What DOES
 * differ between them is stated per breakpoint below: the phone runs lighter ink and a
 * smaller size, not a scaled-down version of the wide one.
 *
 * The band used to carry another longread's credits entirely (Gezin Studio, Google Trends,
 * arXiv, a Protea flower, four personal acknowledgements) — leftovers from the template it
 * was built from, and nothing to do with the bull.
 */

/**
 * The credited names are set in Martina Plantijn ITALIC in both frames — a serif against the
 * struve body — and a point larger, so the two optical sizes match. The run includes the
 * punctuation that sits inside it (the comma between the two model credits, the full stops
 * after them): the designer styles the whole citation, not just the clickable words. Only
 * the words themselves are underlined, which is why the underline lives on the anchor and
 * the face lives on the run.
 */
const Cite = ({ children }: { children: React.ReactNode }) => (
  <span className="font-martina italic text-[17px] lg:text-[19px]">{children}</span>
);
const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a
    href={href}
    target="_blank"
    rel="noopener noreferrer"
    className="underline decoration-1 underline-offset-2 hover:text-white"
  >
    {children}
  </a>
);

export function SummaryBlock() {
  return (
    <section
      // Vertical pads from the wide frame: first baseline y≈98, last y≈290 of 384.
      // Phone gutters are the 20px its frame is laid out to (text x=20 of 402).
      className="w-full bg-[#292929] text-[#D6D6D6] lg:text-[#A5A5A5] px-5 lg:px-6 pt-[100px] pb-[96px]"
      style={{ fontFamily: 'var(--font-struve)' }}
    >
      {/* Same editorial grid as FutureSlide / BullBearExplainer — container / spacer width /
          gap / main measure match so the copy column lands on the shared vertical. */}
      <div className="max-w-[1160px] mx-auto flex flex-col lg:flex-row lg:items-start gap-y-10 gap-x-[clamp(40px,8vw,130px)]">
        {/* empty first column (desktop only) — copy lives in the second column */}
        <div className="hidden lg:block lg:w-[348px] lg:shrink-0" aria-hidden />
        {/* 16/19 on the phone frame, 18/24 on the wide one */}
        <div className="lg:flex-1 lg:max-w-[760px] text-[16px] leading-[1.1875] lg:text-[18px] lg:leading-[1.333] space-y-6">
          <p>
            <b className="font-semibold">Credits</b>: Research, editing, design,
            illustrations, visualisations and layout by M&eacute;ridien.
            3D&nbsp;Gaussian splatting scene, technical consultation and production support
            by Datum. Data sources: Yahoo Finance, Robert J. Shiller (Yale University). Map
            engine: Mapbox. Bull and taxi 3D models:{' '}
            <Cite>
              <A href="https://www.turbosquid.com/FullPreview/2261846">3d_molier International</A>,{' '}
              <A href="https://www.turbosquid.com/3d-models/ny-checker-cab-645138">telsem</A>.
            </Cite>{' '}
            Archival photo:{' '}
            <Cite>
              <A href="https://arturodimodica.com">arturodimodica.com</A>.
            </Cite>
          </p>
          <p>
            <b className="font-semibold">Acknowledgements</b>: We would like to thank Datum
            for their collaboration on this project and for providing the technology behind
            the immersive 3D&nbsp;Gaussian splatting experience.
          </p>
        </div>
      </div>
    </section>
  );
}
