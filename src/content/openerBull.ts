import type { CameraTrack } from '../engine';
import type { ChapterExtra } from '../engine/ModelChapter';

/**
 * Opener bull config — the single source of truth for the native opener's 3D bull,
 * shared by the longread (charging-bull.mdx) and the pose editor (App `?edit&opener`).
 * Tune the camera poses / explode / push / opacity visually in the editor, hit
 * "copy MDX" there, and paste the resulting `keys` back into OPENER_TRACK here.
 */

// TWO builds of the same figure. The chapter runs on the WHOLE one — one watertight mesh,
// no saw lines across the bronze — and swaps to the cut one only while the explode is on
// (ModelChapter `cutSrc` → GlbSceneOptions.cutModelUrl). They share an authored space: both
// measure 3.058 × 3.397 × 5.567 about the same centre, so the swap moves nothing on screen.
// The cut build is the heavier of the two (1.3 MB against 0.93) and is fetched only after
// the whole one has landed — the opener's reveal waits on that one, and nothing needs the
// sections until ~0.75 of the chapter.
export const OPENER_MODEL = '/chapters/splash/models/Bullforweb6.glb';
export const OPENER_CUT_MODEL = '/chapters/splash/models/Bullforweb2-butcher4.glb';
export const OPENER_FRAMES = 14;
// Phone-only seating of the figure: it sits 9% of its own height lower than the captured
// poses put it, with the muzzle tipped 6° down so the head reads the way it does in the wide
// crop. Both move the MODEL — the only lever that disturbs neither the camera track (poses
// are captured in the editor, not typed) nor the frame's edges. Wide screens set neither, so
// the desktop opener is untouched.
export const OPENER_PLACEMENT = {
  scale: 0.3593,
  recenter: false,
  dropFracPhone: 0.09,
  pitchDegPhone: 4,
} as const;

export const OPENER_EXTRAS: ChapterExtra[] = [
  {
    src: '/models/cab_wheels.glb', // cab body + separate front_wheels/back_wheels nodes (spin while driving)
    position: [0.83, 0, 0.12], // hand-placed via the 🚕 control
    rotation: [0, 1.54, 0],
    scale: 0.32,
    tint: 0.5,
    envMapIntensity: 0.7,
    at: [0.583, 0.771],       // f8 → f10¼
    enterFrom: [0.16, 0, -5.28], // drives in from ~3 car-lengths BEHIND (along its axis)
    enterFrac: 0.22,          // arrives by f8.5 (0.583 → 0.625)
    exitTo: [-0.11, 0, 3.52], // drives ~2 car-lengths FORWARD and off
    exitFrac: 0.22,           // leaves f9¾ → f10¼ (0.729 → 0.771)
    fade: true,               // fades in on entry, dissolves out on exit
  },
];

export const OPENER_TRACK: CameraTrack = {
  leadIn: 0,
  keys: [
    // Opening screen. The phone looks DOWN on the head (polar 64.5 vs the wide 79.5): in the
    // tall crop the muzzle has to tip into frame under the wordmark, where the wide crop can
    // hold the head at eye level. It also sits ~10% closer — on-screen size goes as 1/dist,
    // so 1.47 / 1.1 = 1.34 — because the narrow crop has to carry the head on its own, with
    // no body beside it. fov, target and the lunge are the same pose on both.
    { at: 0, az: 17.5, polar: 79.5, dist: 1.47, push: 0.1, fov: 40, target: [0.09, 0.32, 0.39],
      phone: { az: 19.6, polar: 64.5, dist: 1.34 } },
    { at: 0.05, az: 85.3, polar: 86.1, dist: 5.2, opacity: 0, fov: 40, target: [0.27, 0.52, -0.16] },
    { at: 0.3, az: 27.5, polar: 68.8, dist: 5.2, push: 0.6, opacity: 0, fov: 40, target: [0.27, 0.52, -0.16] },
    // The goring: the bull is invisible through 0.3 (opacity 0) and both appears and drives
    // forward on THIS move — push 0.6 → 0 while the camera dives 5.2 → 1.32 into the chart.
    { at: 0.37, az: 33.8, polar: 77, dist: 1.32, fov: 44, target: [0.02, 0.39, 0.18] },
    // …then straight into the pose the cab arrives in, and held there. There used to be a
    // second, near-identical pose (az 39.7 / dist 1.62) held 0.39→0.44 in between: two moves
    // and a stop to reach a view the reader sits in anyway. The pose itself is unchanged —
    // still the captured one that used to start at 0.58 — only the moment it is reached. It
    // lands at 0.55, not at 0.44: one slow move keeps the bull big enough to sit behind the
    // «Meet the bull» plaque, which reaching it early leaves reading over an empty frame.
    { at: 0.55, az: 41.6, polar: 76.6, dist: 2.13, fov: 46.9, target: [0.42, 0.34, 0.1] },
    { at: 0.62, az: 41.6, polar: 76.6, dist: 2.13, fov: 46.9, target: [0.42, 0.34, 0.1] },
    { at: 0.67, az: 87.4, polar: 94.4, dist: 2.86, fov: 39.6, target: [0.08, 0.44, -0.07] },
    { at: 0.75, az: 87.4, polar: 94.4, dist: 2.86, fov: 39.6, target: [0.08, 0.44, -0.07] },
    // The разлёт, re-captured in the 3D tool: camera [0.964, -0.034, 2.707] → target
    // [-0.026, 0.422, 0.837], fov 45, explode 0.44 (55 parts). The tool also nudged the
    // MODEL to [-0.0953, -0.0016, -0.0898]; that shift is folded into the target here
    // instead of moving the bull, because the bull's origin is shared — every other key's
    // target and the cab's hand-placed seat are measured against it.
    // The pose was then turned and pulled in by hand on the live page — the capture is framed
    // against the tool's own viewport, this one has a «30 separate parts» block sitting to
    // the right of the figure to clear. az 27.9 → 26.7, polar 102.2 → 96.4, and the distance
    // in from the capture's own 2.16 to 1.97, which is the разлёт reading ~10% larger.
    // The hold now starts at 0.79 rather than 0.80, so the explode has landed before
    // PartsFrame begins to fade its labels up (0.80 → 0.835).
    // Not taken from that capture: its exposure (asked for) and its pushZ, which was 0.
    // Two numbers are refitted rather than copied, because this ramp is a straight line where
    // the tool's is a smoothstep over a bias remap: bias 0.61 / sharpness 1.56 is the pair
    // that reproduces the tool's own layout of all 55 sections to within 0.06 model units.
    // `explode` is the capture's 0.44 divided by EXPLODE_SPREAD (= 0.733, where the tool
    // keeps that same factor), then ×1.475 by eye: the horns wanted to reach further than
    // the capture put them. Amplitude only — the weights are the capture's shape untouched,
    // and with rear 0 the hindquarters stay exactly where they are however big this gets.
    // Fog is the capture's own near/far. Only the colour is ours: over this chapter's black
    // frame the captured #2c2c30 belongs to the tool's grey viewport and reads as a second,
    // ghostly bull. Note it mixes BEFORE tone mapping (ACES at 1.05), so the hex is matched
    // to the vignette by eye, not by equality with it.
    // The DESKTOP target is that capture's, panned right so the FIGURE sits left: the
    // «30 separate parts» block hangs off the right of it with nothing to balance it, and
    // the composition as a whole read ~21svh right of the frame's centre. This is the pan
    // itself, not a nudge layer on top of it — camera and target move together, 0.3245
    // units along the camera's own right vector (cos az, 0, −sin az) = (+0.276, 0, −0.171).
    // The figure swings further than 0.3245 units of the TARGET plane would suggest (~35svh
    // against the target's ~18), because it stands well in front of the target and a camera
    // pan parallaxes: near things sweep more than far ones. So this number was fitted on the
    // live page against the composition, not solved for — and PartsFrame's desktop seats,
    // which move with it, were re-read off the same page rather than shifted by a constant.
    // The PHONE keeps the capture's target: there the figure is already seated by
    // overlayFit.mobileFrameNudge's own разлёт seat (BLOWUP_X), against the phone mockup.
    // Desktop target y re-read in the editor, 0.42 → 0.47: the camera looks that much
    // higher, so the exploded figure sits lower in the frame. Desktop only — the phone
    // override still carries the capture's 0.42.
    { at: 0.79, az: 26.7, polar: 96.4, dist: 1.97, explode: 1.08, fov: 45, target: [0.35, 0.47, 0.76],
      phone: { az: 34.9, polar: 102.9, target: [0.07, 0.42, 0.93] },
      weights: { front: 1.69, rear: 0, bias: 0.61, sharpness: 1.56, rise: 1.4 },
      fog: { color: '#0c0d10', near: 2.5, far: 3.7 } },
    // Hold ends at 0.86, not 0.85 — which is also where overlayFit's REAR seat begins, so
    // the phone's framing now hands over exactly as the camera starts its swing behind the
    // figure. (BLOWUP_OUT0 still releases the разлёт seat at 0.85; it leads the pose by 0.01.)
    { at: 0.86, az: 26.7, polar: 96.4, dist: 1.97, explode: 1.08, fov: 45, target: [0.35, 0.47, 0.76],
      phone: { az: 34.9, polar: 102.9, target: [0.07, 0.42, 0.93] },
      weights: { front: 1.69, rear: 0, bias: 0.61, sharpness: 1.56, rise: 1.4 },
      fog: { color: '#0c0d10', near: 2.5, far: 3.7 } },
    { at: 0.92, az: 143.9, polar: 117, dist: 1.86, fov: 40, target: [-0.23, 0.72, -0.05] },
    { at: 1, az: 143.9, polar: 117, dist: 1.86, fov: 40, target: [-0.23, 0.72, -0.05] },
  ],
};
