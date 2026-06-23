import type { MDXComponents } from 'mdx/types';
import { Stage, HeavyBlock, IframeChapter, ModelChapter, ChartsChapter, CandleIntro, StageOverlay, MapChapter, SplatHandoff, MapBullHandoff } from '../engine';
import ImageCrossfade from '../components/ImageCrossfade';
import Steps from '../components/Steps';
import FakeSplat from '../components/FakeSplat';
import DatumSplat from '../components/DatumSplat';
import BullViewer from '../components/BullViewer';
import { Prose, Break, Outro } from '../components/Prose';
import { BreakReveal } from '../components/BreakReveal';

export const mdxComponents: MDXComponents = {
  Stage,
  HeavyBlock,
  IframeChapter,
  ModelChapter,
  ChartsChapter,
  CandleIntro,
  StageOverlay,
  MapChapter,
  SplatHandoff,
  MapBullHandoff,
  ImageCrossfade,
  Steps,
  FakeSplat,
  DatumSplat,
  BullViewer,
  Prose,
  Break,
  BreakReveal,
  Outro,
  h1: (props) => (
    <h1
      className="font-struve font-bold leading-[1.0] tracking-tight text-[clamp(40px,6vw,72px)] mb-6"
      {...props}
    />
  ),
  h2: (props) => (
    <h2 className="font-struve font-bold text-[clamp(28px,3.5vw,42px)] mb-6" {...props} />
  ),
  p: (props) => <p {...props} />,
  em: (props) => <em className="italic text-accent font-normal" {...props} />,
  strong: (props) => <strong className="font-semibold text-fg" {...props} />,
};
