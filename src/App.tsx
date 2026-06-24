import Longread from './engine/Longread';
import ChargingBull from './content/charging-bull.mdx';
import { mdxComponents } from './content/mdx-components';
import ModelChapter from './engine/ModelChapter';
import CandleIntro from './engine/CandleIntro';
import MapChapter from './engine/MapChapter';
import DatumSplat from './components/DatumSplat';
import { STAGES_MODEL_PLACEMENT } from './engine/stagesToTrack';
import { OPENER_MODEL, OPENER_PLACEMENT, OPENER_EXTRAS, OPENER_TRACK } from './content/openerBull';

/**
 * `?edit` opens a standalone, full-screen keyframe editor for a model — no
 * longread around it. Override the model/frames via query, e.g.
 *   /?edit&model=/models/bull.glb&frames=4
 * Pass `stages=/path/stages.json` to seed the timeline from an old splash export
 * (cartesian cameras → spherical keyframes + explode); the model is then placed
 * with that file's authored transform so the framings land exactly, e.g.
 *   /?edit&model=/chapters/splash/models/Bullforweb2-butcher4.glb&stages=/chapters/splash/stages.json&frames=6
 * Without `?edit` the real Charging Bull longread renders as before.
 */
export default function App() {
  // SSR-safe: no window during prerender → empty params → renders the longread
  // (the ?edit/?candles/?map preview branches are client/dev-only).
  const params = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : '',
  );

  // `?candles` previews the native Black Monday candle intro standalone (no
  // longread around it), so the provisional candle layer can be eyeballed/tuned
  // without touching the live opener.
  if (params.has('candles')) {
    return (
      <div className="w-full bg-[#06070a]">
        <CandleIntro frames={Number(params.get('frames')) || 9} />
      </div>
    );
  }

  // `?map` previews the native map chapter standalone.
  if (params.has('map')) {
    return (
      <div className="w-full bg-[#0a0a10]">
        <MapChapter />
      </div>
    );
  }

  // `?datum` previews the Datum "bull in houses" environment loaded by scene id
  // from the Studio API — to confirm the by-id load works before wiring the
  // map→model handoff. Override the API base with `?api=...` if needed.
  if (params.has('datum')) {
    return (
      <div className="w-full h-screen bg-black">
        <DatumSplat
          label="bull-env"
          sceneId={params.get('scene') || '32caa065-7eb1-43a1-b8fc-5d6017ed52ad'}
          revision={params.get('rev') || '1f515756-64b8-4e85-9dc8-eaa4359cbd1a'}
          studioApiUrl={params.get('api') || undefined}
          controlsMode={params.get('fps') != null ? 'fps' : undefined}
          cameraStateOverride={{ position: [97.855, 79.605, 30.468], orbitTarget: [-50.901, 58.09, -3.408], fov: 60 }}
          allowWheelZoom
          stats
        />
      </div>
    );
  }

  if (params.has('edit')) {
    // `?edit&opener` — edit the LIVE opener bull track (intro · dissolve · kick ·
    // stages). Tune poses, hit "copy MDX", paste keys back into src/content/openerBull.ts.
    if (params.has('opener')) {
      return (
        <div className="w-full h-[100dvh] overflow-hidden">
          <ModelChapter
            src={OPENER_MODEL}
            frames={Number(params.get('frames')) || 8}
            track={OPENER_TRACK}
            placement={OPENER_PLACEMENT}
            extras={OPENER_EXTRAS}
            vignette
            edit
          />
        </div>
      );
    }
    const model = params.get('model') || '/models/bull.glb';
    const frames = Number(params.get('frames')) || 4;
    const stages = params.get('stages') || undefined;
    return (
      <div className="w-full h-[100dvh] overflow-hidden">
        <ModelChapter
          src={model}
          frames={frames}
          stagesUrl={stages}
          placement={stages ? STAGES_MODEL_PLACEMENT : undefined}
          edit
        />
      </div>
    );
  }

  return (
    <Longread>
      <ChargingBull components={mdxComponents} />
    </Longread>
  );
}
