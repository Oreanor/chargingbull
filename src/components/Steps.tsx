import { motion, useTransform } from 'motion/react';
import { Children, type ReactNode } from 'react';
import { useSlotProgress } from '../engine/useSlotProgress';

/**
 * A side rail of text steps that fade in/out as scroll progresses through the
 * parent Stage. Used for narration overlaid on a sticky visual.
 */
export default function Steps({ children }: { children: ReactNode }) {
  const steps = Children.toArray(children);
  return (
    <div className="absolute inset-y-0 right-0 w-full md:w-[42%] pointer-events-none">
      {steps.map((step, i) => (
        <Step key={i} index={i} count={steps.length}>
          {step}
        </Step>
      ))}
    </div>
  );
}

function Step({
  index,
  count,
  children,
}: {
  index: number;
  count: number;
  children: ReactNode;
}) {
  const { opacity, progress, span, center } = useSlotProgress(index, count, {
    hold: 0.25,
    fade: 0.9,
  });
  const y = useTransform(progress, [center - span, center, center + span], [24, 0, -24]);

  return (
    <motion.div
      style={{ opacity, y }}
      className="absolute inset-0 flex items-center px-6 md:px-12"
    >
      <div className="max-w-md">{children}</div>
    </motion.div>
  );
}
