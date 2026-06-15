import { useEffect, useState } from 'react';

/**
 * Stand-in for a heavy WebGL/Splat viewer. Logs mount/unmount so you can
 * verify HeavyBlock is tearing it down when scrolled out of view, and shows
 * a fake "loading -> ready" lifecycle so the demo doesn't look static.
 */
export default function FakeSplat({ label }: { label: string }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    console.log(`[FakeSplat:${label}] MOUNT — would init Datum SDK here`);
    const t = setTimeout(() => setReady(true), 600);
    return () => {
      clearTimeout(t);
      console.log(`[FakeSplat:${label}] UNMOUNT — would dispose Datum SDK here`);
    };
  }, [label]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#08080c]">
      <div className="absolute inset-0 grid place-items-center">
        <div
          className={`transition-opacity duration-700 ${ready ? 'opacity-100' : 'opacity-0'}`}
        >
          <div
            className="w-72 h-72 md:w-96 md:h-96 rounded-full blur-2xl"
            style={{
              background:
                'radial-gradient(circle at 30% 30%, #c9a961 0%, #8b6a2c 35%, transparent 70%)',
              filter: 'saturate(1.2)',
              animation: 'spin 18s linear infinite',
            }}
          />
        </div>
      </div>
      <div className="absolute bottom-6 left-6 right-6 flex items-baseline justify-between text-[10px] uppercase tracking-[3px] text-fg/40">
        <span>splat://{label}</span>
        <span>{ready ? 'live' : 'init…'}</span>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
