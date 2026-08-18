import assert from "node:assert/strict";
import test from "node:test";

import { Camera2D } from "../src/camera.js";

const WORLD = { xmin: -10, xmax: 10, ymin: -10, ymax: 10 };

function makeCamera(overrides = {}) {
  return new Camera2D({
    bounds: WORLD,
    x: 0,
    y: 0,
    zoom: 100,
    minZoom: 20,
    maxZoom: 500,
    ...overrides,
  }).setViewport(800, 600);
}

function assertClose(actual, expected, tolerance = 1e-10) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

test("world and screen transforms are reversible", () => {
  const camera = makeCamera({ x: 1.25, y: -2.5, zoom: 137 });
  for (const point of [
    { x: 0, y: 0 },
    { x: 2.75, y: -1.125 },
    { x: -1.4, y: -4.2 },
  ]) {
    const screen = camera.worldToScreen(point.x, point.y);
    const restored = camera.screenToWorld(screen.x, screen.y);
    assertClose(restored.x, point.x);
    assertClose(restored.y, point.y);
  }
});

test("panning changes only the camera, not physical objects", () => {
  const camera = makeCamera();
  const source = Object.freeze({ x: 2, y: 1, q: 3e-9 });

  camera.panByPixels(125, -50);

  assert.deepEqual(source, { x: 2, y: 1, q: 3e-9 });
  assertClose(camera.x, -1.25);
  assertClose(camera.y, -0.5);
});

test("zoom keeps the physical point under the cursor", () => {
  const camera = makeCamera();
  const cursor = { x: 615, y: 175 };
  const before = camera.screenToWorld(cursor.x, cursor.y);

  camera.zoomAt(cursor.x, cursor.y, 240);

  const after = camera.screenToWorld(cursor.x, cursor.y);
  assertClose(after.x, before.x);
  assertClose(after.y, before.y);
});

test("zoom is clamped to its configured limits", () => {
  const camera = makeCamera();

  camera.zoomAt(400, 300, 1);
  assert.equal(camera.zoom, 20);
  camera.zoomAt(400, 300, 10_000);
  assert.equal(camera.zoom, 500);
});

test("camera movement stops at physical world boundaries", () => {
  const camera = makeCamera();

  camera.setCenter(100, -100);

  assert.equal(camera.x, 6);
  assert.equal(camera.y, -7);
  const visible = camera.getVisibleBounds();
  assertClose(visible.xmax, WORLD.xmax);
  assertClose(visible.ymin, WORLD.ymin);
});

test("fitBounds leaves every target corner inside the padded viewport", () => {
  const camera = makeCamera().setViewport(1000, 600);
  const target = { xmin: -3, xmax: 4, ymin: -1.5, ymax: 2.5 };
  const padding = 50;

  camera.fitBounds(target, { padding });

  for (const point of [
    [target.xmin, target.ymin],
    [target.xmin, target.ymax],
    [target.xmax, target.ymin],
    [target.xmax, target.ymax],
  ]) {
    const screen = camera.worldToScreen(...point);
    assert.ok(screen.x >= padding - 1e-9);
    assert.ok(screen.x <= camera.width - padding + 1e-9);
    assert.ok(screen.y >= padding - 1e-9);
    assert.ok(screen.y <= camera.height - padding + 1e-9);
  }
});

test("fitBounds can frame a single point with a minimum span", () => {
  const camera = makeCamera();

  camera.fitBounds(
    { xmin: 2, xmax: 2, ymin: 1, ymax: 1 },
    { minimumSpan: 1 },
  );

  assert.equal(camera.x, 2);
  assert.equal(camera.y, 1);
  assert.equal(camera.zoom, 500);
});

test("resizing changes the visible area without changing camera scale", () => {
  const camera = makeCamera({ x: 1, y: -1, zoom: 160 });
  const state = { x: camera.x, y: camera.y, zoom: camera.zoom };

  camera.setViewport(1000, 700);

  assert.deepEqual(
    { x: camera.x, y: camera.y, zoom: camera.zoom },
    state,
  );
});

test("screen-to-world placement remains exact after panning and zooming", () => {
  const camera = makeCamera();
  camera.panByPixels(130, -75);
  camera.zoomAt(240, 190, 185);
  const cursor = { x: 635, y: 412 };

  const placement = camera.screenToWorld(cursor.x, cursor.y);
  const restoredCursor = camera.worldToScreen(placement.x, placement.y);

  assertClose(restoredCursor.x, cursor.x);
  assertClose(restoredCursor.y, cursor.y);
});
