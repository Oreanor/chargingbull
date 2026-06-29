import { useEffect, useState } from 'react';
import { bullEditStore } from './editStore';

/**
 * DevToolbar — a single dev-only icon button (🐂) pinned top-right, directly under
 * the tuneEditor's ✎ pencil and matching its style. Toggles the opener's in-place
 * bull keyframe editor (camera poses) on/off. Plaque/text layout editing has its own
 * toggle — the ✎ pencil itself. Mounted only under import.meta.env.DEV (see Longread).
 */
export default function DevToolbar() {
  const [bull, setBull] = useState(false);
  useEffect(() => bullEditStore.subscribe(() => setBull(bullEditStore.active)), []);

  return (
    <button
      data-tune-ui=""
      onClick={() => bullEditStore.toggle()}
      title="Редактор быка — кейфреймы камеры / поза (вкл/выкл)"
      style={{
        position: 'fixed',
        top: '52px', // just below the ✎ pencil (top 12 + 34 + gap)
        right: '12px',
        width: '34px',
        height: '34px',
        zIndex: 2147483647,
        font: '16px monospace',
        lineHeight: 1,
        color: '#fff',
        background: bull ? '#de2053' : '#222',
        border: '1px solid #444',
        borderRadius: '6px',
        cursor: 'pointer',
        pointerEvents: 'auto',
      }}
    >
      🐂
    </button>
  );
}
