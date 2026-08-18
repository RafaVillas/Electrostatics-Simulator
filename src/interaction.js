export const DRAG_THRESHOLD_PIXELS = 4;

const POINT_HIT_RADIUS = 18;
const LINE_HIT_RADIUS = 12;
const PLANE_HIT_PADDING = 8;

export function getPointerInteractionType({ button, ctrlKey, isPrimary }) {
  if (!isPrimary || button !== 0) return null;
  return ctrlKey ? "selection-pending" : "pan-pending";
}

export function exceedsDragThreshold(
  startX,
  startY,
  currentX,
  currentY,
  threshold = DRAG_THRESHOLD_PIXELS,
) {
  return Math.hypot(currentX - startX, currentY - startY) >= threshold;
}

export function sourcePositionFromPointer(
  pixelX,
  pixelY,
  { offsetX = 0, offsetY = 0, screenToWorld },
) {
  const pointerWorld = screenToWorld(pixelX, pixelY);
  return {
    x: pointerWorld.x - offsetX,
    y: pointerWorld.y - offsetY,
  };
}

function pointToSegmentDistance(pointX, pointY, start, end) {
  const segmentX = end.x - start.x;
  const segmentY = end.y - start.y;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) return Math.hypot(pointX - start.x, pointY - start.y);

  const projection = Math.max(
    0,
    Math.min(
      1,
      ((pointX - start.x) * segmentX + (pointY - start.y) * segmentY) /
        lengthSquared,
    ),
  );
  return Math.hypot(
    pointX - (start.x + projection * segmentX),
    pointY - (start.y + projection * segmentY),
  );
}

function sourceHitDistance(source, pixelX, pixelY, worldToScreen, zoom) {
  if (source.type === "point") {
    const center = worldToScreen(source.x, source.y);
    const centerDistance = Math.hypot(pixelX - center.x, pixelY - center.y);
    return centerDistance <= POINT_HIT_RADIUS ? centerDistance : null;
  }

  if (source.type === "line") {
    const cos = Math.cos(source.angle);
    const sin = Math.sin(source.angle);
    const halfLength = source.length / 2;
    const start = worldToScreen(
      source.x - halfLength * cos,
      source.y - halfLength * sin,
    );
    const end = worldToScreen(
      source.x + halfLength * cos,
      source.y + halfLength * sin,
    );
    const segmentDistance = pointToSegmentDistance(
      pixelX,
      pixelY,
      start,
      end,
    );
    return segmentDistance <= LINE_HIT_RADIUS ? segmentDistance : null;
  }

  if (source.type === "plane") {
    const center = worldToScreen(source.x, source.y);
    const deltaX = pixelX - center.x;
    const deltaY = pixelY - center.y;
    const cos = Math.cos(source.angle);
    const sin = Math.sin(source.angle);
    const localX = deltaX * cos - deltaY * sin;
    const localY = -deltaX * sin - deltaY * cos;
    const outsideX = Math.max(Math.abs(localX) - (source.width * zoom) / 2, 0);
    const outsideY = Math.max(
      Math.abs(localY) - (source.height * zoom) / 2,
      0,
    );
    const rectangleDistance = Math.hypot(outsideX, outsideY);
    return rectangleDistance <= PLANE_HIT_PADDING ? rectangleDistance : null;
  }

  return null;
}

export function findSourceAtScreen(
  sources,
  pixelX,
  pixelY,
  { worldToScreen, zoom },
) {
  let closest = null;

  sources.forEach((source, layer) => {
    const distance = sourceHitDistance(
      source,
      pixelX,
      pixelY,
      worldToScreen,
      zoom,
    );
    if (distance === null) return;

    if (
      !closest ||
      distance < closest.distance ||
      (distance === closest.distance && layer > closest.layer)
    ) {
      closest = { source, distance, layer };
    }
  });

  return closest?.source ?? null;
}
