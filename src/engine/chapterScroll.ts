import { createContext, useContext } from 'react';
import type { MotionValue } from 'motion/react';

/**
 * Shared scroll progress for a chapter section. A chapter backbone (ModelChapter)
 * publishes its 0..1 scrollYProgress here; overlay layers rendered as its children
 * (candles, stage texts/annotations) read it via useChapterProgress() and drive
 * themselves off the SAME progress — so every chapter follows one rule: one scroll
 * region, one progress, layers composited on top.
 */
export const ChapterScrollContext = createContext<MotionValue<number> | null>(null);

/** The enclosing chapter's scroll progress (0..1), or null if used standalone. */
export const useChapterProgress = () => useContext(ChapterScrollContext);
