// Tunable defaults (editable in the Settings panel) and fixed constants.

export const DEFAULT_PARAMS = {
  hueMin: 8,          // degrees
  hueMax: 40,         // degrees
  minSat: 0.45,       // 0..1
  minVal: 0.3,        // 0..1
  motionThresh: 0.12, // jump in orange level (red - blue) / (r + g + b) since the previous frame
  minBlob: 6,         // matching pixels needed in the 48 px window
  turnAngle: 70,      // degrees of path turn that counts as a bounce
  minMove: 6,         // screen px each 2-frame segment must move
  wallWidthCm: 180,   // measured width of the projected image on the wall
  sizeCheck: true,    // reject turns where the ball looks bigger (paddle hits)
  showBallDot: false, // debug: draw the tracked ball on the wall
  testMode: false,    // tapping the game counts as a hit
};

// Tracker
export const PROC_WIDTH = 640; // camera frame is processed at this width (ball ~8-10 px)
export const CELL = 16;        // density grid cell, px
export const WINDOW = 48;      // centroid window around the densest cell, px
export const ROI_MARGIN = 0.1; // region of interest = wall area + 10%

// Bounce detection
export const TRACK_MAX = 24;
export const GAP_MS = 160;
export const COOLDOWN_MS = 250;
export const SIZE_RATIO = 1.15;  // "looks bigger" means at least 15% bigger than both sides
export const BOUNDS_TOL = 0.02;  // hit may sit 2% outside the wall and still count

// Game
export const TARGET_COUNT = 6;
export const HIT_MARGIN_CM = 2;
export const RESPAWN_MS = 250;
// One size and one colour per tier, so a circle's size and colour always tell its points.
// Colours are never orange, red or yellow: the tracker would chase them.
export const TIERS = [
  { name: 'small', cm: 11, points: 10, share: 0.20, color: '#00e676' },
  { name: 'medium', cm: 20, points: 5, share: 0.35, color: '#00e5ff' },
  { name: 'large', cm: 35, points: 2, share: 0.45, color: '#b05cff' },
];

// Play-area boundary drawn around the projected image, so players can see it with the lights on.
export const BOUNDARY_CM = 2.5;      // frame thickness on the wall
export const BOUNDARY_COLOR = '#ffffff';
export const OUT_COLOR = '#b05cff';
export const BOUNDARY_PULSE_MS = 2500;

// Calibration: dots 10% in from each corner, in order TL, TR, BR, BL (normalised screen coords)
export const CAL_DOTS = [[0.1, 0.1], [0.9, 0.1], [0.9, 0.9], [0.1, 0.9]];
