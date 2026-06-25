export const unitFactors = Object.freeze({ mm: 1, cm: 10, m: 1000, in: 25.4, deg: 1 });

export function valueInUnit(value, unit = null) {
  const numeric = Number(value);
  if (!unit || unit === 'deg') return numeric;
  return numeric / (unitFactors[unit] || 1);
}

export function formatUnitValue(value, unit = null, precision = 3) {
  const converted = valueInUnit(value, unit);
  const factor = 10 ** precision;
  const rounded = Math.round((converted + Number.EPSILON) * factor) / factor;
  return unit ? `${rounded} ${unit}` : String(rounded);
}
