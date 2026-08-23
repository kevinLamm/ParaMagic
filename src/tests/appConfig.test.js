import assert from 'node:assert/strict';
import test from 'node:test';
import { drawingBrowserTitle } from '../app-config.js';

test('drawing browser titles include the current drawing name', () => {
  assert.equal(drawingBrowserTitle('Part1'), 'ParaMagic - Part1');
  assert.equal(drawingBrowserTitle(''), 'ParaMagic - Untitled Drawing');
});
