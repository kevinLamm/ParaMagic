export function sharedPointRegions() {
  const appearance = (fillColor) => ({ fillColor, fillExpression: fillColor, fillOpacity: 1 });
  return [
    { id: 'upper-arc', type: 'arc', start: [-60, 0], arcPoint: [0, -60], end: [60, 0], appearance: appearance('#e85d75') },
    { id: 'divider', type: 'line', start: [-60, 0], end: [60, 0], appearance: appearance('#e85d75') },
    { id: 'lower-curve', type: 'curve', points: [[60, 0], [0, 60], [-60, 0]], appearance: appearance('#458be8') },
  ];
}

export function touchingComposites() {
  const rectangle = (id, x, fillColor) => {
    const points = [[x, 0], [x + 100, 0], [x + 100, 80], [x, 80]];
    return points.map((start, index) => ({
      id: `${id}-${index}`, type: 'line', start, end: points[(index + 1) % points.length],
      composite: { id, kind: 'rectangle', closed: true, index, count: 4 },
      appearance: { fillColor, fillExpression: fillColor, fillOpacity: 1 },
    }));
  };
  return [...rectangle('left-panel', 0, '#e85d75'), ...rectangle('right-panel', 100, '#458be8')];
}
