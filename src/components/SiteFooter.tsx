import LOGO from '../assets/footer/logo-meridien.svg?raw';
import LINKEDIN from '../assets/footer/linkedin.svg?raw';
import X_ICON from '../assets/footer/x.svg?raw';

/**
 * SiteFooter — the standard Méridien studio footer (block_footer / Frame 513). A
 * three-column grid: logo + copyright + studio blurb · social icons + contact + the
 * studio/licence copy · "Back to top" + nav links. Full-bleed dark band, struve type.
 * (External link targets point at mrdn.world — adjust if the real URLs differ.)
 */
export function SiteFooter() {
  const top = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  return (
    <footer
      className="w-full bg-black text-[#767676] px-6 md:px-[64px] py-16 md:py-24"
      style={{ fontFamily: 'var(--font-struve)' }}
    >
      <div className="max-w-[1480px] mx-auto grid grid-cols-1 lg:grid-cols-[1.6fr_1.7fr_0.7fr] gap-x-[clamp(40px,5vw,80px)] gap-y-12 text-[clamp(14px,1.05vw,18px)] leading-[1.6]">
        {/* Column 1 — logo · copyright · studio blurb */}
        <div className="flex flex-col gap-y-12">
          <div className="[&>svg]:h-[68px] [&>svg]:w-auto [&>svg]:block" dangerouslySetInnerHTML={{ __html: LOGO }} />
          <div className="text-[#A5A5A5]">&copy; 2026 M&eacute;ridien Knowledge Design</div>
          <div className="text-[#E6E6E6]">
            M&eacute;ridien is an interdisciplinary studio for knowledge design. We connect dots
            across disciplines and narratives, turning complex subjects into precise immersive
            experiences. Our work combines research, editorial thinking, and data design to
            produce inspiring results.
          </div>
        </div>

        {/* Column 2 — socials · contact · licence copy */}
        <div className="flex flex-col gap-y-12">
          <div className="flex items-center gap-3">
            <a href="https://www.linkedin.com/company/mrdn" aria-label="LinkedIn" className="block w-12 h-12 opacity-90 hover:opacity-100 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: LINKEDIN }} />
            <a href="https://x.com/mrdn" aria-label="X" className="block w-12 h-12 opacity-90 hover:opacity-100 [&>svg]:w-full [&>svg]:h-full" dangerouslySetInnerHTML={{ __html: X_ICON }} />
          </div>
          <div>
            If you have questions, ideas, or a project in mind, get in touch at{' '}
            <a href="mailto:info@mrdn.world" className="text-[#E6E6E6] underline">info@mrdn.world</a>.
          </div>
          <div className="space-y-6">
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

        {/* Column 3 — back to top + nav, one aligned block */}
        <div className="flex flex-col gap-y-8 text-[#E6E6E6]">
          <button type="button" onClick={top} className="underline w-fit hover:text-white">
            Back to top &uarr;
          </button>
          <nav className="flex flex-col gap-1.5">
            <a href="https://mrdn.world/about" className="underline w-fit hover:text-white">About</a>
            <a href="https://mrdn.world/privacy" className="underline w-fit hover:text-white">Privacy Policy</a>
            <a href="https://mrdn.world/terms" className="underline w-fit hover:text-white">Terms of Use</a>
          </nav>
        </div>
      </div>
    </footer>
  );
}
