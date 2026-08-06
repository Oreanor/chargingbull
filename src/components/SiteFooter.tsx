import { scrollToPos } from '../engine/scroller';
import LINKEDIN from '../assets/footer/linkedin.svg?raw';
import X_ICON from '../assets/footer/x.svg?raw';

/**
 * SiteFooter — the standard Méridien studio footer (block_footer / Frame 513). A
 * three-column grid: logo + copyright + studio blurb · social icons + contact + the
 * studio/licence copy · "Back to top" + nav links. Full-bleed dark band, struve type.
 * (External link targets point at mrdn.world — adjust if the real URLs differ.)
 */
export function SiteFooter() {
  const top = () => scrollToPos(0, true);
  // Social icons — reused in two spots: next to the © on MOBILE (mockup block_footer)
  // and in column 2 on DESKTOP. Defined once so the markup isn't duplicated.
  const socials = (
    <>
      <a href="https://www.linkedin.com/company/mrdn" aria-label="LinkedIn" className="block w-12 h-12 opacity-90 hover:opacity-100 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: LINKEDIN }} />
      <a href="https://x.com/mrdn" aria-label="X" className="block w-12 h-12 opacity-90 hover:opacity-100 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: X_ICON }} />
    </>
  );
  return (
    <footer
      className="relative w-full min-h-[100svh] flex flex-col justify-center bg-black text-[#767676] px-8 lg:pl-[46px] lg:pr-[64px] py-16 md:py-24"
      style={{ fontFamily: 'var(--font-struve)' }}
    >
      {/* Méridien mark — desktop only. On mobile the logo disappears (per the mockup), and
          the corner-anchored mark would overlap the stacked content anyway. */}
      <img
        src="/brand/meridian-logo-green.svg"
        alt="Méridien"
        className="hidden lg:block absolute left-[46px] top-[36px] h-[68px] w-auto"
      />
      {/* Mobile = a single fluid column reordered via `order-*` (the three column wrappers
          become display:contents so their children flow into this flex directly); desktop =
          the original 3-column grid, wrappers back to flex-col cells. Left-aligned (no
          mx-auto) so column 1 lines up on the SAME vertical as the logo. */}
      <div className="max-w-[1480px] flex flex-col gap-y-10 lg:grid lg:grid-cols-[1.6fr_1.7fr_0.7fr] lg:gap-x-[clamp(40px,5vw,80px)] lg:gap-y-12 text-[clamp(15px,1.05vw,18px)] leading-[1.6]">
        {/* Column 1 — copyright (+ socials on mobile) · studio blurb */}
        <div className="contents lg:flex lg:flex-col lg:gap-y-12">
          {/* © — on mobile shares a row with the socials (© left, icons right) */}
          <div className="order-2 lg:order-none flex items-center justify-between gap-6">
            <div className="text-[#A5A5A5]">&copy; 2026 M&eacute;ridien Knowledge Design</div>
            <div className="flex lg:hidden items-center gap-3 shrink-0">{socials}</div>
          </div>
          <div className="order-3 lg:order-none text-[#E6E6E6]">
            M&eacute;ridien is an interdisciplinary studio for knowledge design. We connect dots
            across disciplines and narratives, turning complex subjects into precise immersive
            experiences. Our work combines research, editorial thinking, and data design to
            produce inspiring results.
          </div>
        </div>

        {/* Column 2 — socials (desktop) · contact · licence copy */}
        <div className="contents lg:flex lg:flex-col lg:gap-y-12">
          <div className="hidden lg:flex items-center gap-3">{socials}</div>
          <div className="order-4 lg:order-none">
            If you have questions, ideas, or a project in mind, get in touch at{' '}
            <a href="mailto:info@mrdn.world" className="text-[#E6E6E6] underline">info@mrdn.world</a>.
          </div>
          <div className="order-5 lg:order-none space-y-6">
            <p>
              Our team of researchers, editors, designers, data journalists, and engineers
              develops immersive media formats and challenges the ways knowledge is presented.
              We are eager to push the boundaries of reading experience using data analysis,
              infographics, interactive maps, 3D reconstructions, and Gaussian-splatting scenes.
            </p>
            <p>
              All photos and videos used in this project remain the property of their respective
              authors and may not be used without permission. Committed to free access to
              information, M&eacute;ridien shares some of its materials under the Creative Commons
              Attribution&ndash;NonCommercial 4.0 International (CC BY-NC 4.0) licence. Content
              created and marked as &ldquo;CC&rdquo; is covered by this licence: anyone can use it
              for non-commercial purposes with credit to M&eacute;ridien.
            </p>
          </div>
        </div>

        {/* Column 3 — back to top (first on mobile) + nav (last on mobile) */}
        <div className="contents lg:flex lg:flex-col lg:gap-y-8 lg:text-[#E6E6E6]">
          <button type="button" onClick={top} className="order-1 lg:order-none underline w-fit text-[#E6E6E6] hover:text-white">
            Back to top &uarr;
          </button>
          <nav className="order-6 lg:order-none flex flex-col gap-1.5 text-[#E6E6E6]">
            <a href="https://mrdn.world/about" className="underline w-fit hover:text-white">About</a>
            <a href="https://mrdn.world/privacy" className="underline w-fit hover:text-white">Privacy Policy</a>
            <a href="https://mrdn.world/terms" className="underline w-fit hover:text-white">Terms of Use</a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
