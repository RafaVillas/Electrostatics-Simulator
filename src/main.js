import {
  buildSourceSamples,
  clamp,
  electricFieldAt,
  electricPotentialAt,
  sourceNetCharge,
} from "./physics.js";

const canvas = document.getElementById("fieldCanvas");
const stage = document.getElementById("stage");
const context = canvas.getContext("2d");
const hud = document.getElementById("hud");
const sourceControls = document.getElementById("sourceControls");
const selectedType = document.getElementById("selectedType");

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
let world = { xmin: -2.25, xmax: 2.25, ymin: -1.5, ymax: 1.5 };
let mode = "select";
let selectedId = null;
let drag = null;
let sources = [];
let particles = [];
let sourceSamples = [];
let nextId = 1;
let fieldVectors = [];
let fieldLines = [];
let potentialGrid = null;
const potentialCanvas = document.createElement("canvas");
let dirtySamples = true;
let dirtyVectors = true;
let dirtyLines = true;
let dirtyPotential = true;
let paused = false;
let lastTime = performance.now();
let lastHeavy = 0;

const formatNumber = (value, digits = 2) =>
  Number.isFinite(value) ? value.toFixed(digits) : "—";
const signColor = (charge) => (charge >= 0 ? "#ff615a" : "#4aa3ff");

function resize() {
  const bounds = stage.getBoundingClientRect();
  devicePixelRatio = Math.min(2, window.devicePixelRatio || 1);
  width = Math.max(320, bounds.width);
  height = Math.max(320, bounds.height);
  canvas.width = Math.round(width * devicePixelRatio);
  canvas.height = Math.round(height * devicePixelRatio);
  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

  const halfY = 1.5;
  const halfX = halfY * (width / height);
  world = { xmin: -halfX, xmax: halfX, ymin: -halfY, ymax: halfY };
  markAllDirty();
}

function screenX(x) {
  return ((x - world.xmin) / (world.xmax - world.xmin)) * width;
}

function screenY(y) {
  return height - ((y - world.ymin) / (world.ymax - world.ymin)) * height;
}

function worldX(pixelX) {
  return world.xmin + (pixelX / width) * (world.xmax - world.xmin);
}

function worldY(pixelY) {
  return world.ymin + ((height - pixelY) / height) * (world.ymax - world.ymin);
}

function markAllDirty() {
  dirtySamples = true;
  dirtyVectors = true;
  dirtyLines = true;
  dirtyPotential = true;
}

function markGeometryDirty() {
  markAllDirty();
}

function addPoint(x, y, chargeNanocoulombs) {
  const source = {
    id: nextId++,
    type: "point",
    x,
    y,
    q: chargeNanocoulombs * 1e-9,
  };
  sources.push(source);
  selectedId = source.id;
  markGeometryDirty();
  updateControls();
  return source;
}

function addLine(x, y, densityNanocoulombs = 4) {
  const source = {
    id: nextId++,
    type: "line",
    x,
    y,
    lambda: densityNanocoulombs * 1e-9,
    length: 1,
    angle: 0,
  };
  sources.push(source);
  selectedId = source.id;
  markGeometryDirty();
  updateControls();
  return source;
}

function addPlane(x, y, densityNanocoulombs = 4) {
  const source = {
    id: nextId++,
    type: "plane",
    x,
    y,
    sigma: densityNanocoulombs * 1e-9,
    width: 1,
    height: 0.6,
    angle: 0,
  };
  sources.push(source);
  selectedId = source.id;
  markGeometryDirty();
  updateControls();
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

  const columns = Number(ui.vectorDensity.value);
  const rows = Math.max(8, Math.round((columns * height) / width));
  const vectors = [];
  const magnitudes = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const positionX =
        world.xmin + ((column + 0.5) / columns) * (world.xmax - world.xmin);
      const positionY =
        world.ymin + ((row + 0.5) / rows) * (world.ymax - world.ymin);
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
  const stepSize = 0.022;

  for (let step = 0; step < 320; step += 1) {
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
      x < world.xmin - 0.05 ||
      x > world.xmax + 0.05 ||
      y < world.ymin - 0.05 ||
      y > world.ymax + 0.05
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

function computePotential() {
  if (!(ui.showPotential.checked || ui.showEquip.checked)) {
    potentialGrid = null;
    dirtyPotential = false;
    return;
  }

  const columns = 96;
  const rows = Math.max(56, Math.round((columns * height) / width));
  const values = new Float64Array(columns * rows);
  const absoluteValues = [];

  for (let row = 0; row < rows; row += 1) {
    const y = world.ymax - (row / (rows - 1)) * (world.ymax - world.ymin);
    for (let column = 0; column < columns; column += 1) {
      const x =
        world.xmin + (column / (columns - 1)) * (world.xmax - world.xmin);
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
  potentialGrid = { columns, rows, values, scale };

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
  dirtyPotential = false;
}
function drawGrid() {
  if (!ui.showGrid.checked) return;

  context.save();
  context.lineWidth = 1;
  context.strokeStyle = "rgba(140,160,195,.13)";
  const step = 0.25;

  for (
    let x = Math.ceil(world.xmin / step) * step;
    x <= world.xmax;
    x += step
  ) {
    context.beginPath();
    context.moveTo(screenX(x), 0);
    context.lineTo(screenX(x), height);
    context.stroke();
  }
  for (
    let y = Math.ceil(world.ymin / step) * step;
    y <= world.ymax;
    y += step
  ) {
    context.beginPath();
    context.moveTo(0, screenY(y));
    context.lineTo(width, screenY(y));
    context.stroke();
  }

  context.strokeStyle = "rgba(210,225,245,.35)";
  context.beginPath();
  context.moveTo(0, screenY(0));
  context.lineTo(width, screenY(0));
  context.stroke();
  context.beginPath();
  context.moveTo(screenX(0), 0);
  context.lineTo(screenX(0), height);
  context.stroke();
  context.restore();
}

function drawPotential() {
  if (!ui.showPotential.checked || !potentialGrid) return;

  context.save();
  context.imageSmoothingEnabled = true;
  context.globalAlpha = 0.78;
  context.drawImage(potentialCanvas, 0, 0, width, height);
  context.restore();

  context.save();
  context.fillStyle = "rgba(10,15,27,.72)";
  context.fillRect(12, 12, 162, 24);
  context.fillStyle = "#dbeafe";
  context.font = "12px system-ui";
  context.fillText(
    "Escala color: ±" + potentialGrid.scale.toExponential(2) + " V",
    20,
    28,
  );
  context.restore();
}

function interpolateEdge(x1, y1, value1, x2, y2, value2, level) {
  const difference = value2 - value1;
  const factor =
    Math.abs(difference) < 1e-30
      ? 0.5
      : clamp((level - value1) / difference, 0, 1);
  return {
    x: x1 + factor * (x2 - x1),
    y: y1 + factor * (y2 - y1),
  };
}

function drawEquipotentials() {
  if (!ui.showEquip.checked || !potentialGrid) return;

  const { columns, rows, values, scale } = potentialGrid;
  const levels = [-0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8].map(
    (level) => level * scale,
  );

  context.save();
  context.lineWidth = 1.05;
  context.setLineDash([4, 4]);
  context.strokeStyle = "rgba(255,255,255,.62)";

  for (const level of levels) {
    context.beginPath();
    for (let row = 0; row < rows - 1; row += 1) {
      for (let column = 0; column < columns - 1; column += 1) {
        const index = row * columns + column;
        const value0 = values[index];
        const value1 = values[index + 1];
        const value2 = values[index + 1 + columns];
        const value3 = values[index + columns];
        const x0 = (column / (columns - 1)) * width;
        const x1 = ((column + 1) / (columns - 1)) * width;
        const y0 = (row / (rows - 1)) * height;
        const y1 = ((row + 1) / (rows - 1)) * height;
        const points = [];

        if ((value0 - level) * (value1 - level) < 0) {
          points.push(interpolateEdge(x0, y0, value0, x1, y0, value1, level));
        }
        if ((value1 - level) * (value2 - level) < 0) {
          points.push(interpolateEdge(x1, y0, value1, x1, y1, value2, level));
        }
        if ((value2 - level) * (value3 - level) < 0) {
          points.push(interpolateEdge(x1, y1, value2, x0, y1, value3, level));
        }
        if ((value3 - level) * (value0 - level) < 0) {
          points.push(interpolateEdge(x0, y1, value3, x0, y0, value0, level));
        }

        if (points.length === 2) {
          context.moveTo(points[0].x, points[0].y);
          context.lineTo(points[1].x, points[1].y);
        } else if (points.length === 4) {
          context.moveTo(points[0].x, points[0].y);
          context.lineTo(points[1].x, points[1].y);
          context.moveTo(points[2].x, points[2].y);
          context.lineTo(points[3].x, points[3].y);
        }
      }
    }
    context.stroke();
  }
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
      particle.x > world.xmin - 0.2 &&
      particle.x < world.xmax + 0.2 &&
      particle.y > world.ymin - 0.2 &&
      particle.y < world.ymax + 0.2,
  );
}

function maybeRecompute(now) {
  if (dirtySamples) rebuildSamples();
  if (dirtyVectors) computeVectors();
  if (now - lastHeavy > 65) {
    if (dirtyLines) computeFieldLines();
    if (dirtyPotential) computePotential();
    lastHeavy = now;
  }
}

function render(now) {
  const deltaTime = now - lastTime;
  lastTime = now;
  updateParticles(deltaTime);
  maybeRecompute(now);
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#070c16";
  context.fillRect(0, 0, width, height);
  drawPotential();
  drawGrid();
  drawEquipotentials();
  drawFieldLines();
  drawVectors();
  for (const source of sources) drawSource(source);
  drawParticles();
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
  for (let index = sources.length - 1; index >= 0; index -= 1) {
    const source = sources[index];

    if (source.type === "point") {
      if (
        Math.hypot(pixelX - screenX(source.x), pixelY - screenY(source.y)) < 18
      ) {
        return source;
      }
    } else if (source.type === "line") {
      const cos = Math.cos(source.angle);
      const sin = Math.sin(source.angle);
      const halfLength = source.length / 2;
      const startX = screenX(source.x - halfLength * cos);
      const startY = screenY(source.y - halfLength * sin);
      const endX = screenX(source.x + halfLength * cos);
      const endY = screenY(source.y + halfLength * sin);
      const segmentX = endX - startX;
      const segmentY = endY - startY;
      const pointerX = pixelX - startX;
      const pointerY = pixelY - startY;
      const factor = clamp(
        (pointerX * segmentX + pointerY * segmentY) /
          (segmentX * segmentX + segmentY * segmentY),
        0,
        1,
      );

      if (
        Math.hypot(
          pixelX - (startX + factor * segmentX),
          pixelY - (startY + factor * segmentY),
        ) < 12
      ) {
        return source;
      }
    } else {
      const x = worldX(pixelX);
      const y = worldY(pixelY);
      const cos = Math.cos(source.angle);
      const sin = Math.sin(source.angle);
      const localX = (x - source.x) * cos + (y - source.y) * sin;
      const localY = -(x - source.x) * sin + (y - source.y) * cos;
      if (
        Math.abs(localX) <= source.width / 2 &&
        Math.abs(localY) <= source.height / 2
      ) {
        return source;
      }
    }
  }

  return null;
}

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  const pointer = pointerPosition(event);
  const x = worldX(pointer.pixelX);
  const y = worldY(pointer.pixelY);
  const hit = hitTest(pointer.pixelX, pointer.pixelY);

  if (mode === "select") {
    selectedId = hit ? hit.id : null;
    updateControls();
    if (hit) drag = { id: hit.id, dx: x - hit.x, dy: y - hit.y };
  } else if (mode === "plus") {
    addPoint(x, y, 2);
  } else if (mode === "minus") {
    addPoint(x, y, -2);
  } else if (mode === "line") {
    addLine(x, y, 4);
  } else if (mode === "plane") {
    addPlane(x, y, 4);
  } else if (mode === "particle") {
    particles.push({ x, y, vx: 0, vy: 0, trail: [{ x, y }] });
  } else if (mode === "delete" && hit) {
    sources = sources.filter((source) => source.id !== hit.id);
    if (selectedId === hit.id) selectedId = null;
    markGeometryDirty();
    updateControls();
  }
});

canvas.addEventListener("pointermove", (event) => {
  const pointer = pointerPosition(event);
  const x = worldX(pointer.pixelX);
  const y = worldY(pointer.pixelY);
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

  if (drag) {
    const source = sources.find((candidate) => candidate.id === drag.id);
    if (source) {
      source.x = x - drag.dx;
      source.y = y - drag.dy;
      markGeometryDirty();
      syncControlValues(source);
    }
  }
});

canvas.addEventListener("pointerup", () => {
  drag = null;
});
canvas.addEventListener("pointercancel", () => {
  drag = null;
});
canvas.addEventListener("mouseleave", () => {
  if (!drag) {
    hud.innerHTML = "Mueve el cursor para medir <b>E</b> y <b>V</b>.";
  }
});

document.querySelectorAll(".mode").forEach((button) => {
  button.addEventListener("click", () => {
    mode = button.dataset.mode;
    document.querySelectorAll(".mode").forEach((candidate) => {
      candidate.classList.toggle("active", candidate === button);
    });
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

function updateControls() {
  const source = sources.find((candidate) => candidate.id === selectedId);
  if (!source) {
    selectedType.textContent = "Ninguno";
    sourceControls.innerHTML =
      '<div class="small">Selecciona una carga o distribución para editar sus parámetros.</div>';
    return;
  }

  const typeName =
    source.type === "point"
      ? "Carga puntual"
      : source.type === "line"
        ? "Distribución lineal"
        : "Distribución plana";
  selectedType.textContent = typeName + " #" + source.id;

  let html = "";
  html += sliderRow(
    "x",
    "x",
    -3,
    3,
    0.01,
    source.x,
    (value) => Number(value).toFixed(2) + " m",
  );
  html += sliderRow(
    "y",
    "y",
    -1.5,
    1.5,
    0.01,
    source.y,
    (value) => Number(value).toFixed(2) + " m",
  );

  if (source.type === "point") {
    html += sliderRow(
      "q",
      "qNC",
      -10,
      10,
      0.1,
      source.q / 1e-9,
      (value) => Number(value).toFixed(1) + " nC",
    );
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

  html +=
    '<div class="row"><button id="deleteSelected" class="danger">Eliminar seleccionado</button></div>';
  sourceControls.innerHTML = html;

  sourceControls.querySelectorAll("input[data-prop]").forEach((input) => {
    input.addEventListener("input", () => {
      const property = input.dataset.prop;
      const value = Number(input.value);
      if (property === "qNC") source.q = value * 1e-9;
      else if (property === "lambdaNCm") source.lambda = value * 1e-9;
      else if (property === "sigmaNCm2") source.sigma = value * 1e-9;
      else if (property === "angleDeg") source.angle = (value * Math.PI) / 180;
      else source[property] = value;
      markGeometryDirty();
      syncControlValues(source);
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
    const input = sourceControls.querySelector(
      'input[data-prop="' + property + '"]',
    );
    const output = sourceControls.querySelector(
      '[data-val="' + property + '"]',
    );
    if (input) input.value = value;
    if (output) output.textContent = text;
  };

  setControl("x", source.x, source.x.toFixed(2) + " m");
  setControl("y", source.y, source.y.toFixed(2) + " m");

  if (source.type === "point") {
    setControl("qNC", source.q / 1e-9, (source.q / 1e-9).toFixed(1) + " nC");
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
  if (
    (event.key === "Delete" || event.key === "Backspace") &&
    selectedId !== null
  ) {
    sources = sources.filter((source) => source.id !== selectedId);
    selectedId = null;
    markGeometryDirty();
    updateControls();
  }
});

new ResizeObserver(resize).observe(stage);
loadPreset("dipole");
resize();
requestAnimationFrame(render);
