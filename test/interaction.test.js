import assert from "node:assert/strict";
import test from "node:test";

import {
  DRAG_THRESHOLD_PIXELS,
  exceedsDragThreshold,
  findSourceAtScreen,
  getPointerInteractionType,
  sourcePositionFromPointer,
} from "../src/interaction.js";

const point = (id, x, y) => ({ id, type: "point", x, y, q: 1e-9 });

function transform(zoom = 100, centerX = 400, centerY = 300) {
  return {
    zoom,
    worldToScreen: (x, y) => ({
      x: centerX + x * zoom,
      y: centerY - y * zoom,
    }),
  };
}

test("the drag threshold separates an almost-still click from panning", () => {
  assert.equal(
    exceedsDragThreshold(10, 10, 12, 12, DRAG_THRESHOLD_PIXELS),
    false,
  );
  assert.equal(
    exceedsDragThreshold(10, 10, 14, 10, DRAG_THRESHOLD_PIXELS),
    true,
  );
});

test("pointer intent gives Ctrl selection priority over left-button panning", () => {
  assert.equal(
    getPointerInteractionType({ button: 0, ctrlKey: false, isPrimary: true }),
    "pan-pending",
  );
  assert.equal(
    getPointerInteractionType({ button: 0, ctrlKey: true, isPrimary: true }),
    "selection-pending",
  );
  assert.equal(
    getPointerInteractionType({ button: 2, ctrlKey: false, isPrimary: true }),
    null,
  );
});

test("dragged sources preserve their world-space pointer offset", () => {
  const position = sourcePositionFromPointer(650, 175, {
    offsetX: 0.2,
    offsetY: -0.1,
    screenToWorld: (pixelX, pixelY) => ({
      x: 1.5 + (pixelX - 400) / 200,
      y: -0.5 - (pixelY - 300) / 200,
    }),
  });

  assert.deepEqual(position, { x: 2.55, y: 0.225 });
});

test("hit testing chooses the visually closest point source", () => {
  const sources = [point(1, 0, 0), point(2, 0.15, 0)];
  const hit = findSourceAtScreen(sources, 403, 300, transform());

  assert.equal(hit.id, 1);
});

test("overlapping hits use the uppermost source deterministically", () => {
  const sources = [point(1, 0, 0), point(2, 0, 0)];
  const hit = findSourceAtScreen(sources, 400, 300, transform());

  assert.equal(hit.id, 2);
});

test("line hit tolerance remains expressed in screen pixels", () => {
  const line = {
    id: 3,
    type: "line",
    x: 0,
    y: 0,
    length: 4,
    angle: 0,
  };

  assert.equal(findSourceAtScreen([line], 400, 310, transform(100)).id, 3);
  assert.equal(findSourceAtScreen([line], 400, 310, transform(25)).id, 3);
  assert.equal(findSourceAtScreen([line], 400, 313, transform(100)), null);
});

test("rotated planes include a small pixel-based hit padding", () => {
  const plane = {
    id: 4,
    type: "plane",
    x: 0,
    y: 0,
    width: 2,
    height: 1,
    angle: Math.PI / 4,
  };

  assert.equal(findSourceAtScreen([plane], 400, 300, transform()).id, 4);
  assert.equal(findSourceAtScreen([plane], 600, 300, transform()), null);
});
