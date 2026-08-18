export const POTENTIAL_TARGET_SPACING_PIXELS = 10;
export const POTENTIAL_INTERACTIVE_SPACING_PIXELS = 28;
export const POTENTIAL_OVERSCAN_PIXELS = 100;
export const POTENTIAL_OVERSCAN_CELLS = 10;
export const POTENTIAL_MAX_COLUMNS = 320;
export const POTENTIAL_MAX_ROWS = 240;

const isFiniteBounds = (bounds) =>
  bounds &&
  Number.isFinite(bounds.xmin) &&
  Number.isFinite(bounds.xmax) &&
  Number.isFinite(bounds.ymin) &&
  Number.isFinite(bounds.ymax) &&
  bounds.xmin <= bounds.xmax &&
  bounds.ymin <= bounds.ymax;

export function createPotentialGridGeometry({
  visibleBounds,
  zoom,
  targetSpacingPixels = POTENTIAL_TARGET_SPACING_PIXELS,
  overscanCells = POTENTIAL_OVERSCAN_CELLS,
  maxColumns = POTENTIAL_MAX_COLUMNS,
  maxRows = POTENTIAL_MAX_ROWS,
}) {
  if (!isFiniteBounds(visibleBounds)) {
    throw new TypeError("Potential grid bounds must be finite");
  }
  if (!(zoom > 0) || !(targetSpacingPixels > 0)) {
    throw new RangeError("Potential grid zoom and spacing must be positive");
  }
  if (!Number.isInteger(overscanCells) || overscanCells < 0) {
    throw new RangeError("Potential grid overscan must be a non-negative integer");
  }
  if (
    !Number.isInteger(maxColumns) ||
    !Number.isInteger(maxRows) ||
    maxColumns <= overscanCells * 2 + 2 ||
    maxRows <= overscanCells * 2 + 2
  ) {
    throw new RangeError("Potential grid limits are too small for its overscan");
  }

  const visiblePixelWidth =
    (visibleBounds.xmax - visibleBounds.xmin) * zoom;
  const visiblePixelHeight =
    (visibleBounds.ymax - visibleBounds.ymin) * zoom;
  const usableColumnIntervals = maxColumns - overscanCells * 2 - 2;
  const usableRowIntervals = maxRows - overscanCells * 2 - 2;
  const spacingPixels = Math.max(
    targetSpacingPixels,
    visiblePixelWidth / usableColumnIntervals,
    visiblePixelHeight / usableRowIntervals,
  );
  const spacingWorld = spacingPixels / zoom;
  const firstColumn =
    Math.floor(visibleBounds.xmin / spacingWorld) - overscanCells;
  const lastColumn =
    Math.ceil(visibleBounds.xmax / spacingWorld) + overscanCells;
  const firstRow =
    Math.floor(visibleBounds.ymin / spacingWorld) - overscanCells;
  const lastRow =
    Math.ceil(visibleBounds.ymax / spacingWorld) + overscanCells;

  return {
    columns: lastColumn - firstColumn + 1,
    rows: lastRow - firstRow + 1,
    spacingWorld,
    spacingPixels,
    bounds: {
      xmin: firstColumn * spacingWorld,
      xmax: lastColumn * spacingWorld,
      ymin: firstRow * spacingWorld,
      ymax: lastRow * spacingWorld,
    },
  };
}

export function potentialGridCanServeViewport(
  grid,
  visibleBounds,
  { zoom, maximumSpacingPixels, sceneVersion },
) {
  if (!grid || !isFiniteBounds(visibleBounds)) return false;
  const tolerance = grid.spacingWorld * 1e-8;
  return (
    grid.sceneVersion === sceneVersion &&
    grid.bounds.xmin <= visibleBounds.xmin + tolerance &&
    grid.bounds.xmax >= visibleBounds.xmax - tolerance &&
    grid.bounds.ymin <= visibleBounds.ymin + tolerance &&
    grid.bounds.ymax >= visibleBounds.ymax - tolerance &&
    grid.spacingWorld * zoom <= maximumSpacingPixels
  );
}

function interpolatePoint(x1, y1, value1, x2, y2, value2, level) {
  const difference = value2 - value1;
  const factor =
    Math.abs(difference) < 1e-30
      ? 0.5
      : Math.max(0, Math.min(1, (level - value1) / difference));
  return {
    x: x1 + factor * (x2 - x1),
    y: y1 + factor * (y2 - y1),
  };
}

const crossesLevel = (value1, value2, level) =>
  (value1 < level && value2 >= level) ||
  (value2 < level && value1 >= level);

export function extractContourSegments(grid, levels) {
  const { columns, rows, values, bounds, spacingWorld } = grid;
  if (values.length !== columns * rows) {
    throw new RangeError("Potential grid values do not match its dimensions");
  }

  const segments = [];
  for (const level of levels) {
    for (let row = 0; row < rows - 1; row += 1) {
      const worldY0 = bounds.ymax - row * spacingWorld;
      const worldY1 = worldY0 - spacingWorld;
      for (let column = 0; column < columns - 1; column += 1) {
        const index = row * columns + column;
        const value0 = values[index];
        const value1 = values[index + 1];
        const value2 = values[index + 1 + columns];
        const value3 = values[index + columns];
        const worldX0 = bounds.xmin + column * spacingWorld;
        const worldX1 = worldX0 + spacingWorld;
        const points = [];

        if (crossesLevel(value0, value1, level)) {
          points.push(
            interpolatePoint(
              worldX0,
              worldY0,
              value0,
              worldX1,
              worldY0,
              value1,
              level,
            ),
          );
        }
        if (crossesLevel(value1, value2, level)) {
          points.push(
            interpolatePoint(
              worldX1,
              worldY0,
              value1,
              worldX1,
              worldY1,
              value2,
              level,
            ),
          );
        }
        if (crossesLevel(value2, value3, level)) {
          points.push(
            interpolatePoint(
              worldX1,
              worldY1,
              value2,
              worldX0,
              worldY1,
              value3,
              level,
            ),
          );
        }
        if (crossesLevel(value3, value0, level)) {
          points.push(
            interpolatePoint(
              worldX0,
              worldY1,
              value3,
              worldX0,
              worldY0,
              value0,
              level,
            ),
          );
        }

        if (points.length === 2) {
          segments.push([points[0], points[1]]);
        } else if (points.length === 4) {
          segments.push([points[0], points[1]], [points[2], points[3]]);
        }
      }
    }
  }
  return segments;
}
