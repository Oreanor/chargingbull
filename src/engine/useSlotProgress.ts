import { useTransform } from 'motion/react';
import { useStageProgress } from './Stage';

type SlotOptions = {
  /**
   * Half-width of the fully-visible plateau, in units of the slot's span.
   * 0.5 = fully visible across half the slot. Default: 0.5.
   */
  hold?: number;
  /**
   * Half-width of the fade zone where opacity ramps 0↔1, in units of span.
   * 1 = fade reaches the centre of the neighbouring slot (full crossfade).
   * Larger = more overlap with neighbours, smaller = harder cuts. Default: 1.
   */
  fade?: number;
};

/**
 * Maps the parent `<Stage>`'s scrollYProgress into per-slot motion values for
 * the `index`-th of `count` equally-spaced slots. Returns the opacity ramp
 * plus the raw `progress` MotionValue, slot `span` and `center` so consumers
 * can build their own derived transforms (e.g. a y-translate).
 *
 * Must be used inside a `<Stage>`.
 */
export function useSlotProgress(
  index: number,
  count: number,
  { hold = 0.5, fade = 1 }: SlotOptions = {},
) {
  const progress = useStageProgress();
  const span = 1 / count;
  const center = span * (index + 0.5);

  const opacity = useTransform(
    progress,
    [center - fade * span, center - hold * span, center + hold * span, center + fade * span],
    [0, 1, 1, 0],
  );

  return { progress, span, center, opacity };
}
