import { BreakReveal } from './BreakReveal';
import { CrisisCurveTitle } from './CrisisCurveTitle';
import copy from '../content/copy.json';

/**
 * AnatomyCrisis — intro slide after the charts ("CRISIS Curve" + caption).
 * Same sticky BreakReveal pattern as Bears vs Bulls.
 */
export function AnatomyCrisis() {
  return (
    <div className="relative z-30">
      {/* Phone measure + mark→caption gap off «iPhone 17 - 38» (402×874). */}
      <BreakReveal
        titleNode={<CrisisCurveTitle />}
        body={copy.crisisCurve.body}
        phoneMeasure={341.34}
        phoneGap={22}
      />
    </div>
  );
}
