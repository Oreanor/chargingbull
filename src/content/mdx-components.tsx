import type { MDXComponents } from 'mdx/types';
import { ModelChapter, ChartsChapter, CandleIntro, StageOverlay, TonnesFrame, PartsFrame, SelfieFrame, RearFrame, MapChapter, MapBullHandoff } from '../engine';
import DatumSplat from '../components/DatumSplat';
import { Prose, Break, Outro } from '../components/Prose';
import { BreakReveal } from '../components/BreakReveal';

export const mdxComponents: MDXComponents = {
  ModelChapter,
  ChartsChapter,
  CandleIntro,
  StageOverlay,
  TonnesFrame,
  PartsFrame,
  SelfieFrame,
  RearFrame,
  MapChapter,
  MapBullHandoff,
  DatumSplat,
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
