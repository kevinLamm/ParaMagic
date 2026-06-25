function endpointIndices(entity) {
  if (entity.type === 'line' || entity.type === 'arc') return [0, 2];
  if (entity.type === 'polyline' || entity.type === 'curve') {
    return entity.points?.length >= 2 ? [0, entity.points.length - 1] : null;
  }
  return null;
}

function endpointKey(recordId, index) {
  return `${recordId}:${index}`;
}

export function findClosedGeometryCycles(entities = [], constraints = []) {
  const edges = [];
  const endpointKeys = new Set();
  const endpointPoints = new Map();
  entities.forEach((entity) => {
    const indices = endpointIndices(entity);
    if (!indices || !entity.id) return;
    const startKey = endpointKey(entity.id, indices[0]);
    const endKey = endpointKey(entity.id, indices[1]);
    endpointKeys.add(startKey);
    endpointKeys.add(endKey);
    const startPoint = entity.type === 'line' || entity.type === 'arc' ? entity.start : entity.points[indices[0]];
    const endPoint = entity.type === 'line' || entity.type === 'arc' ? entity.end : entity.points[indices[1]];
    endpointPoints.set(startKey, startPoint);
    endpointPoints.set(endKey, endPoint);
    if (!entity.construction) edges.push({ entityId: entity.id, startKey, endKey });
  });

  const parent = new Map([...endpointKeys].map((key) => [key, key]));
  const find = (key) => {
    let root = parent.get(key);
    while (root !== parent.get(root)) root = parent.get(root);
    let current = key;
    while (parent.get(current) !== root) {
      const next = parent.get(current);
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  const samePoint = (a, b) => a && b && Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-6;
  const compositeGroups = new Map();
  entities.forEach((entity) => {
    if (entity.construction || !entity.composite?.closed || !entity.composite.id) return;
    if (!compositeGroups.has(entity.composite.id)) compositeGroups.set(entity.composite.id, []);
    compositeGroups.get(entity.composite.id).push(entity);
  });
  compositeGroups.forEach((group) => {
    group.sort((a, b) => a.composite.index - b.composite.index);
    const expectedCount = group[0]?.composite.count;
    if (!expectedCount || group.length !== expectedCount) return;
    group.forEach((entity, index) => {
      const next = group[(index + 1) % group.length];
      const entityIndices = endpointIndices(entity);
      const nextIndices = endpointIndices(next);
      if (!entityIndices || !nextIndices) return;
      const endKey = endpointKey(entity.id, entityIndices[1]);
      const nextStartKey = endpointKey(next.id, nextIndices[0]);
      if (samePoint(endpointPoints.get(endKey), endpointPoints.get(nextStartKey))) union(endKey, nextStartKey);
    });
  });

  constraints.forEach((constraint) => {
    if (constraint.enabled === false || constraint.type !== 'Coincident') return;
    const keys = (constraint.featureRefs || [])
      .filter((ref) => ref.kind === 'point')
      .map((ref) => endpointKey(ref.recordId, ref.index || 0))
      .filter((key) => endpointKeys.has(key));
    keys.slice(1).forEach((key) => union(keys[0], key));
  });

  const graphEdges = edges.map((edge, index) => ({
    ...edge,
    index,
    start: find(edge.startKey),
    end: find(edge.endKey),
  }));
  const incident = new Map();
  const addIncident = (node, edgeIndex) => {
    if (!incident.has(node)) incident.set(node, []);
    incident.get(node).push(edgeIndex);
  };
  graphEdges.forEach((edge) => {
    addIncident(edge.start, edge.index);
    addIncident(edge.end, edge.index);
  });

  const cycles = [];
  const visitedNodes = new Set();
  const handledSelfLoops = new Set();
  const parentNode = new Map();
  const parentEdge = new Map();
  const depth = new Map();
  const oriented = (edge, from) => ({ entityId: edge.entityId, reversed: edge.start !== from });

  const visit = (node) => {
    visitedNodes.add(node);
    (incident.get(node) || []).forEach((edgeIndex) => {
      const edge = graphEdges[edgeIndex];
      const other = edge.start === node ? edge.end : edge.start;
      if (edge.start === edge.end) {
        if (!handledSelfLoops.has(edgeIndex)) {
          handledSelfLoops.add(edgeIndex);
          cycles.push([{ entityId: edge.entityId, reversed: false }]);
        }
        return;
      }
      if (!visitedNodes.has(other)) {
        parentNode.set(other, node);
        parentEdge.set(other, edgeIndex);
        depth.set(other, (depth.get(node) || 0) + 1);
        visit(other);
        return;
      }
      if (parentEdge.get(node) === edgeIndex || (depth.get(other) || 0) >= (depth.get(node) || 0)) return;
      const treePath = [];
      let cursor = node;
      while (cursor !== other) {
        const treeEdgeIndex = parentEdge.get(cursor);
        if (treeEdgeIndex === undefined) return;
        const parent = parentNode.get(cursor);
        treePath.unshift(oriented(graphEdges[treeEdgeIndex], parent));
        cursor = parent;
      }
      treePath.push(oriented(edge, node));
      cycles.push(treePath);
    });
  };

  incident.forEach((_edgesAtNode, node) => {
    if (visitedNodes.has(node)) return;
    depth.set(node, 0);
    visit(node);
  });
  return cycles;
}
