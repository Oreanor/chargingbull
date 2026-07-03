/**
 * SummaryBlock — the grey credits / acknowledgements band that sits BEFORE the pink
 * colophon. Two columns: an empty first column (desktop) with all copy in the SECOND
 * column, matching summary-block (1).svg (text ranges x≈619→1440 of a 1440 frame). Copy
 * and links are taken verbatim from that design. Dark band, struve type, #A5A5A5 ink.
 */
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
      className="w-full bg-[#292929] text-[#A5A5A5] px-6 md:px-[97px] py-16"
      style={{ fontFamily: 'var(--font-struve)' }}
    >
      <div className="max-w-[1246px] mx-auto flex">
        {/* empty first column (desktop only) — copy lives in the second column */}
        <div className="hidden lg:block lg:w-[42%] shrink-0" aria-hidden />
        <div className="flex-1 text-[clamp(14px,1.1vw,18px)] leading-[1.55] space-y-6">
          <p>
            <b className="font-semibold">Credits</b>: Research, editing, design,
            illustrations, visualisations and layout by M&eacute;ridien. 3D Gaussian
            splatting scene, technical consultation and production support by{' '}
            <A href="https://www.thedatum.ai/">Datum</A>. Video, photography, shooting
            coordination and test scenes by <A href="https://gezinstudio.com/">Gezin Studio</A>.
            Data sources include Google Trends and arXiv. Additional sources include Frontiers
            in Computer Science, MIT Media Lab, Radiance Fields, The New York Times Research
            &amp; Development, Mixed Reality and AWS Spatial Computing Blog.
          </p>
          <p>
            <b className="font-semibold">Acknowledgements</b>: We would like to thank Datum
            for their collaboration on this project and for providing the technology behind the
            immersive 3D Gaussian splatting experience. We are also grateful to{' '}
            <A href="https://www.linkedin.com/in/christoph-schindelar-79515351/">Christoph Schindelar</A>,{' '}
            <A href="https://ryanfellers.com/">Ryan Fellers</A>,{' '}
            <A href="https://danybittel.ch/">Dany Bittel</A> and{' '}
            <A href="https://vincentwoo.com/">Vincent Woo</A> for sharing their insights with us
            and allowing us to study their Gaussian splatting scenes. The work of digital artist
            and 3D designer <A href="https://andreaphilippon.com/">Andr&eacute;a Philippon</A>{' '}
            inspired the Protea flower visual.
          </p>
        </div>
      </div>
    </section>
  );
}
