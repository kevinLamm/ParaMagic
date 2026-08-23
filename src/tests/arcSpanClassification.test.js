import test from 'node:test';
import assert from 'node:assert/strict';
import { arcExtentPoints, arcSweepFromAngles } from '../../packages/paramagic-core/src/modules/ArcGeometry.js';
import { SketchModel } from '../../packages/paramagic-core/src/modules/solver/SolverModel.js';

const pointAt = (angle, radius = 10) => [Math.cos(angle) * radius, Math.sin(angle) * radius];

test('arc sweep classification can preserve a minor or major branch as endpoints move', () => {
  const start = 0;
  const end = Math.PI * 2 / 3;

  const minor = arcSweepFromAngles(start, end, null, { major: false });
  assert.equal(minor.major, false);
  assert.ok(Math.abs(minor.span) < Math.PI);

  const major = arcSweepFromAngles(start, end, null, { major: true });
  assert.equal(major.major, true);
  assert.ok(Math.abs(major.span) > Math.PI);

  const movedMinor = arcSweepFromAngles(start, Math.PI * 4 / 3, null, { major: false });
  assert.equal(movedMinor.major, false);
  assert.ok(Math.abs(movedMinor.span) < Math.PI);

  const movedMajor = arcSweepFromAngles(start, Math.PI * 4 / 3, null, { major: true });
  assert.equal(movedMajor.major, true);
  assert.ok(Math.abs(movedMajor.span) > Math.PI);
});

test('solver snapshots retain each drawn arc direction while major/minor follows the moved endpoints', () => {
  const model = new SketchModel();
  model.addEntity({
    id: 'minor',
    type: 'arc',
    start: pointAt(0),
    arcPoint: pointAt(Math.PI / 3),
    end: pointAt(Math.PI * 2 / 3),
  });
  model.addEntity({
    id: 'major',
    type: 'arc',
    start: pointAt(0),
    arcPoint: pointAt(Math.PI * 4 / 3),
    end: pointAt(Math.PI * 2 / 3),
  });

  assert.equal(model.entity('minor').major, false);
  assert.equal(model.entity('major').major, true);
  assert.equal(model.entity('minor').ccw, true);
  assert.equal(model.entity('major').ccw, false);

  model.updateEntity({
    ...model.entity('minor'),
    end: pointAt(Math.PI * 4 / 3),
  });
  model.updateEntity({
    ...model.entity('major'),
    end: pointAt(Math.PI * 4 / 3),
  });

  const minor = model.entity('minor');
  const major = model.entity('major');
  assert.equal(minor.ccw, true);
  assert.equal(minor.major, true);
  assert.equal(major.ccw, false);
  assert.equal(major.major, false);
});

test('stored clockwise and counterclockwise directions survive crossing the half-turn boundary', () => {
  const initiallyShortCcw = arcSweepFromAngles(0, Math.PI * 2 / 3, null, { ccw: true });
  const movedLongCcw = arcSweepFromAngles(0, Math.PI * 4 / 3, null, { ccw: initiallyShortCcw.ccw });
  assert.equal(movedLongCcw.ccw, true);
  assert.equal(movedLongCcw.major, true);

  const initiallyLongClockwise = arcSweepFromAngles(0, Math.PI * 2 / 3, null, { ccw: false });
  const movedShortClockwise = arcSweepFromAngles(0, Math.PI * 4 / 3, null, { ccw: initiallyLongClockwise.ccw });
  assert.equal(movedShortClockwise.ccw, false);
  assert.equal(movedShortClockwise.major, false);
});

test('drawn arc geometry corrects a conflicting stored sweep without changing its branch', () => {
  const shortArc = arcSweepFromAngles(0, Math.PI * 2 / 3, Math.PI / 3, {
    major: false,
    ccw: false,
  });
  assert.equal(shortArc.ccw, true);
  assert.equal(shortArc.major, false);
  assert.ok(Math.abs(shortArc.span) < Math.PI);

  const longArc = arcSweepFromAngles(0, Math.PI * 2 / 3, Math.PI * 4 / 3, {
    major: true,
    ccw: true,
  });
  assert.equal(longArc.ccw, false);
  assert.equal(longArc.major, true);
  assert.ok(Math.abs(longArc.span) > Math.PI);
});

test('arc extent points include only cardinal extrema crossed by the rendered span', () => {
  const minor = arcExtentPoints({
    center: [0, 0],
    radius: 10,
    start: pointAt(-Math.PI / 2),
    arcPoint: pointAt(-Math.PI / 4),
    end: pointAt(0),
  });
  assert.equal(minor.length, 4);
  assert.ok(Math.abs(Math.min(...minor.map(([x]) => x))) < 1e-9);
  assert.ok(Math.abs(Math.max(...minor.map(([x]) => x)) - 10) < 1e-9);

  const major = arcExtentPoints({
    center: [0, 0],
    radius: 10,
    start: pointAt(-Math.PI / 2),
    arcPoint: pointAt(Math.PI * 3 / 4),
    end: pointAt(0),
  });
  assert.ok(Math.abs(Math.min(...major.map(([x]) => x)) + 10) < 1e-9);
  assert.ok(Math.abs(Math.max(...major.map(([x]) => x)) - 10) < 1e-9);
  assert.ok(Math.abs(Math.min(...major.map(([, y]) => y)) + 10) < 1e-9);
  assert.ok(Math.abs(Math.max(...major.map(([, y]) => y)) - 10) < 1e-9);
});
