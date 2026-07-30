// Path lockups from the Figma exports (text converted to outlines). TWO of them, because the
// mark is not one arrangement scaled: the wide frame sets «CRISIS» and the cursive «Curve»
// side by side (1180×448, ratio 2.63), the phone frame stacks them with the cursive
// overlapping from below (313×320, near-square). Scaling the wide one down to a phone would
// have given a strip a fifth of the height the design asks for.
import CRISIS_CURVE_LOGO from '../assets/logos/crisis-curve-logo.svg?url';
import CRISIS_CURVE_LOGO_PORTRAIT from '../assets/logos/crisis-curve-logo-mobile.svg?url';
import copy from '../content/copy.json';

/**
 * CrisisCurveTitle — "CRISIS Curve" wordmark for the chapter intro after the charts.
 *
 * Phone geometry is 1:1 off «iPhone 17 - 38» (402×874): the lockup's ink is 313.28 wide, and
 * the asset's viewBox is cropped to exactly that ink, so the drawn width IS the design width
 * with no padding to discount. Fixed, not fluid — the design gives one size (see the card
 * spec in fonts.css for the same call).
 */
const PORTRAIT_LOCKUP_W = 313.28;

export function CrisisCurveTitle() {
  const alt = copy.crisisCurve.alt;
  return (
    <>
      <img
        src={CRISIS_CURVE_LOGO}
        alt={alt}
        className="max-sm:hidden mx-auto w-[min(1100px,76vw)] h-auto"
      />
      <img
        src={CRISIS_CURVE_LOGO_PORTRAIT}
        alt={alt}
        className="hidden max-sm:block mx-auto h-auto"
        style={{ width: `${PORTRAIT_LOCKUP_W}px` }}
      />
    </>
  );
}
