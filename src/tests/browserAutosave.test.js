import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_AUTOSAVE_FILE_ID,
  createBrowserAutosaveController,
  normalizeBrowserAutosaveFile,
} from '../../packages/paramagic-core/src/modules/BrowserAutosave.js';

test('browser autosave files retain one active drawing identity and filename', () => {
  assert.deepEqual(normalizeBrowserAutosaveFile({
    id: 'ignored',
    name: 'Bodice Block',
    content: '{"drawing":true}',
    updatedAt: 123,
  }), {
    id: BROWSER_AUTOSAVE_FILE_ID,
    name: 'Bodice Block',
    content: '{"drawing":true}',
    mimeType: 'application/vnd.paramagic+json',
    fileHandle: null,
    updatedAt: 123,
  });
});

test('browser autosave retains the active native file handle for later Save calls', () => {
  const fileHandle = { kind: 'file', name: 'Bodice Block.paramagic' };
  const normalized = normalizeBrowserAutosaveFile({ name: 'Bodice Block', fileHandle });

  assert.equal(normalized.fileHandle, fileHandle);
});

test('browser autosave coalesces changes and saves the latest drawing name', async () => {
  const saved = [];
  const timers = [];
  let name = 'First Name';
  const controller = createBrowserAutosaveController({
    store: {
      load: async () => null,
      save: async (file) => { saved.push(file); return file; },
    },
    capture: () => ({ name, content: `drawing:${name}`, updatedAt: 1 }),
    setTimer: (callback) => { timers.push(callback); return callback; },
    clearTimer: (callback) => {
      const index = timers.indexOf(callback);
      if (index >= 0) timers.splice(index, 1);
    },
  });

  controller.schedule();
  name = 'Renamed Drawing';
  controller.schedule();
  assert.equal(timers.length, 1);
  timers.shift()();
  await controller.flush();

  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, 'Renamed Drawing');
  assert.equal(saved[0].content, 'drawing:Renamed Drawing');
});

test('saving a new drawing replaces the same browser-local file', async () => {
  const records = new Map();
  let drawing = { name: 'Existing Drawing', content: 'old', updatedAt: 1 };
  const store = {
    load: async () => records.get(BROWSER_AUTOSAVE_FILE_ID) || null,
    save: async (file) => { records.set(file.id, file); return file; },
  };
  const controller = createBrowserAutosaveController({ store, capture: () => drawing });

  await controller.saveNow();
  drawing = { name: 'Untitled Drawing', content: 'new', updatedAt: 2 };
  await controller.saveNow();

  assert.equal(records.size, 1);
  assert.deepEqual(await controller.load(), normalizeBrowserAutosaveFile(drawing));
});
