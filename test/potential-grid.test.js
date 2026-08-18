import assert from "node:assert/strict";
import test from "node:test";

import {
  createPotentialGridGeometry,
  extractContourSegments,
  potentialGridCanServeViewport,
} from "../src/potential-grid.js";

test("potential geometry covers the viewport with screen-relative overscan", () => {
  const visibleBounds = { xmin: -4, xmax: 4, ymin: -3, ymax: 3 };
  const geometry = createPotentialGridGeometry({
    visibleBounds,
    zoom: 100,
    targetSpacingPixels: 10,
    overscanCells: 10,
  });

  assert.equal(geometry.spacingWorld, 0.1);
  assert.equal(geometry.spacingPixels, 10);
  assert.ok(geometry.bounds.xmin <= visibleBounds.xmin - 1);
  assert.ok(geometry.bounds.xmax >= visibleBounds.xmax + 1);
  assert.ok(geometry.bounds.ymin <= visibleBounds.ymin - 1);
  assert.ok(geometry.bounds.ymax >= visibleBounds.ymax + 1);
});

test("potential geometry adapts resolution without exceeding buffer limits", () => {
  const geometry = createPotentialGridGeometry({
    visibleBounds: { xmin: -20, xmax: 20, ymin: -12, ymax: 12 },
    zoom: 100,
    targetSpacingPixels: 10,
    overscanCells: 10,
    maxColumns: 320,
    maxRows: 240,
  });

  assert.ok(geometry.spacingPixels > 10);
  assert.ok(geometry.columns <= 320);
  assert.ok(geometry.rows <= 240);
});

test("an overscanned grid is reused only while coverage and quality remain valid", () => {
  const geometry = createPotentialGridGeometry({
    visibleBounds: { xmin: -4, xmax: 4, ymin: -3, ymax: 3 },
    zoom: 100,
  });
  const grid = { ...geometry, sceneVersion: 7 };

  assert.equal(
    potentialGridCanServeViewport(
      grid,
      { xmin: -3.8, xmax: 4.2, ymin: -3, ymax: 3 },
      { zoom: 100, maximumSpacingPixels: 12.5, sceneVersion: 7 },
    ),
    true,
  );
  assert.equal(
    potentialGridCanServeViewport(
      grid,
      { xmin: -4, xmax: 5.2, ymin: -3, ymax: 3 },
      { zoom: 100, maximumSpacingPixels: 12.5, sceneVersion: 7 },
    ),
    false,
  );
  assert.equal(
    potentialGridCanServeViewport(
      grid,
      { xmin: -4, xmax: 4, ymin: -3, ymax: 3 },
      { zoom: 200, maximumSpacingPixels: 12.5, sceneVersion: 7 },
    ),
    false,
  );
});

test("equipotential segments are extracted from the shared scalar grid", () => {
  const segments = extractContourSegments(
    {
      columns: 2,
      rows: 2,
      spacingWorld: 1,
      bounds: { xmin: 0, xmax: 1, ymin: 0, ymax: 1 },
      values: new Float64Array([-1, 1, -1, 1]),
    },
    [0],
  );

  assert.deepEqual(segments, [
    [
      { x: 0.5, y: 1 },
      { x: 0.5, y: 0 },
    ],
  ]);
});
