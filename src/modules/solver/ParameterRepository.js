import { createStableId } from './Variable.js';
import { formatUnitValue, unitFactors } from './Units.js';

const units = unitFactors;
const constants = { pi: Math.PI, e: Math.E, true: true, false: false, yes: true, no: false };
const functions = {
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  round: Math.round,
  floor: Math.floor,
  ceil: Math.ceil,
  sqrt: Math.sqrt,
  pow: Math.pow,
  clamp: (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value)),
  if: (condition, whenTrue, whenFalse) => (condition ? whenTrue : whenFalse),
  sin: (degrees) => Math.sin(degrees * Math.PI / 180),
  cos: (degrees) => Math.cos(degrees * Math.PI / 180),
  tan: (degrees) => Math.tan(degrees * Math.PI / 180),
  asin: (value) => Math.asin(value) * 180 / Math.PI,
  acos: (value) => Math.acos(value) * 180 / Math.PI,
  atan: (value) => Math.atan(value) * 180 / Math.PI,
};

function tokenize(expression) {
  const source = String(expression).trim();
  const tokens = [];
  const pattern = /\s*(>=|<=|==|!=|&&|\|\||\d+(?:\.\d+)?(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z0-9_]*|[()+\-*/^!,<>])\s*/giy;
  let index = 0;
  while (index < source.length) {
    pattern.lastIndex = index;
    const match = pattern.exec(source);
    if (!match) throw new Error(`Invalid expression near: ${source.slice(index)}`);
    tokens.push(match[1]);
    index = pattern.lastIndex;
  }
  return tokens;
}

function parseExpression(source, resolveName) {
  const tokens = tokenize(source);
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];

  function primary() {
    if (peek() === '(') {
      take();
      const value = logicalOr();
      if (take() !== ')') throw new Error('Missing closing parenthesis.');
      return value;
    }
    const token = take();
    if (token === undefined) throw new Error('Unexpected end of expression.');
    const numeric = Number(token);
    if (Number.isFinite(numeric)) {
      const unit = units[String(peek()).toLowerCase()];
      if (unit) take();
      return numeric * (unit || 1);
    }
    if (/^[A-Za-z_]/.test(token)) {
      const normalized = token.toLowerCase();
      if (peek() === '(') {
        const fn = functions[normalized];
        if (!fn) throw new Error(`Unknown function: ${token}`);
        take();
        const args = [];
        if (peek() !== ')') {
          do {
            args.push(logicalOr());
            if (peek() !== ',') break;
            take();
          } while (peek() !== ')');
        }
        if (take() !== ')') throw new Error(`Missing closing parenthesis for ${token}.`);
        const result = fn(...args);
        if (typeof result === 'number' && !Number.isFinite(result)) throw new Error(`${token} produced a non-finite value.`);
        return result;
      }
      if (Object.hasOwn(constants, normalized)) return constants[normalized];
      return resolveName(token);
    }
    throw new Error(`Unexpected token: ${token}`);
  }

  function unary() {
    if (peek() === '-') { take(); return -Number(unary()); }
    if (peek() === '+') { take(); return Number(unary()); }
    if (peek() === '!') { take(); return !unary(); }
    return primary();
  }

  function power() {
    const left = unary();
    if (peek() !== '^') return left;
    take();
    return Number(left) ** Number(power());
  }

  function product() {
    let value = power();
    while (peek() === '*' || peek() === '/') {
      const operator = take();
      const right = power();
      value = operator === '*' ? Number(value) * Number(right) : Number(value) / Number(right);
    }
    return value;
  }

  function sum() {
    let value = product();
    while (peek() === '+' || peek() === '-') {
      const operator = take();
      const right = product();
      value = operator === '+' ? Number(value) + Number(right) : Number(value) - Number(right);
    }
    return value;
  }

  function comparison() {
    let value = sum();
    while (['<', '<=', '>', '>='].includes(peek())) {
      const operator = take();
      const right = sum();
      if (operator === '<') value = value < right;
      if (operator === '<=') value = value <= right;
      if (operator === '>') value = value > right;
      if (operator === '>=') value = value >= right;
    }
    return value;
  }

  function equality() {
    let value = comparison();
    while (peek() === '==' || peek() === '!=') {
      const operator = take();
      const right = comparison();
      value = operator === '==' ? value === right : value !== right;
    }
    return value;
  }

  function logicalAnd() {
    let value = equality();
    while (peek() === '&&') { take(); const right = equality(); value = Boolean(value) && Boolean(right); }
    return value;
  }

  function logicalOr() {
    let value = logicalAnd();
    while (peek() === '||') { take(); const right = logicalAnd(); value = Boolean(value) || Boolean(right); }
    return value;
  }

  const result = logicalOr();
  if (index !== tokens.length) throw new Error(`Unexpected token: ${tokens[index]}`);
  return result;
}

function expressionMetadata(expression) {
  const tokens = tokenize(expression);
  const hasExplicitUnit = tokens.some((token, index) => Number.isFinite(Number(tokens[index - 1])) && Object.hasOwn(units, token.toLowerCase()));
  const hasReference = tokens.some((token, index) => {
    if (!/^[A-Za-z_]/.test(token)) return false;
    const normalized = token.toLowerCase();
    if (Object.hasOwn(units, normalized) || Object.hasOwn(constants, normalized)) return false;
    if (Object.hasOwn(functions, normalized) && tokens[index + 1] === '(') return false;
    return true;
  });
  return { hasExplicitUnit, hasReference };
}

function replaceReference(expression, oldName, nextName) {
  const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(expression).replace(new RegExp(`\\b${escaped}\\b`, 'g'), nextName);
}

function clone(entry) {
  return entry ? { ...entry } : null;
}

export class ParameterRepository {
  constructor() {
    this.entries = new Map();
    this.names = new Map();
    this.listeners = new Set();
    this.computedResolvers = new Map();
    this.nextUserIndex = 1;
    this.nextDimensionIndex = 1;
    this.defaultLengthUnit = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setDefaultLengthUnit(unit = null) {
    this.defaultLengthUnit = unitFactors[unit] && unit !== 'deg' ? unit : null;
    this.evaluateAll({ strict: false });
  }

  emit() {
    const snapshot = this.list();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  uniqueName(prefix, requested = '') {
    if (requested && !this.names.has(requested)) return requested;
    const counterKey = prefix === 'd' ? 'nextDimensionIndex' : 'nextUserIndex';
    let name;
    do {
      name = `${prefix}${this[counterKey]}`;
      this[counterKey] += 1;
    } while (this.names.has(name));
    return name;
  }

  createUser({ id = createStableId('parameter'), name = '', type = 'Expression', expression = '' } = {}) {
    const entry = {
      id,
      name: this.uniqueName('p', name.trim()),
      type: type === 'Yes/No' ? 'Yes/No' : 'Expression',
      expression: String(expression),
      value: type === 'Yes/No' ? false : 0,
      kind: 'user',
      driving: false,
      computed: false,
      unit: null,
      error: null,
      order: this.entries.size,
    };
    this.entries.set(id, entry);
    this.names.set(entry.name, id);
    this.evaluateAll({ strict: false });
    this.emit();
    return clone(entry);
  }

  addDimension({ id = createStableId('dimension'), name = '', expression, value = 0, driving = false, unit = 'mm', annotationId = null } = {}) {
    const entry = {
      id,
      name: this.uniqueName('d', name.trim()),
      type: 'Expression',
      expression: driving ? String(expression ?? value) : this.formatValue(value, unit),
      value: Number(value),
      kind: 'dimension',
      driving: Boolean(driving),
      computed: !driving,
      unit,
      annotationId,
      error: null,
      order: this.entries.size,
    };
    this.entries.set(id, entry);
    this.names.set(entry.name, id);
    this.evaluateAll({ strict: true });
    this.emit();
    return clone(entry);
  }

  setComputedResolver(id, resolver) {
    if (!this.entries.get(id)?.computed) return false;
    this.computedResolvers.set(id, resolver);
    this.evaluateAll({ strict: false });
    return true;
  }

  set({ id = createStableId('dimension'), name, expression, unit = 'mm', type = 'Expression' }) {
    if (!this.entries.has(id)) return this.addDimension({ id, name, expression, value: 0, driving: true, unit });
    return this.update(id, { name, expression, unit, type }, { strict: true });
  }

  update(id, patch, { strict = false } = {}) {
    const before = this.snapshot();
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`Unknown parameter: ${id}`);
    if (entry.computed && (patch.expression !== undefined || patch.type !== undefined)) return clone(entry);
    const oldName = entry.name;
    let validationError = null;
    const nextName = patch.name === undefined ? oldName : String(patch.name).trim();
    if (!nextName) {
      if (strict) throw new Error('Parameter name is required.');
      validationError = 'Parameter name is required.';
    } else {
      const duplicate = this.names.get(nextName);
      if (duplicate && duplicate !== id) {
        if (strict) throw new Error(`Parameter name already exists: ${nextName}`);
        validationError = `Parameter name already exists: ${nextName}`;
      } else if (nextName !== oldName) {
        this.names.delete(oldName);
        this.names.set(nextName, id);
        entry.name = nextName;
        this.entries.forEach((candidate) => {
          if (candidate.id !== id && !candidate.computed) candidate.expression = replaceReference(candidate.expression, oldName, nextName);
        });
      }
    }
    if (patch.type !== undefined && entry.kind === 'user') entry.type = patch.type === 'Yes/No' ? 'Yes/No' : 'Expression';
    if (patch.expression !== undefined && !entry.computed) entry.expression = String(patch.expression);
    if (patch.unit !== undefined) entry.unit = patch.unit;
    try {
      this.evaluateAll({ strict });
      if (validationError) this.entries.get(id).error = validationError;
    } catch (error) {
      this.restore(before, { emit: false });
      throw error;
    }
    this.emit();
    return this.get(id);
  }

  evaluateAll({ strict = true, refreshComputed = true } = {}) {
    this.entries.forEach((entry) => { entry.error = null; });
    const resolved = new Map();
    const visiting = new Set();
    const evaluate = (id) => {
      if (resolved.has(id)) return resolved.get(id);
      const entry = this.entries.get(id);
      if (!entry) throw new Error(`Unknown parameter: ${id}`);
      if (entry.computed) {
        const resolver = this.computedResolvers.get(id);
        if (resolver && refreshComputed) {
          const computedValue = Number(resolver());
          if (!Number.isFinite(computedValue)) throw new Error(`${entry.name} measurement is not finite.`);
          entry.value = computedValue;
          entry.expression = this.formatValue(entry.value, entry.unit);
        }
        resolved.set(id, entry.value);
        return entry.value;
      }
      if (visiting.has(id)) throw new Error(`Dependency cycle detected at ${entry.name}.`);
      if (!entry.expression.trim()) throw new Error(`${entry.name} requires an expression.`);
      visiting.add(id);
      let raw = parseExpression(entry.expression, (name) => {
        const dependencyId = this.names.get(name);
        if (!dependencyId) throw new Error(`Unknown parameter: ${name}`);
        return evaluate(dependencyId);
      });
      if (this.defaultLengthUnit && entry.type === 'Expression' && entry.unit !== 'deg') {
        const { hasExplicitUnit, hasReference } = expressionMetadata(entry.expression);
        if (!hasExplicitUnit && !hasReference) raw = Number(raw) * unitFactors[this.defaultLengthUnit];
      }
      visiting.delete(id);
      const value = entry.type === 'Yes/No' ? Boolean(raw) : Number(raw);
      if (entry.type === 'Expression' && !Number.isFinite(value)) throw new Error(`${entry.name} must evaluate to a finite number.`);
      entry.value = value;
      resolved.set(id, value);
      return value;
    };
    for (const [id, entry] of this.entries) {
      try {
        evaluate(id);
      } catch (error) {
        entry.error = error.message;
        visiting.clear();
        if (strict) throw error;
      }
    }
    return new Map(resolved);
  }

  setComputedValue(id, value, unit = null) {
    const entry = this.entries.get(id);
    if (!entry?.computed) return false;
    entry.value = Number(value);
    if (unit) entry.unit = unit;
    entry.expression = this.formatValue(entry.value, entry.unit);
    this.evaluateAll({ strict: false });
    this.emit();
    return true;
  }

  formatValue(value, unit = null) {
    return formatUnitValue(value, unit);
  }

  remove(id, { allowDimension = false } = {}) {
    const entry = this.entries.get(id);
    if (!entry || (entry.kind === 'dimension' && !allowDimension)) return false;
    this.names.delete(entry.name);
    this.computedResolvers.delete(id);
    this.entries.delete(id);
    this.normalizeOrder();
    this.evaluateAll({ strict: false });
    this.emit();
    return true;
  }

  reorder(id, beforeId = null) {
    const ordered = this.list().filter((entry) => entry.id !== id);
    const moving = this.entries.get(id);
    if (!moving) return false;
    const index = beforeId ? ordered.findIndex((entry) => entry.id === beforeId) : ordered.length;
    ordered.splice(index < 0 ? ordered.length : index, 0, moving);
    ordered.forEach((entry, order) => { this.entries.get(entry.id).order = order; });
    this.emit();
    return true;
  }

  normalizeOrder() {
    this.list().forEach((entry, order) => { this.entries.get(entry.id).order = order; });
  }

  get(idOrName) {
    const id = this.entries.has(idOrName) ? idOrName : this.names.get(idOrName);
    return clone(this.entries.get(id));
  }

  value(idOrName) {
    const entry = this.get(idOrName);
    if (!entry) throw new Error(`Unknown parameter: ${idOrName}`);
    return entry.value;
  }

  evaluateExpression(expression) {
    return parseExpression(expression, (name) => {
      const id = this.names.get(name);
      const entry = id ? this.entries.get(id) : null;
      if (!entry) throw new Error(`Unknown parameter: ${name}`);
      if (entry.error) throw new Error(entry.error);
      return entry.value;
    });
  }

  evaluateLengthExpression(expression) {
    const value = this.evaluateExpression(expression);
    if (!this.defaultLengthUnit) return value;
    const { hasExplicitUnit, hasReference } = expressionMetadata(expression);
    return !hasExplicitUnit && !hasReference
      ? Number(value) * unitFactors[this.defaultLengthUnit]
      : value;
  }

  list() {
    return [...this.entries.values()].sort((a, b) => a.order - b.order).map(clone);
  }

  snapshot() {
    return this.list();
  }

  restore(snapshot, { emit = true } = {}) {
    this.entries.clear();
    this.names.clear();
    this.computedResolvers.clear();
    this.nextUserIndex = 1;
    this.nextDimensionIndex = 1;
    (snapshot || []).forEach((item, order) => {
      const entry = { ...item, order: item.order ?? order };
      this.entries.set(entry.id, entry);
      this.names.set(entry.name, entry.id);
      const dimensionMatch = /^d(\d+)$/i.exec(entry.name);
      const userMatch = /^p(\d+)$/i.exec(entry.name);
      if (dimensionMatch) this.nextDimensionIndex = Math.max(this.nextDimensionIndex, Number(dimensionMatch[1]) + 1);
      if (userMatch) this.nextUserIndex = Math.max(this.nextUserIndex, Number(userMatch[1]) + 1);
    });
    if (emit) this.emit();
  }

  clear() {
    this.entries.clear();
    this.names.clear();
    this.computedResolvers.clear();
    this.nextUserIndex = 1;
    this.nextDimensionIndex = 1;
    this.emit();
  }
}

export { parseExpression };
