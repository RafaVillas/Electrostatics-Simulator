const isFiniteBounds = (bounds) =>
  bounds &&
  Number.isFinite(bounds.xmin) &&
  Number.isFinite(bounds.xmax) &&
  Number.isFinite(bounds.ymin) &&
  Number.isFinite(bounds.ymax) &&
  bounds.xmin <= bounds.xmax &&
  bounds.ymin <= bounds.ymax;

// Preserves the old slider meaning at the simulator's 900 px baseline while
// allowing wider viewports to add columns instead of stretching the grid.
export const VECTOR_DENSITY_REFERENCE_WIDTH = 900;

function axisRange(
  visibleMinimum,
  visibleMaximum,
  worldMinimum,
  worldMaximum,
  spacing,
  overscan,
) {
  const firstVisibleIndex = Math.floor(visibleMinimum / spacing);
  const lastVisibleIndex = Math.ceil(visibleMaximum / spacing);
  const firstWorldIndex = Math.ceil(worldMinimum / spacing);
  const lastWorldIndex = Math.floor(worldMaximum / spacing);

  return {
    first: Math.max(firstWorldIndex, firstVisibleIndex - overscan),
    last: Math.min(lastWorldIndex, lastVisibleIndex + overscan),
  };
}

export function vectorSpacingPixels(
  density,
  referenceWidth = VECTOR_DENSITY_REFERENCE_WIDTH,
) {
  if (!(density > 0) || !(referenceWidth > 0)) {
    throw new RangeError("Vector density and reference width must be positive");
  }
  return referenceWidth / density;
}

export function createVectorGrid({
  visibleBounds,
  worldBounds,
  zoom,
  spacingPixels,
  overscan = 2,
}) {
  if (!isFiniteBounds(visibleBounds) || !isFiniteBounds(worldBounds)) {
    throw new TypeError("Vector grid bounds must be finite");
  }
  if (!(zoom > 0) || !(spacingPixels > 0)) {
    throw new RangeError("Vector grid zoom and spacing must be positive");
  }
  if (!Number.isInteger(overscan) || overscan < 0) {
    throw new RangeError("Vector grid overscan must be a non-negative integer");
  }

  const spacingWorld = spacingPixels / zoom;
  const columns = axisRange(
    visibleBounds.xmin,
    visibleBounds.xmax,
    worldBounds.xmin,
    worldBounds.xmax,
    spacingWorld,
    overscan,
  );
  const rows = axisRange(
    visibleBounds.ymin,
    visibleBounds.ymax,
    worldBounds.ymin,
    worldBounds.ymax,
    spacingWorld,
    overscan,
  );

  return {
    spacingWorld,
    firstColumn: columns.first,
    lastColumn: columns.last,
    firstRow: rows.first,
    lastRow: rows.last,
  };
}
