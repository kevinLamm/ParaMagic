import { deriveUuid } from '../../../packages/paramagic-core/src/modules/IdentitySystem.js';

const FIXTURE_NAMESPACE = '4bc6b441-0d86-43e9-94ca-d7132dcb4831';

export function fixtureUuid(label) {
  return deriveUuid(FIXTURE_NAMESPACE, String(label));
}

export function fixtureUuids(...labels) {
  return Object.fromEntries(labels.map((label) => [label, fixtureUuid(label)]));
}
