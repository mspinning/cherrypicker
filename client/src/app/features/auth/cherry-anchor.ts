// Kept apart from login-scene.ts so the page can use it without pulling in three.js.

/** Centre and height of the cherry pair in CSS px, relative to the canvas. */
export interface CherryAnchor {
  x: number;
  y: number;
  height: number;
}

/** Height of the cherry pair at scale 1 (scene units). */
export const CHERRY_HEIGHT = 2.55;
/** Its left edge sits this fraction of the height left of its centre. */
export const CHERRY_LEFT_EDGE = 0.46;
