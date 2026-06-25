let fallbackId = 0;

export function createStableId(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  fallbackId += 1;
  return `${prefix}-${fallbackId}`;
}

export class Variable {
  constructor({ id = createStableId('variable'), value = 0, fixed = false, owner = null, parameter = null } = {}) {
    this.id = id;
    this.value = Number(value);
    this.fixed = Boolean(fixed);
    this.locked = false;
    this.owner = owner;
    this.parameter = parameter;
  }

  get active() {
    return !this.fixed && !this.locked;
  }
}
