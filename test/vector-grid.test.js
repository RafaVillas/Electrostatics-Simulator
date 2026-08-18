import assert from "node:assert/strict";
import test from "node:test";

import {
  createVectorGrid,
  vectorSpacingPixels,
} from "../src/vector-grid.js";

const WORLD = { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };

function gridValues(first, last, spacing) {
  return Array.from(
    { length: Math.max(0, last - first + 1) },
    (_, index) => (first + index) * spacing,
  );
}

test("vector grid covers the viewport with two aligned overscan cells", () => {
  const visibleBounds = {
    xmin: -2.13,
    xmax: 2.37,
    ymin: -1.1,
    ymax: 1.3,
  };
  const grid = createVectorGrid({
    visibleBounds,
    worldBounds: WORLD,
    zoom: 100,
    spacingPixels: 40,
    overscan: 2,
  });
  const xValues = gridValues(
    grid.firstColumn,
    grid.lastColumn,
    grid.spacingWorld,
  );
  const yValues = gridValues(grid.firstRow, grid.lastRow, grid.spacingWorld);
  const isAligned = (value) => {
    const index = value / grid.spacingWorld;
    return Math.abs(index - Math.round(index)) < 1e-10;
  };

  assert.equal(grid.spacingWorld, 0.4);
  assert.ok(xValues[0] <= visibleBounds.xmin - grid.spacingWorld * 2);
  assert.ok(xValues.at(-1) >= visibleBounds.xmax + grid.spacingWorld * 2);
  assert.ok(yValues[0] <= visibleBounds.ymin - grid.spacingWorld * 2);
  assert.ok(yValues.at(-1) >= visibleBounds.ymax + grid.spacingWorld * 2);
  assert.ok([...xValues, ...yValues].every(isAligned));
});

test("expanding the viewport adds positions without shifting existing ones", () => {
  const options = {
    worldBounds: WORLD,
    zoom: 100,
    spacingPixels: 40,
    overscan: 2,
  };
  const small = createVectorGrid({
    ...options,
    visibleBounds: { xmin: -4, xmax: 4, ymin: -3, ymax: 3 },
  });
  const large = createVectorGrid({
    ...options,
    visibleBounds: { xmin: -6, xmax: 6, ymin: -4, ymax: 4 },
  });
  const smallColumns = gridValues(
    small.firstColumn,
    small.lastColumn,
    small.spacingWorld,
  );
  const largeColumns = new Set(
    gridValues(large.firstColumn, large.lastColumn, large.spacingWorld),
  );

  assert.ok(smallColumns.every((position) => largeColumns.has(position)));
  assert.ok(large.firstColumn < small.firstColumn);
  assert.ok(large.lastColumn > small.lastColumn);
});

test("density maps to stable screen spacing at different viewport widths", () => {
  const spacingPixels = vectorSpacingPixels(23);
  const narrow = createVectorGrid({
    visibleBounds: { xmin: -4, xmax: 4, ymin: -3, ymax: 3 },
    worldBounds: WORLD,
    zoom: 100,
    spacingPixels,
  });
  const wide = createVectorGrid({
    visibleBounds: { xmin: -6, xmax: 6, ymin: -3, ymax: 3 },
    worldBounds: WORLD,
    zoom: 100,
    spacingPixels,
  });

  assert.equal(narrow.spacingWorld * 100, spacingPixels);
  assert.equal(wide.spacingWorld * 100, spacingPixels);
  assert.ok(
    wide.lastColumn - wide.firstColumn >
      narrow.lastColumn - narrow.firstColumn,
  );
});

test("overscan is clamped to the physical world", () => {
  const grid = createVectorGrid({
    visibleBounds: { xmin: -10, xmax: 10, ymin: -10, ymax: 10 },
    worldBounds: WORLD,
    zoom: 100,
    spacingPixels: 40,
    overscan: 2,
  });
  const xValues = gridValues(
    grid.firstColumn,
    grid.lastColumn,
    grid.spacingWorld,
  );

  assert.ok(xValues[0] >= WORLD.xmin);
  assert.ok(xValues.at(-1) <= WORLD.xmax);
});
