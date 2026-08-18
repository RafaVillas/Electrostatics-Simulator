import {
  buildSourceSamples,
  clamp,
  electricFieldAt,
  electricPotentialAt,
  sourceNetCharge,
} from "./physics.js";
import { Camera2D } from "./camera.js";
import { CAMERA_DEFAULTS, WORLD_BOUNDS } from "./config.js";
import {
  exceedsDragThreshold,
  findSourceAtScreen,
  getPointerInteractionType,
  sourcePositionFromPointer,
} from "./interaction.js";
import {
  createPotentialGridGeometry,
  extractContourSegments,
  potentialGridCanServeViewport,
  POTENTIAL_INTERACTIVE_SPACING_PIXELS,
  POTENTIAL_OVERSCAN_PIXELS,
  POTENTIAL_TARGET_SPACING_PIXELS,
} from "./potential-grid.js";
import {
  formatPointChargeNanocoulombs,
  MAX_POINT_CHARGE_NC,
  MIN_POINT_CHARGE_NC,
  normalizePointChargeNanocoulombs,
  snapPointChargeSliderNanocoulombs,
} from "./property-controls.js";
import { createVectorGrid, vectorSpacingPixels } from "./vector-grid.js";

const canvas = document.getElementById("fieldCanvas");
const stage = document.getElementById("stage");
const context = canvas.getContext("2d");
const hud = document.getElementById("hud");
const sourceControls = document.getElementById("sourceControls");
const selectedType = document.getElementById("selectedType");
const placementStatus = document.getElementById("placementStatus");
const minimap = document.getElementById("minimap");
const minimapContext = minimap.getContext("2d");
const zoomLevel = document.getElementById("zoomLevel");

const ui = {
  showVectors: document.getElementById("showVectors"),
  showLines: document.getElementById("showLines"),
  showPotential: document.getElementById("showPotential"),
  showEquip: document.getElementById("showEquip"),
  showGrid: document.getElementById("showGrid"),
  showParticles: document.getElementById("showParticles"),
  vectorDensity: document.getElementById("vectorDensity"),
  lineDensity: document.getElementById("lineDensity"),
  qOverM: document.getElementById("qOverM"),
  timeScale: document.getElementById("timeScale"),
  pauseBtn: document.getElementById("pauseBtn"),
};

let width = 900;
let height = 600;
let devicePixelRatio = 1;
const camera = new Camera2D({
  bounds: WORLD_BOUNDS,
  ...CAMERA_DEFAULTS,
});
let activePlacementTool = null;
let selectedId = null;
let interaction = null;
let inspectorAdjustmentActive = false;
let minimapDragging = false;
let sources = [];
let particles = [];
let sourceSamples = [];
let nextId = 1;
let fieldVectors = [];
let fieldLines = [];
let potentialGrid = null;
const potentialCanvas = document.createElement("canvas");
let potentialSceneVersion = 0;
let dirtySamples = true;
let dirtyVectors = true;
let dirtyLines = true;
let dirtyPotential = true;
let paused = false;
let lastTime = performance.now();
let lastHeavy = 0;
let viewportSizeDirty = true;

const VECTOR_GRID_OVERSCAN = 2;

const formatNumber = (value, digits = 2) =>
  Number.isFinite(value) ? value.toFixed(digits) : "—";
const signColor = (charge) => (charge >= 0 ? "#ff615a" : "#4aa3ff");

function scheduleViewportResize() {
  viewportSizeDirty = true;
}

function syncViewportSize() {
  if (!viewportSizeDirty) return;

  const bounds = stage.getBoundingClientRect();
  const nextDevicePixelRatio = Math.min(2, window.devicePixelRatio || 1);
  const nextWidth = Math.max(1, bounds.width);
  const nextHeight = Math.max(1, bounds.height);
  const nextCanvasWidth = Math.round(nextWidth * nextDevicePixelRatio);
  const nextCanvasHeight = Math.round(nextHeight * nextDevicePixelRatio);

  width = nextWidth;
  height = nextHeight;
  devicePixelRatio = nextDevicePixelRatio;
  if (canvas.width !== nextCanvasWidth) canvas.width = nextCanvasWidth;
  if (canvas.height !== nextCanvasHeight) canvas.height = nextCanvasHeight;
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  camera.setViewport(width, height);
  resizeMinimap();
  markViewportDirty();
  viewportSizeDirty = false;
}

function worldToScreen(x, y) {
  return camera.worldToScreen(x, y);
}

function screenToWorld(pixelX, pixelY) {
  return camera.screenToWorld(pixelX, pixelY);
}

function screenX(x) {
  return worldToScreen(x, camera.y).x;
}

function screenY(y) {
  return worldToScreen(camera.x, y).y;
}

function markAllDirty() {
  dirtySamples = true;
  dirtyVectors = true;
  dirtyLines = true;
  dirtyPotential = true;
}

function markGeometryDirty() {
  potentialSceneVersion += 1;
  markAllDirty();
}

function updateZoomLabel() {
  zoomLevel.textContent = `${Math.round(
    (camera.zoom / CAMERA_DEFAULTS.zoom) * 100,
  )}%`;
}

function markViewportDirty() {
  dirtyVectors = true;
  dirtyPotential = true;
  updateZoomLabel();
}

function sourceExtent(source) {
  if (source.type === "point") return { x: 0, y: 0 };
  const cos = Math.cos(source.angle);
  const sin = Math.sin(source.angle);
  if (source.type === "line") {
    return {
      x: (Math.abs(cos) * source.length) / 2,
      y: (Math.abs(sin) * source.length) / 2,
    };
  }
  return {
    x:
      (Math.abs(cos) * source.width + Math.abs(sin) * source.height) / 2,
    y:
      (Math.abs(sin) * source.width + Math.abs(cos) * source.height) / 2,
  };
}

function constrainSource(source) {
  const extent = sourceExtent(source);
  source.x = clamp(
    source.x,
    WORLD_BOUNDS.xmin + extent.x,
    WORLD_BOUNDS.xmax - extent.x,
  );
  source.y = clamp(
    source.y,
    WORLD_BOUNDS.ymin + extent.y,
    WORLD_BOUNDS.ymax - extent.y,
  );
  return source;
}

function sourceBounds(source) {
  const extent = sourceExtent(source);
  const pointMargin = source.type === "point" ? 0.18 : 0.08;
  return {
    xmin: source.x - extent.x - pointMargin,
    xmax: source.x + extent.x + pointMargin,
    ymin: source.y - extent.y - pointMargin,
    ymax: source.y + extent.y + pointMargin,
  };
}

function allSourceBounds() {
  if (!sources.length) return null;
  return sources.reduce(
    (bounds, source) => {
      const current = sourceBounds(source);
      return {
        xmin: Math.min(bounds.xmin, current.xmin),
        xmax: Math.max(bounds.xmax, current.xmax),
        ymin: Math.min(bounds.ymin, current.ymin),
        ymax: Math.max(bounds.ymax, current.ymax),
      };
    },
    {
      xmin: Infinity,
      xmax: -Infinity,
      ymin: Infinity,
      ymax: -Infinity,
    },
  );
}

function addPoint(x, y, chargeNanocoulombs) {
  const source = constrainSource({
    id: nextId++,
    type: "point",
    x,
    y,
    q: chargeNanocoulombs * 1e-9,
  });
  sources.push(source);
  markGeometryDirty();
  return source;
}

function addLine(x, y, densityNanocoulombs = 4) {
  const source = constrainSource({
    id: nextId++,
    type: "line",
    x,
    y,
    lambda: densityNanocoulombs * 1e-9,
    length: 1,
    angle: 0,
  });
  sources.push(source);
  markGeometryDirty();
  return source;
}

function addPlane(x, y, densityNanocoulombs = 4) {
  const source = constrainSource({
    id: nextId++,
    type: "plane",
    x,
    y,
    sigma: densityNanocoulombs * 1e-9,
    width: 1,
    height: 0.6,
    angle: 0,
  });
  sources.push(source);
  markGeometryDirty();
  return source;
}

function rebuildSamples() {
  sourceSamples = buildSourceSamples(sources);
  dirtySamples = false;
}

function electricField(x, y) {
  if (dirtySamples) rebuildSamples();
  return electricFieldAt(sourceSamples, x, y);
}

function electricPotential(x, y) {
  if (dirtySamples) rebuildSamples();
  return electricPotentialAt(sourceSamples, x, y);
}

function computeVectors() {
  if (!ui.showVectors.checked) {
    fieldVectors = [];
    dirtyVectors = false;
    return;
  }

  const visible = camera.getVisibleWorldBounds();
  const grid = createVectorGrid({
    visibleBounds: visible,
    worldBounds: WORLD_BOUNDS,
    zoom: camera.zoom,
    spacingPixels: vectorSpacingPixels(Number(ui.vectorDensity.value)),
    overscan: VECTOR_GRID_OVERSCAN,
  });
  const vectors = [];
  const magnitudes = [];

  for (let row = grid.firstRow; row <= grid.lastRow; row += 1) {
    for (
      let column = grid.firstColumn;
      column <= grid.lastColumn;
      column += 1
    ) {
      const positionX = column * grid.spacingWorld;
      const positionY = row * grid.spacingWorld;
      const field = electricField(positionX, positionY);

      if (Number.isFinite(field.mag) && field.mag > 1e-10) {
        vectors.push({
          positionX,
          positionY,
          fieldX: field.x,
          fieldY: field.y,
          magnitude: field.mag,
        });
        magnitudes.push(field.mag);
      }
    }
  }

  magnitudes.sort((a, b) => a - b);
  const low = Math.log10(
    (magnitudes[Math.floor(magnitudes.length * 0.12)] || 1) + 1,
  );
  const high = Math.log10(
    (magnitudes[Math.floor(magnitudes.length * 0.88)] || 10) + 1,
  );

  for (const vector of vectors) {
    const relativeMagnitude = clamp(
      (Math.log10(vector.magnitude + 1) - low) / Math.max(0.2, high - low),
      0,
      1,
    );
    vector.lengthPixels = 6 + 20 * relativeMagnitude;
  }

  fieldVectors = vectors;
  dirtyVectors = false;
}

function seedPointsForSource(source, density) {
  const points = [];

  if (source.type === "point") {
    const radius = 0.075;
    for (let index = 0; index < density; index += 1) {
      const angle = (2 * Math.PI * index) / density;
      points.push({
        x: source.x + radius * Math.cos(angle),
        y: source.y + radius * Math.sin(angle),
      });
    }
  } else if (source.type === "line") {
    const cos = Math.cos(source.angle);
    const sin = Math.sin(source.angle);
    const normalX = -sin;
    const normalY = cos;
    const count = Math.max(3, Math.round(density / 2));

    for (let index = 0; index < count; index += 1) {
      const offset = ((index + 0.5) / count - 0.5) * source.length;
      const baseX = source.x + offset * cos;
      const baseY = source.y + offset * sin;
      points.push({ x: baseX + 0.055 * normalX, y: baseY + 0.055 * normalY });
      points.push({ x: baseX - 0.055 * normalX, y: baseY - 0.055 * normalY });
    }
  } else if (source.type === "plane") {
    const cos = Math.cos(source.angle);
    const sin = Math.sin(source.angle);
    const count = Math.max(2, Math.round(density / 4));
    const localToWorld = (u, v) => ({
      x: source.x + u * cos - v * sin,
      y: source.y + u * sin + v * cos,
    });

    for (let index = 0; index < count; index += 1) {
      const offset = (index + 0.5) / count - 0.5;
      points.push(
        localToWorld(offset * source.width, source.height / 2 + 0.045),
      );
      points.push(
        localToWorld(offset * source.width, -source.height / 2 - 0.045),
      );
      points.push(
        localToWorld(source.width / 2 + 0.045, offset * source.height),
      );
      points.push(
        localToWorld(-source.width / 2 - 0.045, offset * source.height),
      );
    }
  }

  return points;
}

function nearOppositeSource(x, y, sign) {
  for (const source of sources) {
    const charge = sourceNetCharge(source);
    if (Math.sign(charge) === sign || charge === 0) continue;

    if (
      source.type === "point" &&
      Math.hypot(x - source.x, y - source.y) < 0.07
    ) {
      return true;
    }

    if (source.type === "line") {
      const cos = Math.cos(source.angle);
      const sin = Math.sin(source.angle);
      const localX = (x - source.x) * cos + (y - source.y) * sin;
      const localY = -(x - source.x) * sin + (y - source.y) * cos;
      if (
        Math.abs(localY) < 0.06 &&
        Math.abs(localX) < source.length / 2 + 0.03
      ) {
        return true;
      }
    }

    if (source.type === "plane") {
      const cos = Math.cos(source.angle);
      const sin = Math.sin(source.angle);
      const localX = (x - source.x) * cos + (y - source.y) * sin;
      const localY = -(x - source.x) * sin + (y - source.y) * cos;
      if (
        Math.abs(localX) < source.width / 2 + 0.04 &&
        Math.abs(localY) < source.height / 2 + 0.04
      ) {
        return true;
      }
    }
  }

  return false;
}

function traceLine(seed, outwardSign, sourceSign) {
  const points = [seed];
  let x = seed.x;
  let y = seed.y;
  const stepSize = 0.025;

  for (let step = 0; step < 900; step += 1) {
    const field = electricField(x, y);
    if (!Number.isFinite(field.mag) || field.mag < 1e-8) break;

    let deltaX = (outwardSign * field.x) / field.mag;
    let deltaY = (outwardSign * field.y) / field.mag;
    const midpointX = x + 0.5 * stepSize * deltaX;
    const midpointY = y + 0.5 * stepSize * deltaY;
    const midpointField = electricField(midpointX, midpointY);
    if (!Number.isFinite(midpointField.mag) || midpointField.mag < 1e-8) {
      break;
    }

    deltaX = (outwardSign * midpointField.x) / midpointField.mag;
    deltaY = (outwardSign * midpointField.y) / midpointField.mag;
    x += stepSize * deltaX;
    y += stepSize * deltaY;
    points.push({ x, y });

    if (
      x < WORLD_BOUNDS.xmin ||
      x > WORLD_BOUNDS.xmax ||
      y < WORLD_BOUNDS.ymin ||
      y > WORLD_BOUNDS.ymax
    ) {
      break;
    }
    if (step > 8 && nearOppositeSource(x, y, sourceSign)) break;
  }

  return points;
}

function computeFieldLines() {
  if (!ui.showLines.checked) {
    fieldLines = [];
    dirtyLines = false;
    return;
  }

  const density = Number(ui.lineDensity.value);
  const lines = [];

  for (const source of sources) {
    const charge = sourceNetCharge(source);
    if (Math.abs(charge) < 1e-20) continue;

    const sign = Math.sign(charge);
    const seeds = seedPointsForSource(source, density);
    for (const seed of seeds) {
      const points = traceLine(seed, sign > 0 ? 1 : -1, sign);
      if (points.length > 5) {
        lines.push({ points, reverseArrow: sign < 0 });
      }
    }
  }

  fieldLines = lines;
  dirtyLines = false;
}

function contourLevels(scale) {
  return [-0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8].map(
    (level) => level * scale,
  );
}

function ensurePotentialContours() {
  if (!potentialGrid || potentialGrid.contours) return;
  potentialGrid.contours = extractContourSegments(
    potentialGrid,
    contourLevels(potentialGrid.scale),
  );
}

function rebuildPotentialGrid(geometry) {
  const { columns, rows, bounds, spacingWorld } = geometry;
  const values = new Float64Array(columns * rows);
  const absoluteValues = [];

  for (let row = 0; row < rows; row += 1) {
    const y = bounds.ymax - row * spacingWorld;
    for (let column = 0; column < columns; column += 1) {
      const x = bounds.xmin + column * spacingWorld;
      const potential = electricPotential(x, y);
      values[row * columns + column] = potential;
      if (Number.isFinite(potential)) absoluteValues.push(Math.abs(potential));
    }
  }

  absoluteValues.sort((a, b) => a - b);
  const scale = Math.max(
    1e-9,
    absoluteValues[Math.floor(absoluteValues.length * 0.9)] || 1,
  );
  potentialGrid = {
    ...geometry,
    values,
    scale,
    contours: null,
    sceneVersion: potentialSceneVersion,
  };

  potentialCanvas.width = columns;
  potentialCanvas.height = rows;
  const potentialContext = potentialCanvas.getContext("2d");
  const image = potentialContext.createImageData(columns, rows);

  for (let index = 0; index < values.length; index += 1) {
    const normalized = Math.tanh(values[index] / scale);
    let red;
    let green;
    let blue;
    if (normalized >= 0) {
      red = 50 + 205 * normalized;
      green = 48 + 65 * (1 - normalized);
      blue = 65 + 35 * (1 - normalized);
    } else {
      const magnitude = -normalized;
      red = 42 + 35 * (1 - magnitude);
      green = 68 + 95 * (1 - magnitude);
      blue = 90 + 165 * magnitude;
    }
    image.data[index * 4] = clamp(red, 0, 255);
    image.data[index * 4 + 1] = clamp(green, 0, 255);
    image.data[index * 4 + 2] = clamp(blue, 0, 255);
    image.data[index * 4 + 3] = 220;
  }

  potentialContext.putImageData(image, 0, 0);
  if (ui.showEquip.checked) ensurePotentialContours();
  dirtyPotential = false;
}

function ensurePotentialGrid() {
  if (!(ui.showPotential.checked || ui.showEquip.checked)) {
    dirtyPotential = false;
    return;
  }

  const visibleBounds = camera.getVisibleWorldBounds();
  const targetSpacingPixels =
    interaction?.type === "source-drag" || inspectorAdjustmentActive
      ? POTENTIAL_INTERACTIVE_SPACING_PIXELS
      : POTENTIAL_TARGET_SPACING_PIXELS;
  const geometry = createPotentialGridGeometry({
    visibleBounds,
    zoom: camera.zoom,
    targetSpacingPixels,
    overscanCells: Math.ceil(
      POTENTIAL_OVERSCAN_PIXELS / targetSpacingPixels,
    ),
  });
  const canReuseGrid = potentialGridCanServeViewport(
    potentialGrid,
    visibleBounds,
    {
      zoom: camera.zoom,
      maximumSpacingPixels: geometry.spacingPixels * 1.25,
      sceneVersion: potentialSceneVersion,
    },
  );

  if (canReuseGrid) {
    if (ui.showEquip.checked) ensurePotentialContours();
    dirtyPotential = false;
    return;
  }

  rebuildPotentialGrid(geometry);
}

function chooseGridStep(targetPixels = 82) {
  const rawStep = targetPixels / camera.zoom;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const multiplier = [1, 2, 5, 10].find((value) => value >= normalized) || 10;
  return multiplier * magnitude;
}

function formatGridCoordinate(value, step) {
  const digits = Math.max(0, -Math.floor(Math.log10(step)));
  const normalized = Math.abs(value) < step * 1e-6 ? 0 : value;
  return normalized.toFixed(digits);
}

function drawGrid() {
  if (!ui.showGrid.checked) return;

  const visible = camera.getVisibleWorldBounds();
  const left = screenX(visible.xmin);
  const right = screenX(visible.xmax);
  const top = screenY(visible.ymax);
  const bottom = screenY(visible.ymin);
  const step = chooseGridStep();
  const firstX = Math.ceil((visible.xmin - step * 1e-8) / step) * step;
  const firstY = Math.ceil((visible.ymin - step * 1e-8) / step) * step;

  context.save();
  context.lineWidth = 1;
  context.strokeStyle = "rgba(140,160,195,.14)";
  for (let x = firstX; x <= visible.xmax + step * 1e-8; x += step) {
    context.beginPath();
    context.moveTo(screenX(x), top);
    context.lineTo(screenX(x), bottom);
    context.stroke();
  }
  for (let y = firstY; y <= visible.ymax + step * 1e-8; y += step) {
    context.beginPath();
    context.moveTo(left, screenY(y));
    context.lineTo(right, screenY(y));
    context.stroke();
  }

  context.strokeStyle = "rgba(210,225,245,.42)";
  context.lineWidth = 1.35;
  if (visible.ymin <= 0 && visible.ymax >= 0) {
    context.beginPath();
    context.moveTo(left, screenY(0));
    context.lineTo(right, screenY(0));
    context.stroke();
  }
  if (visible.xmin <= 0 && visible.xmax >= 0) {
    context.beginPath();
    context.moveTo(screenX(0), top);
    context.lineTo(screenX(0), bottom);
    context.stroke();
  }

  context.fillStyle = "rgba(188,204,229,.72)";
  context.font = "11px system-ui";
  context.textAlign = "center";
  context.textBaseline = "top";
  const labelY = clamp(screenY(0) + 6, top + 5, bottom - 15);
  for (let x = firstX; x <= visible.xmax + step * 1e-8; x += step) {
    context.fillText(formatGridCoordinate(x, step), screenX(x), labelY);
  }

  context.textAlign = "right";
  context.textBaseline = "middle";
  const labelX = clamp(screenX(0) - 7, left + 26, right - 5);
  for (let y = firstY; y <= visible.ymax + step * 1e-8; y += step) {
    if (Math.abs(y) < step * 1e-6) continue;
    context.fillText(formatGridCoordinate(y, step), labelX, screenY(y));
  }

  context.fillStyle = "rgba(125,211,252,.78)";
  context.textAlign = "right";
  context.textBaseline = "bottom";
  context.fillText("x [m]", right - 8, bottom - 7);
  context.save();
  context.translate(left + 10, top + 8);
  context.rotate(-Math.PI / 2);
  context.textAlign = "right";
  context.textBaseline = "top";
  context.fillText("y [m]", 0, 0);
  context.restore();
  context.restore();
}

function drawPotential() {
  if (!ui.showPotential.checked || !potentialGrid) return;

  const { bounds } = potentialGrid;
  const left = screenX(bounds.xmin);
  const top = screenY(bounds.ymax);
  const drawWidth = screenX(bounds.xmax) - left;
  const drawHeight = screenY(bounds.ymin) - top;
  context.save();
  context.imageSmoothingEnabled = true;
  context.globalAlpha = 0.78;
  context.drawImage(potentialCanvas, left, top, drawWidth, drawHeight);
  context.restore();

  context.save();
  context.fillStyle = "rgba(10,15,27,.72)";
  context.fillRect(12, 54, 162, 24);
  context.fillStyle = "#dbeafe";
  context.font = "12px system-ui";
  context.fillText(
    "Escala color: ±" + potentialGrid.scale.toExponential(2) + " V",
    20,
    70,
  );
  context.restore();
}

function drawEquipotentials() {
  if (!ui.showEquip.checked || !potentialGrid) return;
  ensurePotentialContours();

  context.save();
  context.lineWidth = 1.05;
  context.setLineDash([4, 4]);
  context.strokeStyle = "rgba(255,255,255,.62)";
  context.beginPath();
  for (const [from, to] of potentialGrid.contours) {
    context.moveTo(screenX(from.x), screenY(from.y));
    context.lineTo(screenX(to.x), screenY(to.y));
  }
  context.stroke();
  context.restore();
}

function drawArrowHead(
  x,
  y,
  deltaX,
  deltaY,
  size = 5,
  fill = "rgba(214,233,255,.82)",
) {
  const angle = Math.atan2(deltaY, deltaX);
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  context.fillStyle = fill;
  context.beginPath();
  context.moveTo(0, 0);
  context.lineTo(-size, -size * 0.55);
  context.lineTo(-size, size * 0.55);
  context.closePath();
  context.fill();
  context.restore();
}

function drawFieldLines() {
  if (!ui.showLines.checked) return;

  context.save();
  context.strokeStyle = "rgba(210,230,255,.55)";
  context.lineWidth = 1.1;

  for (const line of fieldLines) {
    const { points } = line;
    context.beginPath();
    context.moveTo(screenX(points[0].x), screenY(points[0].y));
    for (let index = 1; index < points.length; index += 1) {
      context.lineTo(screenX(points[index].x), screenY(points[index].y));
    }
    context.stroke();

    const index = Math.max(
      2,
      Math.min(points.length - 2, Math.floor(points.length * 0.55)),
    );
    const from = line.reverseArrow ? points[index + 1] : points[index - 1];
    const to = line.reverseArrow ? points[index - 1] : points[index + 1];
    drawArrowHead(
      screenX(points[index].x),
      screenY(points[index].y),
      screenX(to.x) - screenX(from.x),
      screenY(to.y) - screenY(from.y),
      5,
    );
  }
  context.restore();
}

function drawVectors() {
  if (!ui.showVectors.checked) return;

  context.save();
  context.lineWidth = 1.15;
  context.strokeStyle = "rgba(125,211,252,.82)";

  for (const vector of fieldVectors) {
    const x = screenX(vector.positionX);
    const y = screenY(vector.positionY);
    const unitX = vector.fieldX / vector.magnitude;
    const unitY = vector.fieldY / vector.magnitude;
    const deltaX = vector.lengthPixels * unitX;
    const deltaY = -vector.lengthPixels * unitY;
    context.beginPath();
    context.moveTo(x - deltaX * 0.35, y - deltaY * 0.35);
    context.lineTo(x + deltaX * 0.65, y + deltaY * 0.65);
    context.stroke();
    drawArrowHead(
      x + deltaX * 0.65,
      y + deltaY * 0.65,
      deltaX,
      deltaY,
      4,
      "rgba(125,211,252,.9)",
    );
  }
  context.restore();
}

function drawSource(source) {
  const selected = source.id === selectedId;
  const color = signColor(sourceNetCharge(source));
  context.save();

  if (source.type === "point") {
    const x = screenX(source.x);
    const y = screenY(source.y);
    const radius = 13;
    context.shadowColor = color;
    context.shadowBlur = selected ? 18 : 9;
    context.fillStyle = color;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = selected ? "#fff" : "rgba(255,255,255,.45)";
    context.lineWidth = selected ? 2.5 : 1;
    context.stroke();
    context.fillStyle = "#fff";
    context.font = "bold 17px system-ui";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(source.q >= 0 ? "+" : "−", x, y - 1);
    context.font = "11px system-ui";
    context.fillStyle = "#e8eefb";
    context.fillText((source.q / 1e-9).toFixed(1) + " nC", x, y + 25);
  } else if (source.type === "line") {
    const cos = Math.cos(source.angle);
    const sin = Math.sin(source.angle);
    const halfLength = source.length / 2;
    const start = {
      x: source.x - halfLength * cos,
      y: source.y - halfLength * sin,
    };
    const end = {
      x: source.x + halfLength * cos,
      y: source.y + halfLength * sin,
    };
    context.strokeStyle = color;
    context.lineWidth = 7;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(screenX(start.x), screenY(start.y));
    context.lineTo(screenX(end.x), screenY(end.y));
    context.stroke();
    context.strokeStyle = selected ? "#fff" : "rgba(255,255,255,.35)";
    context.lineWidth = selected ? 2 : 1;
    context.beginPath();
    context.moveTo(screenX(start.x), screenY(start.y));
    context.lineTo(screenX(end.x), screenY(end.y));
    context.stroke();
    context.fillStyle = "#e8eefb";
    context.font = "11px system-ui";
    context.textAlign = "center";
    context.fillText(
      "λ " + (source.lambda / 1e-9).toFixed(1) + " nC/m",
      screenX(source.x),
      screenY(source.y) - 13,
    );
  } else {
    const cos = Math.cos(source.angle);
    const sin = Math.sin(source.angle);
    const corners = [
      [-0.5, -0.5],
      [0.5, -0.5],
      [0.5, 0.5],
      [-0.5, 0.5],
    ].map(([localX, localY]) => {
      const x = localX * source.width;
      const y = localY * source.height;
      return {
        x: source.x + x * cos - y * sin,
        y: source.y + x * sin + y * cos,
      };
    });

    context.fillStyle = color + "44";
    context.strokeStyle = color;
    context.lineWidth = selected ? 3 : 2;
    context.beginPath();
    context.moveTo(screenX(corners[0].x), screenY(corners[0].y));
    for (let index = 1; index < 4; index += 1) {
      context.lineTo(screenX(corners[index].x), screenY(corners[index].y));
    }
    context.closePath();
    context.fill();
    context.stroke();

    context.save();
    context.clip();
    context.strokeStyle = color + "88";
    context.lineWidth = 1;
    const minimumX = Math.min(...corners.map((point) => screenX(point.x)));
    const maximumX = Math.max(...corners.map((point) => screenX(point.x)));
    const minimumY = Math.min(...corners.map((point) => screenY(point.y)));
    const maximumY = Math.max(...corners.map((point) => screenY(point.y)));
    for (
      let offset = minimumX - maximumY;
      offset < maximumX + maximumY;
      offset += 12
    ) {
      context.beginPath();
      context.moveTo(offset, minimumY);
      context.lineTo(offset + (maximumY - minimumY), maximumY);
      context.stroke();
    }
    context.restore();
    context.fillStyle = "#e8eefb";
    context.font = "11px system-ui";
    context.textAlign = "center";
    context.fillText(
      "σ " + (source.sigma / 1e-9).toFixed(1) + " nC/m²",
      screenX(source.x),
      screenY(source.y),
    );
  }

  context.restore();
}

function drawParticles() {
  if (!ui.showParticles.checked) return;

  context.save();
  for (const particle of particles) {
    if (particle.trail.length > 1) {
      context.strokeStyle = "rgba(126,231,135,.35)";
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(
        screenX(particle.trail[0].x),
        screenY(particle.trail[0].y),
      );
      for (let index = 1; index < particle.trail.length; index += 1) {
        context.lineTo(
          screenX(particle.trail[index].x),
          screenY(particle.trail[index].y),
        );
      }
      context.stroke();
    }
    context.fillStyle = "#7ee787";
    context.beginPath();
    context.arc(screenX(particle.x), screenY(particle.y), 4, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function updateParticles(realDeltaTime) {
  if (paused || !ui.showParticles.checked) return;

  const chargeOverMass = Number(ui.qOverM.value);
  const deltaTime =
    Math.min(0.004, (realDeltaTime / 1000) * 0.12) * Number(ui.timeScale.value);
  if (deltaTime <= 0) return;

  for (const particle of particles) {
    const field = electricField(particle.x, particle.y);
    let fieldX = field.x;
    let fieldY = field.y;
    const fieldCap = 1400;
    if (field.mag > fieldCap) {
      fieldX *= fieldCap / field.mag;
      fieldY *= fieldCap / field.mag;
    }
    particle.vx += chargeOverMass * fieldX * deltaTime;
    particle.vy += chargeOverMass * fieldY * deltaTime;

    const speed = Math.hypot(particle.vx, particle.vy);
    const maximumSpeed = 7;
    if (speed > maximumSpeed) {
      particle.vx *= maximumSpeed / speed;
      particle.vy *= maximumSpeed / speed;
    }

    particle.x += particle.vx * deltaTime;
    particle.y += particle.vy * deltaTime;
    const lastTrailPoint = particle.trail[particle.trail.length - 1];
    if (
      !particle.trail.length ||
      Math.hypot(particle.x - lastTrailPoint.x, particle.y - lastTrailPoint.y) >
        0.01
    ) {
      particle.trail.push({ x: particle.x, y: particle.y });
      if (particle.trail.length > 170) particle.trail.shift();
    }
  }

  particles = particles.filter(
    (particle) =>
      particle.x > WORLD_BOUNDS.xmin - 0.2 &&
      particle.x < WORLD_BOUNDS.xmax + 0.2 &&
      particle.y > WORLD_BOUNDS.ymin - 0.2 &&
      particle.y < WORLD_BOUNDS.ymax + 0.2,
  );
}

function maybeRecompute(now) {
  if (dirtySamples) rebuildSamples();
  if (dirtyVectors) computeVectors();
  if (dirtyPotential) ensurePotentialGrid();
  if (now - lastHeavy > 80) {
    if (dirtyLines) computeFieldLines();
    lastHeavy = now;
  }
}

function worldScreenRect() {
  const topLeft = worldToScreen(WORLD_BOUNDS.xmin, WORLD_BOUNDS.ymax);
  const bottomRight = worldToScreen(WORLD_BOUNDS.xmax, WORLD_BOUNDS.ymin);
  return {
    left: topLeft.x,
    top: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
}

function drawWorldSurface() {
  const rect = worldScreenRect();
  context.save();
  context.shadowColor = "rgba(67, 106, 153, .22)";
  context.shadowBlur = 22;
  context.fillStyle = "#070c16";
  context.fillRect(rect.left, rect.top, rect.width, rect.height);
  context.restore();
}

function clipToWorld() {
  const rect = worldScreenRect();
  context.beginPath();
  context.rect(rect.left, rect.top, rect.width, rect.height);
  context.clip();
}

function drawWorldBoundary() {
  const rect = worldScreenRect();
  context.save();
  context.strokeStyle = "rgba(126, 164, 211, .28)";
  context.lineWidth = 1.2;
  context.strokeRect(rect.left, rect.top, rect.width, rect.height);
  context.restore();
}

function chooseScaleLength(targetPixels = 92) {
  const rawLength = targetPixels / camera.zoom;
  const magnitude = 10 ** Math.floor(Math.log10(rawLength));
  const candidates = [1, 2, 5, 10].map((value) => value * magnitude);
  return candidates.reduce((best, value) =>
    Math.abs(value * camera.zoom - targetPixels) <
    Math.abs(best * camera.zoom - targetPixels)
      ? value
      : best,
  );
}

function drawScaleIndicator() {
  const physicalLength = chooseScaleLength();
  const pixelLength = physicalLength * camera.zoom;
  const x = width - pixelLength - 22;
  const y = height - 28;
  context.save();
  context.strokeStyle = "rgba(223,234,250,.82)";
  context.fillStyle = "rgba(223,234,250,.88)";
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(x, y);
  context.lineTo(x + pixelLength, y);
  context.moveTo(x, y - 4);
  context.lineTo(x, y + 4);
  context.moveTo(x + pixelLength, y - 4);
  context.lineTo(x + pixelLength, y + 4);
  context.stroke();
  context.font = "11px system-ui";
  context.textAlign = "center";
  context.fillText(
    `${formatGridCoordinate(physicalLength, physicalLength)} m`,
    x + pixelLength / 2,
    y - 8,
  );
  context.restore();
}

function resizeMinimap() {
  const bounds = minimap.getBoundingClientRect();
  const minimapWidth = Math.max(1, bounds.width);
  const minimapHeight = Math.max(1, bounds.height);
  minimap.width = Math.round(minimapWidth * devicePixelRatio);
  minimap.height = Math.round(minimapHeight * devicePixelRatio);
  minimapContext.setTransform(
    devicePixelRatio,
    0,
    0,
    devicePixelRatio,
    0,
    0,
  );
}

function minimapMetrics() {
  const widthPixels = minimap.clientWidth;
  const heightPixels = minimap.clientHeight;
  const padding = 9;
  const mapWidth = widthPixels - padding * 2;
  const mapHeight = heightPixels - padding * 2;
  return {
    widthPixels,
    heightPixels,
    padding,
    mapWidth,
    mapHeight,
    toX: (x) =>
      padding +
      ((x - WORLD_BOUNDS.xmin) / (WORLD_BOUNDS.xmax - WORLD_BOUNDS.xmin)) *
        mapWidth,
    toY: (y) =>
      padding +
      ((WORLD_BOUNDS.ymax - y) / (WORLD_BOUNDS.ymax - WORLD_BOUNDS.ymin)) *
        mapHeight,
  };
}

function drawMinimap() {
  const map = minimapMetrics();
  minimapContext.clearRect(0, 0, map.widthPixels, map.heightPixels);
  minimapContext.fillStyle = "rgba(6, 12, 23, .92)";
  minimapContext.fillRect(0, 0, map.widthPixels, map.heightPixels);
  minimapContext.fillStyle = "rgba(21, 33, 52, .9)";
  minimapContext.strokeStyle = "rgba(139, 166, 204, .38)";
  minimapContext.lineWidth = 1;
  minimapContext.fillRect(map.padding, map.padding, map.mapWidth, map.mapHeight);
  minimapContext.strokeRect(map.padding, map.padding, map.mapWidth, map.mapHeight);

  for (const source of sources) {
    const color = signColor(sourceNetCharge(source));
    minimapContext.fillStyle = color;
    minimapContext.strokeStyle = color;
    if (source.type === "point") {
      minimapContext.beginPath();
      minimapContext.arc(map.toX(source.x), map.toY(source.y), 2.6, 0, Math.PI * 2);
      minimapContext.fill();
    } else {
      const extent = sourceExtent(source);
      minimapContext.globalAlpha = 0.8;
      minimapContext.strokeRect(
        map.toX(source.x - extent.x),
        map.toY(source.y + extent.y),
        (extent.x * 2 * map.mapWidth) /
          (WORLD_BOUNDS.xmax - WORLD_BOUNDS.xmin),
        (extent.y * 2 * map.mapHeight) /
          (WORLD_BOUNDS.ymax - WORLD_BOUNDS.ymin),
      );
      minimapContext.globalAlpha = 1;
    }
  }

  const visible = camera.getVisibleBounds();
  const viewport = {
    xmin: Math.max(visible.xmin, WORLD_BOUNDS.xmin),
    xmax: Math.min(visible.xmax, WORLD_BOUNDS.xmax),
    ymin: Math.max(visible.ymin, WORLD_BOUNDS.ymin),
    ymax: Math.min(visible.ymax, WORLD_BOUNDS.ymax),
  };
  minimapContext.fillStyle = "rgba(125, 211, 252, .08)";
  minimapContext.strokeStyle = "rgba(125, 211, 252, .9)";
  minimapContext.lineWidth = 1.2;
  const viewportX = map.toX(viewport.xmin);
  const viewportY = map.toY(viewport.ymax);
  const viewportWidth = map.toX(viewport.xmax) - viewportX;
  const viewportHeight = map.toY(viewport.ymin) - viewportY;
  minimapContext.fillRect(viewportX, viewportY, viewportWidth, viewportHeight);
  minimapContext.strokeRect(viewportX, viewportY, viewportWidth, viewportHeight);
}

function render(now) {
  syncViewportSize();
  const deltaTime = now - lastTime;
  lastTime = now;
  updateParticles(deltaTime);
  maybeRecompute(now);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#030712";
  context.fillRect(0, 0, width, height);
  drawWorldSurface();
  context.save();
  clipToWorld();
  drawPotential();
  drawGrid();
  drawEquipotentials();
  drawFieldLines();
  drawVectors();
  for (const source of sources) drawSource(source);
  drawParticles();
  context.restore();
  drawWorldBoundary();
  drawScaleIndicator();
  drawMinimap();
  requestAnimationFrame(render);
}

function pointerPosition(event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    pixelX: event.clientX - bounds.left,
    pixelY: event.clientY - bounds.top,
  };
}

function hitTest(pixelX, pixelY) {
  return findSourceAtScreen(sources, pixelX, pixelY, {
    worldToScreen,
    zoom: camera.zoom,
  });
}

function isInsideWorld(x, y) {
  return (
    x >= WORLD_BOUNDS.xmin &&
    x <= WORLD_BOUNDS.xmax &&
    y >= WORLD_BOUNDS.ymin &&
    y <= WORLD_BOUNDS.ymax
  );
}

const placementToolLabels = {
  plus: "Carga positiva",
  minus: "Carga negativa",
  line: "Distribución lineal",
  plane: "Distribución superficial",
  particle: "Partícula de prueba",
};

function setPlacementTool(tool) {
  activePlacementTool = tool;
  document.querySelectorAll("[data-placement-tool]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.placementTool === activePlacementTool),
    );
  });
  canvas.classList.toggle("placement-active", activePlacementTool !== null);
  placementStatus.classList.toggle("active", activePlacementTool !== null);
  placementStatus.textContent = activePlacementTool
    ? `${placementToolLabels[activePlacementTool]} activa · clic derecho para colocar · Esc para cancelar.`
    : "Selecciona un elemento y colócalo con clic derecho.";
}

function placeActiveTool(pixelX, pixelY) {
  if (!activePlacementTool) return;

  const { x, y } = screenToWorld(pixelX, pixelY);
  if (!isInsideWorld(x, y)) return;

  if (activePlacementTool === "plus") {
    addPoint(x, y, 2);
  } else if (activePlacementTool === "minus") {
    addPoint(x, y, -2);
  } else if (activePlacementTool === "line") {
    addLine(x, y, 4);
  } else if (activePlacementTool === "plane") {
    addPlane(x, y, 4);
  } else if (activePlacementTool === "particle") {
    particles.push({ x, y, vx: 0, vy: 0, trail: [{ x, y }] });
  }
}

function moveInteractionSource(pointer) {
  if (interaction?.type !== "source-drag") return;
  const source = sources.find(
    (candidate) => candidate.id === interaction.sourceId,
  );
  if (!source) return;

  const position = sourcePositionFromPointer(
    pointer.pixelX,
    pointer.pixelY,
    {
      offsetX: interaction.sourceOffsetX,
      offsetY: interaction.sourceOffsetY,
      screenToWorld,
    },
  );
  source.x = position.x;
  source.y = position.y;
  constrainSource(source);
  markGeometryDirty();
  syncControlValues(source);
  hud.textContent = `Objeto en (${formatNumber(source.x, 2)}, ${formatNumber(source.y, 2)}) m`;
}

canvas.addEventListener("pointerdown", (event) => {
  if (interaction) return;

  const interactionType = getPointerInteractionType(event);
  if (!interactionType) return;

  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  const pointer = pointerPosition(event);
  const source =
    interactionType === "selection-pending"
      ? hitTest(pointer.pixelX, pointer.pixelY)
      : null;
  const worldPosition = source
    ? screenToWorld(pointer.pixelX, pointer.pixelY)
    : null;
  interaction = {
    type: interactionType,
    pointerId: event.pointerId,
    startPixelX: pointer.pixelX,
    startPixelY: pointer.pixelY,
    lastPixelX: pointer.pixelX,
    lastPixelY: pointer.pixelY,
    sourceId: source?.id ?? null,
    sourceOffsetX: source ? worldPosition.x - source.x : 0,
    sourceOffsetY: source ? worldPosition.y - source.y : 0,
  };
});

canvas.addEventListener("pointermove", (event) => {
  const pointer = pointerPosition(event);
  if (
    interaction?.pointerId === event.pointerId &&
    interaction.type === "selection-pending" &&
    exceedsDragThreshold(
      interaction.startPixelX,
      interaction.startPixelY,
      pointer.pixelX,
      pointer.pixelY,
    )
  ) {
    if (interaction.sourceId !== null) {
      interaction.type = "source-drag";
      selectedId = interaction.sourceId;
      canvas.classList.add("moving-source");
      updateControls();
      moveInteractionSource(pointer);
    } else {
      interaction.type = "selection-cancelled";
    }
    return;
  }

  if (
    interaction?.pointerId === event.pointerId &&
    interaction.type === "pan-pending" &&
    exceedsDragThreshold(
      interaction.startPixelX,
      interaction.startPixelY,
      pointer.pixelX,
      pointer.pixelY,
    )
  ) {
    interaction.type = "pan";
    canvas.classList.add("panning");
    camera.panByPixels(
      pointer.pixelX - interaction.startPixelX,
      pointer.pixelY - interaction.startPixelY,
    );
    interaction.lastPixelX = pointer.pixelX;
    interaction.lastPixelY = pointer.pixelY;
    markViewportDirty();
    hud.textContent = `Vista centrada en (${formatNumber(camera.x, 2)}, ${formatNumber(camera.y, 2)}) m`;
    return;
  }

  if (
    interaction?.type === "pan" &&
    interaction.pointerId === event.pointerId
  ) {
    camera.panByPixels(
      pointer.pixelX - interaction.lastPixelX,
      pointer.pixelY - interaction.lastPixelY,
    );
    interaction.lastPixelX = pointer.pixelX;
    interaction.lastPixelY = pointer.pixelY;
    markViewportDirty();
    hud.textContent = `Vista centrada en (${formatNumber(camera.x, 2)}, ${formatNumber(camera.y, 2)}) m`;
    return;
  }

  if (
    interaction?.type === "source-drag" &&
    interaction.pointerId === event.pointerId
  ) {
    moveInteractionSource(pointer);
    return;
  }

  const { x, y } = screenToWorld(pointer.pixelX, pointer.pixelY);
  const field = electricField(x, y);
  const potential = electricPotential(x, y);

  hud.innerHTML =
    "x=" +
    formatNumber(x, 3) +
    " m, y=" +
    formatNumber(y, 3) +
    " m &nbsp; | &nbsp; <b>|E|=" +
    field.mag.toExponential(3) +
    " N/C</b> &nbsp; Eₓ=" +
    field.x.toExponential(2) +
    ", Eᵧ=" +
    field.y.toExponential(2) +
    " &nbsp; | &nbsp; <b>V=" +
    potential.toExponential(3) +
    " V</b>";
});

function clearPointerInteraction() {
  const completedSourceDrag = interaction?.type === "source-drag";
  if (
    interaction &&
    canvas.hasPointerCapture?.(interaction.pointerId)
  ) {
    canvas.releasePointerCapture(interaction.pointerId);
  }
  interaction = null;
  canvas.classList.remove("panning");
  canvas.classList.remove("moving-source");
  if (completedSourceDrag) dirtyPotential = true;
}

canvas.addEventListener("pointerup", (event) => {
  if (!interaction || interaction.pointerId !== event.pointerId) return;

  const pointer = pointerPosition(event);
  if (
    interaction.type === "selection-pending" &&
    !exceedsDragThreshold(
      interaction.startPixelX,
      interaction.startPixelY,
      pointer.pixelX,
      pointer.pixelY,
    )
  ) {
    const hit = hitTest(pointer.pixelX, pointer.pixelY);
    selectedId = hit?.id ?? null;
    updateControls();
  }

  clearPointerInteraction();
});
canvas.addEventListener("pointercancel", clearPointerInteraction);
canvas.addEventListener("lostpointercapture", () => {
  if (interaction) clearPointerInteraction();
});
canvas.addEventListener("mouseleave", () => {
  if (!interaction) {
    hud.innerHTML = "Mueve el cursor para medir <b>E</b> y <b>V</b>.";
  }
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  const pointer = pointerPosition(event);
  placeActiveTool(pointer.pixelX, pointer.pixelY);
});

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const pointer = pointerPosition(event);
    const delta =
      event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : 1);
    const factor = Math.exp(-delta * 0.0015);
    camera.zoomAt(
      pointer.pixelX,
      pointer.pixelY,
      camera.zoom * factor,
    );
    markViewportDirty();
  },
  { passive: false },
);

function resetCamera() {
  camera.reset();
  markViewportDirty();
}

function fitAllSources() {
  const bounds = allSourceBounds();
  if (bounds) camera.fitBounds(bounds, { padding: 64, minimumSpan: 1.2 });
  else camera.reset();
  markViewportDirty();
}

function zoomFromCenter(factor) {
  camera.zoomAt(width / 2, height / 2, camera.zoom * factor);
  markViewportDirty();
}

document.getElementById("homeView").addEventListener("click", resetCamera);
document.getElementById("fitView").addEventListener("click", fitAllSources);
document
  .getElementById("zoomIn")
  .addEventListener("click", () => zoomFromCenter(1.25));
document
  .getElementById("zoomOut")
  .addEventListener("click", () => zoomFromCenter(1 / 1.25));

function centerCameraFromMinimap(event) {
  const rect = minimap.getBoundingClientRect();
  const map = minimapMetrics();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const normalizedX = clamp((localX - map.padding) / map.mapWidth, 0, 1);
  const normalizedY = clamp((localY - map.padding) / map.mapHeight, 0, 1);
  camera.setCenter(
    WORLD_BOUNDS.xmin + normalizedX * (WORLD_BOUNDS.xmax - WORLD_BOUNDS.xmin),
    WORLD_BOUNDS.ymax - normalizedY * (WORLD_BOUNDS.ymax - WORLD_BOUNDS.ymin),
  );
  markViewportDirty();
}

minimap.addEventListener("pointerdown", (event) => {
  event.preventDefault();
  minimapDragging = true;
  minimap.setPointerCapture(event.pointerId);
  centerCameraFromMinimap(event);
});
minimap.addEventListener("pointermove", (event) => {
  if (minimapDragging) centerCameraFromMinimap(event);
});
minimap.addEventListener("pointerup", () => {
  minimapDragging = false;
});
minimap.addEventListener("pointercancel", () => {
  minimapDragging = false;
});

document.querySelectorAll("[data-placement-tool]").forEach((button) => {
  button.addEventListener("click", () => {
    const requestedTool = button.dataset.placementTool;
    setPlacementTool(
      requestedTool === activePlacementTool ? null : requestedTool,
    );
  });
});

function sliderRow(label, property, min, max, step, value, formatValue) {
  return (
    '<div class="row"><label>' +
    label +
    '</label><input type="range" data-prop="' +
    property +
    '" min="' +
    min +
    '" max="' +
    max +
    '" step="' +
    step +
    '" value="' +
    value +
    '"><span class="val" data-val="' +
    property +
    '">' +
    formatValue(value) +
    "</span></div>"
  );
}

function pointChargeControl(source) {
  const chargeNanocoulombs = source.q / 1e-9;
  return (
    '<div class="propertyGroup chargeProperty">' +
    '<div class="propertyHeader"><span>Carga q</span><strong data-val="qNC">' +
    formatPointChargeNanocoulombs(chargeNanocoulombs) +
    "</strong></div>" +
    '<input class="chargeSlider" type="range" data-prop="qNC" min="' +
    MIN_POINT_CHARGE_NC +
    '" max="' +
    MAX_POINT_CHARGE_NC +
    '" step="0.1" value="' +
    chargeNanocoulombs +
    '" aria-label="Carga en nanocoulombs">' +
    '<div class="rangeTicks" aria-hidden="true"><span>−10</span><span>−5</span><span>0</span><span>5</span><span>10</span></div>' +
    '<div class="numericEntry"><label>q</label><input type="number" data-prop="qNC" min="' +
    MIN_POINT_CHARGE_NC +
    '" max="' +
    MAX_POINT_CHARGE_NC +
    '" step="0.1" value="' +
    chargeNanocoulombs +
    '"><span>nC</span></div></div>'
  );
}

function positionReadout(source) {
  return (
    '<div class="propertyGroup positionProperty">' +
    '<div class="propertyHeading">Posición</div>' +
    '<div class="coordinateReadout"><span>x</span><output data-position="x">' +
    source.x.toFixed(3) +
    ' m</output><span>y</span><output data-position="y">' +
    source.y.toFixed(3) +
    " m</output></div>" +
    '<div class="directManipulationHint"><span class="kbd">Ctrl + arrastrar</span> para mover</div></div>'
  );
}

function sourceTypeName(source) {
  if (source.type === "point") {
    const sign = source.q > 0 ? "positiva" : source.q < 0 ? "negativa" : "neutra";
    return `Carga puntual ${sign}`;
  }
  return source.type === "line"
    ? "Distribución lineal"
    : "Distribución plana";
}

function updateControls() {
  const source = sources.find((candidate) => candidate.id === selectedId);
  if (!source) {
    selectedType.textContent = "Sin selección";
    sourceControls.innerHTML =
      '<div class="small emptyInspector">Usa <span class="kbd">Ctrl + clic</span> sobre un objeto para editarlo.</div>';
    return;
  }

  selectedType.textContent = sourceTypeName(source) + " #" + source.id;

  let html = "";
  if (source.type === "point") {
    html += pointChargeControl(source);
  } else if (source.type === "line") {
    html += sliderRow(
      "λ",
      "lambdaNCm",
      -12,
      12,
      0.1,
      source.lambda / 1e-9,
      (value) => Number(value).toFixed(1) + " nC/m",
    );
    html += sliderRow(
      "Longitud",
      "length",
      0.2,
      2.5,
      0.02,
      source.length,
      (value) => Number(value).toFixed(2) + " m",
    );
    html += sliderRow(
      "Ángulo",
      "angleDeg",
      -180,
      180,
      1,
      (source.angle * 180) / Math.PI,
      (value) => Math.round(value) + "°",
    );
  } else {
    html += sliderRow(
      "σ",
      "sigmaNCm2",
      -15,
      15,
      0.1,
      source.sigma / 1e-9,
      (value) => Number(value).toFixed(1) + " nC/m²",
    );
    html += sliderRow(
      "Ancho",
      "width",
      0.2,
      2.3,
      0.02,
      source.width,
      (value) => Number(value).toFixed(2) + " m",
    );
    html += sliderRow(
      "Alto",
      "height",
      0.15,
      1.5,
      0.02,
      source.height,
      (value) => Number(value).toFixed(2) + " m",
    );
    html += sliderRow(
      "Ángulo",
      "angleDeg",
      -180,
      180,
      1,
      (source.angle * 180) / Math.PI,
      (value) => Math.round(value) + "°",
    );
  }

  html += positionReadout(source);
  html +=
    '<div class="row"><button id="deleteSelected" class="danger">Eliminar seleccionado</button></div>';
  sourceControls.innerHTML = html;

  const applyInspectorValue = (input) => {
    const property = input.dataset.prop;
    let value = Number(input.value);
    if (property === "qNC") {
      value =
        input.type === "range"
          ? snapPointChargeSliderNanocoulombs(value)
          : normalizePointChargeNanocoulombs(value);
      if (value === null) {
        syncControlValues(source);
        return;
      }
      source.q = value * 1e-9;
    } else if (property === "lambdaNCm") {
      source.lambda = value * 1e-9;
    } else if (property === "sigmaNCm2") {
      source.sigma = value * 1e-9;
    } else if (property === "angleDeg") {
      source.angle = (value * Math.PI) / 180;
    } else {
      source[property] = value;
    }
    constrainSource(source);
    markGeometryDirty();
    syncControlValues(source);
  };

  sourceControls
    .querySelectorAll('input[type="range"][data-prop]')
    .forEach((input) => {
      input.addEventListener("pointerdown", () => {
        inspectorAdjustmentActive = true;
      });
      input.addEventListener("input", () => {
        applyInspectorValue(input);
      });
      input.addEventListener("change", () => {
        inspectorAdjustmentActive = false;
        dirtyPotential = true;
      });
    });
  sourceControls
    .querySelectorAll('input[type="number"][data-prop]')
    .forEach((input) => {
      input.addEventListener("change", () => applyInspectorValue(input));
      input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") input.blur();
      });
    });

  document.getElementById("deleteSelected").addEventListener("click", () => {
    sources = sources.filter((candidate) => candidate.id !== selectedId);
    selectedId = null;
    markGeometryDirty();
    updateControls();
  });
}

function syncControlValues(source) {
  const setControl = (property, value, text) => {
    const inputs = sourceControls.querySelectorAll(
      'input[data-prop="' + property + '"]',
    );
    const output = sourceControls.querySelector(
      '[data-val="' + property + '"]',
    );
    inputs.forEach((input) => {
      input.value = value;
    });
    if (output) output.textContent = text;
  };

  const positionX = sourceControls.querySelector('[data-position="x"]');
  const positionY = sourceControls.querySelector('[data-position="y"]');
  if (positionX) positionX.textContent = source.x.toFixed(3) + " m";
  if (positionY) positionY.textContent = source.y.toFixed(3) + " m";
  selectedType.textContent = sourceTypeName(source) + " #" + source.id;

  if (source.type === "point") {
    setControl(
      "qNC",
      source.q / 1e-9,
      formatPointChargeNanocoulombs(source.q / 1e-9),
    );
  }
  if (source.type === "line") {
    setControl(
      "lambdaNCm",
      source.lambda / 1e-9,
      (source.lambda / 1e-9).toFixed(1) + " nC/m",
    );
    setControl("length", source.length, source.length.toFixed(2) + " m");
    setControl(
      "angleDeg",
      (source.angle * 180) / Math.PI,
      Math.round((source.angle * 180) / Math.PI) + "°",
    );
  }
  if (source.type === "plane") {
    setControl(
      "sigmaNCm2",
      source.sigma / 1e-9,
      (source.sigma / 1e-9).toFixed(1) + " nC/m²",
    );
    setControl("width", source.width, source.width.toFixed(2) + " m");
    setControl("height", source.height, source.height.toFixed(2) + " m");
    setControl(
      "angleDeg",
      (source.angle * 180) / Math.PI,
      Math.round((source.angle * 180) / Math.PI) + "°",
    );
  }
}

function loadPreset(name) {
  sources = [];
  particles = [];
  selectedId = null;

  if (name === "dipole") {
    addPoint(-0.55, 0, 3);
    addPoint(0.55, 0, -3);
  }
  if (name === "equal") {
    addPoint(-0.55, 0, 3);
    addPoint(0.55, 0, 3);
  }
  if (name === "linePair") {
    const positive = addLine(-0.55, 0, 5);
    positive.angle = Math.PI / 2;
    positive.length = 1.6;
    const negative = addLine(0.55, 0, -5);
    negative.angle = Math.PI / 2;
    negative.length = 1.6;
  }
  if (name === "plates") {
    const positive = addPlane(-0.55, 0, 5);
    positive.width = 0.28;
    positive.height = 1.65;
    const negative = addPlane(0.55, 0, -5);
    negative.width = 0.28;
    negative.height = 1.65;
  }

  selectedId = null;
  markGeometryDirty();
  updateControls();
}

document.querySelectorAll("[data-preset]").forEach((button) => {
  button.addEventListener("click", () => loadPreset(button.dataset.preset));
});

document.getElementById("resetBtn").addEventListener("click", () => {
  loadPreset("dipole");
  resetCamera();
});
document.getElementById("clearParticles").addEventListener("click", () => {
  particles = [];
});
ui.pauseBtn.addEventListener("click", () => {
  paused = !paused;
  ui.pauseBtn.textContent = paused
    ? "▶ Reanudar partículas"
    : "⏸ Pausar partículas";
});

["showVectors", "showLines", "showPotential", "showEquip", "showGrid"].forEach(
  (key) => {
    ui[key].addEventListener("change", () => {
      if (key === "showVectors") dirtyVectors = true;
      if (key === "showLines") dirtyLines = true;
      if (key === "showPotential" || key === "showEquip") dirtyPotential = true;
    });
  },
);

ui.vectorDensity.addEventListener("input", () => {
  document.getElementById("vectorDensityVal").textContent =
    ui.vectorDensity.value;
  dirtyVectors = true;
});
ui.lineDensity.addEventListener("input", () => {
  document.getElementById("lineDensityVal").textContent = ui.lineDensity.value;
  dirtyLines = true;
});
ui.qOverM.addEventListener("input", () => {
  document.getElementById("qOverMVal").textContent =
    Number(ui.qOverM.value).toFixed(1) + " C/kg";
});
ui.timeScale.addEventListener("input", () => {
  document.getElementById("timeScaleVal").textContent =
    Number(ui.timeScale.value).toFixed(1) + "×";
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && activePlacementTool !== null) {
    event.preventDefault();
    setPlacementTool(null);
  }
  if (
    (event.key === "Delete" || event.key === "Backspace") &&
    selectedId !== null &&
    !event.target.matches("input, textarea, select, button")
  ) {
    sources = sources.filter((source) => source.id !== selectedId);
    selectedId = null;
    markGeometryDirty();
    updateControls();
  }
});

window.addEventListener("pointerup", () => {
  if (inspectorAdjustmentActive) {
    inspectorAdjustmentActive = false;
    dirtyPotential = true;
  }
});

window.addEventListener("blur", () => {
  if (inspectorAdjustmentActive) dirtyPotential = true;
  inspectorAdjustmentActive = false;
  clearPointerInteraction();
});

new ResizeObserver(scheduleViewportResize).observe(stage);
window.addEventListener("resize", scheduleViewportResize);
loadPreset("dipole");
setPlacementTool(null);
scheduleViewportResize();
requestAnimationFrame(render);
