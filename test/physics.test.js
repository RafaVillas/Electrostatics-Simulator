import assert from 'node:assert/strict';
import test from 'node:test';

import { COULOMB_CONSTANT } from '../src/config.js';
import {
  buildSourceSamples,
  electricFieldAt,
  electricPotentialAt,
  sourceNetCharge,
} from '../src/physics.js';

test('a point source preserves Coulomb field and potential', () => {
  const charge = 3e-9;
  const samples = buildSourceSamples([
    { id: 1, type: 'point', x: 0, y: 0, q: charge },
  ]);

  assert.deepEqual(samples, [
    { x: 0, y: 0, q: charge, parentId: 1 },
  ]);
  assert.deepEqual(electricFieldAt(samples, 1, 0), {
    x: COULOMB_CONSTANT * charge,
    y: 0,
    mag: COULOMB_CONSTANT * charge,
  });
  assert.equal(
    electricPotentialAt(samples, 1, 0),
    COULOMB_CONSTANT * charge,
  );
});

test('the singularity mask keeps the existing 0.018 m threshold', () => {
  const samples = [{ x: 0, y: 0, q: 1e-9, parentId: 1 }];

  assert.deepEqual(electricFieldAt(samples, 0.01, 0), {
    x: 0,
    y: 0,
    mag: 0,
  });
  assert.equal(electricPotentialAt(samples, 0.01, 0), 0);
});

test('distributed sources preserve sample density and total charge', () => {
  const line = {
    id: 1,
    type: 'line',
    x: 0,
    y: 0,
    lambda: 4e-9,
    length: 1,
    angle: 0,
  };
  const plane = {
    id: 2,
    type: 'plane',
    x: 0,
    y: 0,
    sigma: -5e-9,
    width: 1,
    height: 0.6,
    angle: 0,
  };
  const samples = buildSourceSamples([line, plane]);

  assert.equal(samples.filter((sample) => sample.parentId === 1).length, 24);
  assert.equal(samples.filter((sample) => sample.parentId === 2).length, 84);
  assert.equal(sourceNetCharge(line), 4e-9);
  assert.equal(sourceNetCharge(plane), -3e-9);
});
