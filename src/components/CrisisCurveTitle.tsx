// Path lockup from the Figma export (text converted to outlines) — same asset
// as the full-slide `crisis-curve.svg`, cropped to the mark.
import CRISIS_CURVE_LOGO from '../assets/logos/crisis-curve-logo.svg?url';
import copy from '../content/copy.json';

/**
 * CrisisCurveTitle — "CRISIS Curve" wordmark for the chapter intro after the charts.
 */
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
        src={CRISIS_CURVE_LOGO}
        alt={alt}
        className="hidden max-sm:block mx-auto w-[calc((100vw-40px)*0.92)] max-w-[360px] h-auto"
      />
    </>
  );
}
