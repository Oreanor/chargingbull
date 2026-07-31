import { useEffect, useState } from 'react';
import { bullEditStore, poseProbeStore } from './editStore';

/**
 * DevToolbar — the dev-only icon buttons pinned top-right, stacked under the
 * tuneEditor's ✎ pencil and matching its style:
 *
 *   🐂  full keyframe editor (camera poses, timeline, export)
 *   ⟳   pose probe — just drag the bull where it stands and read the pose back
 *
 * Plaque/text layout editing has its own toggle — the ✎ pencil itself. Mounted
 * only under import.meta.env.DEV (see Longread).
 */

/** Toggle button, styled like the ✎ pencil. `row` = its slot in the stack (0 = under ✎). */
function DevButton({ row, on, label, title, onClick }: {
  row: number;
  on: boolean;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      data-tune-ui=""
      onClick={onClick}
      title={title}
      style={{
        position: 'fixed',
        top: `${52 + row * 40}px`, // ✎ is at 12; each slot is 34 tall + 6 gap
        right: '12px',
        width: '34px',
        height: '34px',
        zIndex: 2147483647,
        font: '16px monospace',
        lineHeight: 1,
        color: '#fff',
        background: on ? '#de2053' : '#222',
        border: '1px solid #444',
        borderRadius: '6px',
        cursor: 'pointer',
        pointerEvents: 'auto',
      }}
    >
      {label}
    </button>
  );
}

export default function DevToolbar() {
  const [bull, setBull] = useState(false);
  const [probe, setProbe] = useState(false);
  useEffect(() => bullEditStore.subscribe(() => setBull(bullEditStore.active)), []);
  useEffect(() => poseProbeStore.subscribe(() => setProbe(poseProbeStore.active)), []);

  return (
    <>
      <DevButton
        row={0}
        on={bull}
        label="🐂"
        title="Редактор быка — кейфреймы камеры / поза (вкл/выкл)"
        onClick={() => bullEditStore.toggle()}
      />
      <DevButton
        row={1}
        on={probe}
        label="⟳"
        title="Покрутить быка на месте: тянуть по экрану — поза читается внизу слева (вкл/выкл)"
        onClick={() => poseProbeStore.toggle()}
      />
    </>
  );
}
