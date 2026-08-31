import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createClassSystem,
  defaultClassId,
  materializeDrawingClassAppearances,
  normalizeClassState,
  normalizeEntityClass,
  resolveClassAppearance,
  resolveClassEntityProperties,
  withClassAppearanceOverrides,
  withClassEntityPropertyOverrides,
} from '../../packages/paramagic-core/src/modules/ClassSystem.js';
import {
  classListPanelMarkup,
  classPropertiesModalMarkup,
} from '../../packages/paramagic-core/src/modules/ClassTools.js';
import { fixtureUuid } from './helpers/fixtureUuid.js';

function geometryRecord(id, entity = {}) {
  return {
    id,
    recordType: 'geometry',
    entity: {
      id,
      type: 'line',
      start: [0, 0],
      end: [10, 0],
      ...entity,
    },
  };
}

test('every class state contains the protected default class X', () => {
  const defaultId = fixtureUuid('class-system-default');
  const state = normalizeClassState({
    activeClassId: 'missing',
    classes: [
      { id: defaultId, name: 'Renamed X', systemRole: 'default-class', removable: true },
      { id: 'class-a', name: 'Cut', properties: { strokeThickness: 3 } },
      { id: 'class-b', name: 'cut' },
      { id: 'class-c', name: 'X' },
    ],
  });

  assert.equal(state.activeClassId, defaultId);
  assert.deepEqual(state.classes.map(({ id, name }) => ({ id, name })), [
    { id: defaultId, name: 'X' },
    { id: 'class-a', name: 'Cut' },
  ]);
  assert.equal(state.classes[0].removable, false);
  assert.equal(state.classes[0].duplicable, false);
});

test('class names are required and unique while X cannot be renamed, duplicated, or removed', () => {
  const system = createClassSystem();
  const defaultId = defaultClassId(system.getState());
  const cut = system.addClass('Cut');
  assert.equal(cut.success, true);
  assert.equal(system.addClass(' cut ').success, false);
  assert.equal(system.renameClass(cut.class.id, 'X').success, false);
  assert.equal(system.renameClass(defaultId, 'Base').success, false);
  assert.equal(system.duplicateClass(defaultId).success, false);
  assert.equal(system.removeClass(defaultId).success, false);
  assert.equal(system.renameClass(cut.class.id, 'Shell').success, true);
  assert.equal(system.getState().classes.find(({ id }) => id === cut.class.id).name, 'Shell');
});

test('classes can be added, duplicated with their properties, and deleted with entities reassigned to X', () => {
  const records = [geometryRecord('edge-a')];
  const persisted = [];
  const system = createClassSystem({
    records,
    persistRecord(record, entity) {
      persisted.push(record.id);
      return entity;
    },
  });
  const defaultId = defaultClassId(system.getState());
  const cut = system.addClass('Cut').class;
  system.updateClassProperties(cut.id, { strokeExpression: '#ff0000', strokeThickness: 4 });
  const duplicate = system.duplicateClass(cut.id);
  assert.equal(duplicate.success, true);
  assert.equal(duplicate.class.name, 'Cut Copy');
  assert.equal(duplicate.class.properties.strokeExpression, '#ff0000');
  assert.equal(duplicate.class.properties.strokeThickness, 4);

  system.setRecordClassIds(['edge-a'], cut.id);
  assert.equal(records[0].entity.classId, cut.id);
  const removed = system.removeClass(cut.id);
  assert.equal(removed.success, true);
  assert.equal(records[0].entity.classId, defaultId);
  assert.deepEqual(persisted, ['edge-a', 'edge-a']);
});

test('new geometry receives the active class and activating a class leaves selected geometry unchanged', () => {
  const selectedIds = new Set(['edge-a']);
  const records = [geometryRecord('edge-a')];
  const system = createClassSystem({ records, selectedIds });
  const defaultId = defaultClassId(system.getState());
  records[0].entity = system.assignEntity(records[0].entity, defaultId, { fresh: true });
  const cut = system.addClass('Cut').class;

  assert.equal(system.assignEntity({ id: 'edge-new', type: 'line' }).classId, cut.id);
  const shell = system.addClass('Shell').class;
  const result = system.setActiveClass(shell.id);

  assert.equal(result.success, true);
  assert.deepEqual(result.recordIds, []);
  assert.equal(records[0].entity.classId, defaultId);
  assert.deepEqual(system.recordIdsForClass(shell.id), []);
});

test('entity property overrides survive class changes while inherited properties follow the new class', () => {
  const system = createClassSystem();
  const cut = system.addClass('Cut').class;
  system.updateClassProperties(cut.id, {
    fillExpression: '#ff0000',
    strokeExpression: '#111111',
    strokeThickness: 2,
  });
  const shell = system.addClass('Shell').class;
  system.updateClassProperties(shell.id, {
    fillExpression: '#00ff00',
    strokeExpression: '#222222',
    strokeThickness: 7,
  });

  let entity = system.assignEntity({ id: 'edge-a', type: 'line' }, cut.id);
  const cutAppearance = system.resolveAppearance(entity);
  assert.equal(cutAppearance.fillExpression, '#ff0000');
  assert.equal(cutAppearance.strokeThickness, 2);

  entity = withClassAppearanceOverrides(entity, {
    ...cutAppearance,
    fillExpression: '#abcdef',
  }, { fillExpression: '#abcdef' });
  entity = system.assignEntity({ ...entity, classId: shell.id }, shell.id);
  const shellAppearance = system.resolveAppearance(entity);

  assert.equal(shellAppearance.fillExpression, '#abcdef');
  assert.equal(shellAppearance.strokeExpression, '#222222');
  assert.equal(shellAppearance.strokeThickness, 7);
  assert.deepEqual(entity.classPropertyOverrides, ['fill']);
});

test('legacy geometry migrates to X with its existing appearance preserved as overrides', () => {
  const state = normalizeClassState();
  const entity = normalizeEntityClass({
    id: 'legacy',
    type: 'line',
    appearance: { fillColor: '#123456', strokeThickness: 6, zIndex: 8 },
  }, state, { legacy: true });

  assert.equal(entity.classId, defaultClassId(state));
  assert.deepEqual(entity.classPropertyOverrides.sort(), ['fill', 'strokeThickness']);
  assert.equal(resolveClassAppearance(entity).fillColor, '#123456');
  assert.equal(resolveClassAppearance(entity).strokeThickness, 6);
  assert.equal(resolveClassAppearance(entity).zIndex, 8);
});

test('drawing presentation materializes inherited class appearance without discarding override metadata', () => {
  const state = normalizeClassState({
    activeClassId: 'class-cut',
    classes: [{
      id: 'class-cut',
      name: 'Cut',
      properties: { strokeExpression: '#ff0000', strokeThickness: 5 },
    }],
  });
  const drawing = materializeDrawingClassAppearances({
    ...state,
    entities: [{
      id: 'edge-a',
      type: 'line',
      classId: 'class-cut',
      classPropertyOverrides: ['strokeThickness'],
      appearance: { strokeThickness: 2 },
    }],
  });

  assert.equal(drawing.entities[0].appearance.strokeExpression, '#ff0000');
  assert.equal(drawing.entities[0].appearance.strokeThickness, 2);
  assert.deepEqual(drawing.entities[0].classPropertyOverrides, ['strokeThickness']);
});

test('text properties inherit from classes while construction remains entity-only', () => {
  const system = createClassSystem();
  const notes = system.addClass('Notes').class;
  system.updateClassProperties(notes.id, {
    construction: true,
    fontName: 'Georgia',
    fontSize: 36,
    fontColor: '#884422',
    scaleWithZoom: false,
    multiline: false,
    textAlign: 'center',
    textVerticalAlign: 'middle',
  });
  const normalizedNotes = system.getState().classes.find(({ id }) => id === notes.id).properties;
  assert.equal(Object.hasOwn(normalizedNotes, 'construction'), false);
  assert.equal(Object.hasOwn(normalizedNotes, 'scaleWithZoom'), false);

  const text = system.assignEntity({ id: 'label', type: 'text' }, notes.id, { fresh: true });
  assert.deepEqual(resolveClassEntityProperties(text, system.getState()), {
    fontName: 'Georgia',
    fontSize: 36,
    textHeight: 9.525,
    fontColor: '#884422',
    multiline: false,
    textAlign: 'center',
    textVerticalAlign: 'middle',
  });

  const directText = withClassEntityPropertyOverrides(text, { fontName: 'Impact', fontSize: 18 });
  const alternate = system.addClass('Alternate').class;
  system.updateClassProperties(alternate.id, { fontName: 'Verdana', fontSize: 48 });
  const movedText = system.assignEntity(directText, alternate.id);
  const movedTextProperties = system.resolveEntityProperties(movedText);
  assert.equal(movedTextProperties.fontName, 'Impact');
  assert.equal(movedTextProperties.fontSize, 18);
  assert.equal(movedTextProperties.fontColor, '#202020');

  const guide = system.assignEntity({ id: 'guide', type: 'line', construction: false }, notes.id, { fresh: true });
  assert.equal(guide.construction, false);
  const directGuide = system.applyEntityPropertyOverrides(guide, { construction: true });
  const movedGuide = system.assignEntity(directGuide, alternate.id);
  assert.equal(movedGuide.construction, true);
  assert.equal(movedGuide.classPropertyOverrides.includes('construction'), false);
});

test('opening a class-aware drawing materializes text properties without throwing', () => {
  const drawing = materializeDrawingClassAppearances({
    activeClassId: 'class-labels',
    classes: [{
      id: 'class-labels',
      name: 'Labels',
      properties: { fontName: 'Georgia', fontSize: 32, textAlign: 'right' },
    }],
    entities: [{
      id: 'label-a',
      type: 'text',
      classId: 'class-labels',
      classPropertyOverrides: [],
      x: 2,
      y: 3,
      text: 'Open me',
    }],
  });

  assert.equal(drawing.entities[0].fontName, 'Georgia');
  assert.equal(drawing.entities[0].fontSize, 32);
  assert.equal(drawing.entities[0].textAlign, 'right');
});

test('the Class List uses icon-only actions and protects X controls', () => {
  const state = normalizeClassState();
  const markup = classListPanelMarkup(state, defaultClassId(state));
  assert.match(markup, /<h2>Classes<\/h2>/);
  assert.match(markup, /data-class-add[^>]*aria-label="Add Class"/);
  assert.match(markup, /data-class-edit[^>]*aria-label="Edit Class"/);
  assert.match(markup, /data-class-duplicate[^>]*disabled/);
  assert.match(markup, /data-class-remove[^>]*disabled/);
  assert.doesNotMatch(markup, /<span>Add Class<\/span>/);
  assert.match(markup, /class="class-list-item[^>]*>X<\/button>/);
});

test('Class Properties duplicates the geometry appearance controls in modal form', () => {
  const state = normalizeClassState();
  const markup = classPropertiesModalMarkup(state, defaultClassId(state));
  assert.match(markup, /Class Properties/);
  assert.match(markup, /name="name"[^>]*disabled/);
  assert.match(markup, /data-class-fill-color/);
  assert.match(markup, /data-class-image-fill/);
  assert.match(markup, /name="fillExpression"/);
  assert.match(markup, /data-class-fill-opacity-slider/);
  assert.match(markup, /name="fillOpacityExpression"/);
  assert.match(markup, /data-class-stroke-color/);
  assert.match(markup, /data-class-image-stroke/);
  assert.match(markup, /name="strokeExpression"/);
  assert.match(markup, /name="strokeThickness"/);
  assert.match(markup, /data-class-stroke-opacity-slider/);
  assert.match(markup, /name="strokeOpacityExpression"/);
  assert.match(markup, /data-class-visible/);
  assert.match(markup, /name="visibleExpression"/);
  assert.doesNotMatch(markup, /data-class-z-index/);
  assert.doesNotMatch(markup, /data-class-seam-line/);
  assert.match(markup, /name="fontName"/);
  assert.match(markup, /name="fontSize"/);
  assert.match(markup, /name="fontColor"/);
  assert.doesNotMatch(markup, /data-class-scale-with-zoom|Scale with Zoom/);
  assert.match(markup, /data-class-multiline/);
  assert.match(markup, /data-class-text-align="center"/);
  assert.match(markup, /data-class-text-vertical-align="middle"/);
  assert.doesNotMatch(markup, /data-class-construction/);
  assert.doesNotMatch(markup, />Construction</);
});

test('legacy class construction values are discarded during normalization', () => {
  const state = normalizeClassState({
    classes: [{
      id: 'class-guides',
      name: 'Guides',
      properties: { construction: true, strokeThickness: 3 },
    }],
  });
  const properties = state.classes.find(({ id }) => id === 'class-guides').properties;
  assert.equal(Object.hasOwn(properties, 'construction'), false);
  assert.equal(properties.strokeThickness, 3);
});
