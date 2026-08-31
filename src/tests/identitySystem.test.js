import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertUuid,
  createUuid,
  createUuidAllocator,
  deriveUuid,
  isUuid,
  normalizeUuid,
} from '../../packages/paramagic-core/src/modules/IdentitySystem.js';

test('independent IDs are raw canonical UUID-v4 values', () => {
  const first = createUuid();
  const second = createUuid();
  assert.equal(isUuid(first), true);
  assert.equal(first[14], '4');
  assert.notEqual(first, second);
  assert.equal(first.includes('stack'), false);
});

test('UUID normalization and assertion reject mixed ID formats', () => {
  const value = createUuid();
  assert.equal(normalizeUuid(value.toUpperCase()), value);
  assert.equal(normalizeUuid(`stack-${value}`), null);
  assert.throws(() => assertUuid('stack-default'), /canonical UUID/);
});

test('derived identities are stable opaque UUID-v5 values', () => {
  const namespace = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
  const first = deriveUuid(namespace, 'paramagic-derived-target');
  const second = deriveUuid(namespace, 'paramagic-derived-target');
  assert.equal(first, second);
  assert.equal(isUuid(first), true);
  assert.equal(first[14], '5');
  assert.notEqual(first, deriveUuid(namespace, 'another-target'));
});

test('UUID allocators reserve identities and reject invalid reservations', () => {
  const reserved = createUuid();
  const allocator = createUuidAllocator([reserved]);
  assert.equal(allocator.has(reserved), true);
  const allocated = allocator.allocate();
  assert.equal(isUuid(allocated), true);
  assert.equal(allocator.has(allocated), true);
  assert.equal(allocator.reserve(allocated), false);
  assert.throws(() => allocator.reserve('entity-1'), /canonical UUID/);
});

test('UUID allocators retry collisions without weakening the UUID contract', () => {
  const reserved = createUuid();
  const available = createUuid();
  const candidates = [reserved, reserved, available];
  const allocator = createUuidAllocator([reserved], {
    generator: () => candidates.shift(),
  });
  assert.equal(allocator.allocate(), available);
  assert.equal(candidates.length, 0);

  const exhausted = createUuidAllocator([reserved], {
    generator: () => reserved,
    maxAttempts: 2,
  });
  assert.throws(() => exhausted.allocate(), /after 2 attempts/);
});
