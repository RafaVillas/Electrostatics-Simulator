import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPointChargeNanocoulombs,
  normalizePointChargeNanocoulombs,
  snapPointChargeSliderNanocoulombs,
} from "../src/property-controls.js";

test("point charge numeric input accepts decimals and clamps its range", () => {
  assert.equal(normalizePointChargeNanocoulombs("2.5"), 2.5);
  assert.equal(normalizePointChargeNanocoulombs(-20), -10);
  assert.equal(normalizePointChargeNanocoulombs(20), 10);
  assert.equal(normalizePointChargeNanocoulombs("not a number"), null);
});

test("point charge feedback makes the sign and units explicit", () => {
  assert.equal(formatPointChargeNanocoulombs(3), "+3 nC");
  assert.equal(formatPointChargeNanocoulombs(-2.5), "−2.5 nC");
  assert.equal(formatPointChargeNanocoulombs(0), "0 nC");
});

test("point charge slider snaps normal interaction to integers", () => {
  assert.equal(snapPointChargeSliderNanocoulombs(2.4), 2);
  assert.equal(snapPointChargeSliderNanocoulombs(2.6), 3);
  assert.equal(snapPointChargeSliderNanocoulombs(-1.7), -2);
});
