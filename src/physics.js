import { COULOMB_CONSTANT, MIN_SAMPLE_DISTANCE } from './config.js';

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function buildSourceSamples(sources) {
  const samples = [];

  for (const source of sources) {
    if (source.type === 'point') {
      samples.push({
        x: source.x,
        y: source.y,
        q: source.q,
        parentId: source.id,
      });
    } else if (source.type === 'line') {
      const count = clamp(Math.ceil(source.length * 24), 12, 56);
      const cos = Math.cos(source.angle);
      const sin = Math.sin(source.angle);

      for (let index = 0; index < count; index += 1) {
        const offset = ((index + 0.5) / count - 0.5) * source.length;
        samples.push({
          x: source.x + offset * cos,
          y: source.y + offset * sin,
          q: (source.lambda * source.length) / count,
          parentId: source.id,
        });
      }
    } else if (source.type === 'plane') {
      const columns = 12;
      const rows = Math.max(
        6,
        Math.round((12 * source.height) / Math.max(source.width, 0.05)),
      );
      const cos = Math.cos(source.angle);
      const sin = Math.sin(source.angle);
      const area = source.width * source.height;

      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          const u = ((column + 0.5) / columns - 0.5) * source.width;
          const v = ((row + 0.5) / rows - 0.5) * source.height;
          samples.push({
            x: source.x + u * cos - v * sin,
            y: source.y + u * sin + v * cos,
            q: (source.sigma * area) / (columns * rows),
            parentId: source.id,
          });
        }
      }
    }
  }

  return samples;
}

export function electricFieldAt(samples, x, y) {
  let fieldX = 0;
  let fieldY = 0;
  const minimumDistanceSquared = MIN_SAMPLE_DISTANCE ** 2;

  for (const sample of samples) {
    const deltaX = x - sample.x;
    const deltaY = y - sample.y;
    const distanceSquared = deltaX * deltaX + deltaY * deltaY;

    if (distanceSquared < minimumDistanceSquared) continue;

    const inverseDistanceCubed =
      1 / (distanceSquared * Math.sqrt(distanceSquared));
    const factor = COULOMB_CONSTANT * sample.q * inverseDistanceCubed;
    fieldX += factor * deltaX;
    fieldY += factor * deltaY;
  }

  return { x: fieldX, y: fieldY, mag: Math.hypot(fieldX, fieldY) };
}

export function electricPotentialAt(samples, x, y) {
  let potential = 0;

  for (const sample of samples) {
    const distance = Math.hypot(x - sample.x, y - sample.y);
    if (distance < MIN_SAMPLE_DISTANCE) continue;
    potential += (COULOMB_CONSTANT * sample.q) / distance;
  }

  return potential;
}

export function sourceNetCharge(source) {
  if (source.type === 'point') return source.q;
  if (source.type === 'line') return source.lambda * source.length;
  return source.sigma * source.width * source.height;
}
