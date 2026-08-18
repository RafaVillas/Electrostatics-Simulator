export const MIN_POINT_CHARGE_NC = -10;
export const MAX_POINT_CHARGE_NC = 10;

export function normalizePointChargeNanocoulombs(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return null;
  return Math.max(
    MIN_POINT_CHARGE_NC,
    Math.min(MAX_POINT_CHARGE_NC, numericValue),
  );
}

export function snapPointChargeSliderNanocoulombs(value) {
  const normalized = normalizePointChargeNanocoulombs(value);
  return normalized === null ? null : Math.round(normalized);
}

export function formatPointChargeNanocoulombs(value) {
  const normalized = Math.abs(value) < 1e-10 ? 0 : value;
  const rounded = Math.round(normalized * 100) / 100;
  const magnitude = Number.isInteger(rounded)
    ? String(Math.abs(rounded))
    : Math.abs(rounded).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
  return `${sign}${magnitude} nC`;
}
