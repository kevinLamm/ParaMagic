import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDrawingFileController,
  ensureFileHandleWritePermission,
  exportTextFileWithPicker,
  saveFileAsWithPicker,
  saveFormatForFileName,
  writeTextToFileHandle,
} from '../../packages/paramagic-core/src/modules/DrawingFileSystem.js';

const saveFormats = [
  { key: 'paramagic', description: 'ParaMagic Drawing', extension: '.paramagic', mimeType: 'application/vnd.paramagic+json' },
  { key: 'dxf', description: 'DXF Drawing', extension: '.dxf', mimeType: 'application/dxf' },
  { key: 'svg', description: 'SVG Drawing', extension: '.svg', mimeType: 'image/svg+xml' },
  { key: 'png', description: 'PNG Image', extension: '.png', mimeType: 'image/png' },
  { key: 'json', description: 'JSON Drawing', extension: '.json', mimeType: 'application/json' },
];

function fakeFileHandle(name, { permission = 'granted' } = {}) {
  const writes = [];
  const requests = [];
  const handle = {
    kind: 'file',
    name,
    writes,
    requests,
    async getFile() {
      return { name, text: async () => `opened:${name}` };
    },
    async queryPermission(descriptor) {
      requests.push(['query', descriptor]);
      return permission;
    },
    async requestPermission(descriptor) {
      requests.push(['request', descriptor]);
      return 'granted';
    },
    async createWritable() {
      return {
        async write(content) { writes.push(content); },
        async close() { writes.push('closed'); },
      };
    },
  };
  return handle;
}

function createController({ handle = null, openPicker, picker, fallbackName = 'Fallback Name' } = {}) {
  const downloads = [];
  let activeHandle = handle;
  const controller = createDrawingFileController({
    getHandle: () => activeHandle,
    setHandle: (nextHandle) => { activeHandle = nextHandle; },
    showOpenFilePicker: openPicker,
    showSaveFilePicker: picker,
    normalizeName: (name) => String(name || '').replace(/\.paramagic$/i, '').trim(),
    pickerOptions: (name) => ({ suggestedName: `${name}.paramagic` }),
    serialize: (name) => `drawing:${name}`,
    download: (content, name) => downloads.push({ content, name }),
    chooseFallbackName: async () => fallbackName,
  });
  return {
    controller,
    downloads,
    getHandle: () => activeHandle,
    setHandle: (nextHandle) => { activeHandle = nextHandle; },
  };
}

test('native Open returns the readable and writable handle for subsequent Save calls', async () => {
  const openedHandle = fakeFileHandle('Opened Drawing.paramagic', { permission: 'prompt' });
  let savePickerCalls = 0;
  const { controller, getHandle, setHandle } = createController({
    openPicker: async () => [openedHandle],
    picker: async () => { savePickerCalls += 1; return openedHandle; },
  });

  const opened = await controller.open();
  assert.equal(opened.status, 'opened');
  assert.equal(opened.handle, openedHandle);
  assert.equal(await opened.file.text(), 'opened:Opened Drawing.paramagic');

  // The application retains the handle only after the drawing parses successfully.
  setHandle(opened.handle);
  const saved = await controller.save('Opened Drawing');

  assert.equal(saved.method, 'file-system');
  assert.equal(savePickerCalls, 0);
  assert.deepEqual(openedHandle.writes, ['drawing:Opened Drawing', 'closed']);
  assert.equal(getHandle(), openedHandle);
});

test('unsupported native Open reports fallback to the traditional file input', async () => {
  const { controller } = createController({ openPicker: undefined });
  assert.deepEqual(await controller.open(), { status: 'fallback' });
});

test('an unsaved drawing Save launches Save As, writes the file, and retains its handle', async () => {
  const selectedHandle = fakeFileHandle('New Bodice.paramagic');
  const { controller, downloads, getHandle } = createController({
    picker: async (options) => {
      assert.equal(options.suggestedName, 'Untitled Drawing.paramagic');
      return selectedHandle;
    },
  });

  const result = await controller.save('Untitled Drawing');

  assert.deepEqual(result, {
    status: 'saved',
    method: 'file-system',
    name: 'New Bodice',
    handle: selectedHandle,
  });
  assert.deepEqual(selectedHandle.writes, ['drawing:New Bodice', 'closed']);
  assert.equal(getHandle(), selectedHandle);
  assert.deepEqual(downloads, []);
});

test('Save reuses a retained file handle and requests write permission after recall', async () => {
  const recalledHandle = fakeFileHandle('Recalled Drawing.paramagic', { permission: 'prompt' });
  const { controller } = createController({
    handle: recalledHandle,
    picker: async () => { throw new Error('Save As should not open.'); },
  });

  const result = await controller.save('Autosaved Label');

  assert.equal(result.method, 'file-system');
  assert.equal(result.name, 'Recalled Drawing');
  assert.deepEqual(recalledHandle.requests, [
    ['query', { mode: 'readwrite' }],
    ['request', { mode: 'readwrite' }],
  ]);
  assert.deepEqual(recalledHandle.writes, ['drawing:Recalled Drawing', 'closed']);
});

test('a denied retained handle falls back to download without forgetting the handle', async () => {
  const deniedHandle = fakeFileHandle('Protected Drawing.paramagic', { permission: 'denied' });
  const { controller, downloads, getHandle } = createController({ handle: deniedHandle });

  const result = await controller.save('Protected Drawing');

  assert.equal(result.method, 'download');
  assert.deepEqual(downloads, [{ content: 'drawing:Protected Drawing', name: 'Protected Drawing' }]);
  assert.equal(getHandle(), deniedHandle);
});

test('unsupported Save As uses the name modal and download fallback', async () => {
  const previousHandle = fakeFileHandle('Previous.paramagic');
  const { controller, downloads, getHandle } = createController({
    handle: previousHandle,
    picker: undefined,
    fallbackName: 'Downloaded Copy',
  });

  const result = await controller.saveAs('Previous');

  assert.equal(result.method, 'download');
  assert.equal(result.name, 'Downloaded Copy');
  assert.deepEqual(downloads, [{ content: 'drawing:Downloaded Copy', name: 'Downloaded Copy' }]);
  assert.equal(getHandle(), null);
});

test('cancelling the native Save As picker makes no file or download', async () => {
  const cancellation = new Error('cancelled');
  cancellation.name = 'AbortError';
  const { controller, downloads } = createController({ picker: async () => { throw cancellation; } });

  assert.deepEqual(await controller.saveAs('Unchanged'), { status: 'cancelled' });
  assert.deepEqual(downloads, []);
});

test('file-handle helpers request permission and close successful writes', async () => {
  const handle = fakeFileHandle('Helpers.paramagic', { permission: 'prompt' });

  assert.equal(await ensureFileHandleWritePermission(handle), true);
  await writeTextToFileHandle(handle, 'contents');

  assert.deepEqual(handle.writes, ['contents', 'closed']);
});

test('exports show the native picker before serializing and write the selected file', async () => {
  const events = [];
  const handle = fakeFileHandle('Pattern.svg');
  const result = await exportTextFileWithPicker({
    createContent: async () => { events.push('serialize'); return '<svg />'; },
    description: 'SVG Drawing',
    download: () => events.push('download'),
    extension: 'svg',
    mimeType: 'image/svg+xml',
    pickerId: 'paramagic-export-svg',
    showSaveFilePicker: async (options) => {
      events.push('picker');
      assert.equal(options.id, 'paramagic-export-svg');
      assert.equal(options.suggestedName, 'Pattern.svg');
      assert.deepEqual(options.types[0].accept, { 'image/svg+xml': ['.svg'] });
      return handle;
    },
    suggestedName: 'Pattern.svg',
  });

  assert.deepEqual(events, ['picker', 'serialize']);
  assert.deepEqual(handle.writes, ['<svg />', 'closed']);
  assert.equal(result.method, 'file-system');
});

test('blocked export pickers fall back to downloading the generated file', async () => {
  const blocked = new Error('blocked');
  blocked.name = 'SecurityError';
  const downloads = [];
  const result = await exportTextFileWithPicker({
    createContent: async () => '{"stack":true}',
    download: (content, name, mimeType) => downloads.push({ content, name, mimeType }),
    extension: '.json',
    mimeType: 'application/json',
    showSaveFilePicker: async () => { throw blocked; },
    suggestedName: 'Stack.json',
  });

  assert.equal(result.method, 'download');
  assert.deepEqual(downloads, [{ content: '{"stack":true}', name: 'Stack.json', mimeType: 'application/json' }]);
});

test('cancelling an export picker does not serialize or download', async () => {
  const cancellation = new Error('cancelled');
  cancellation.name = 'AbortError';
  let serialized = false;
  let downloaded = false;
  const result = await exportTextFileWithPicker({
    createContent: async () => { serialized = true; return 'unused'; },
    download: () => { downloaded = true; },
    extension: 'dxf',
    mimeType: 'application/dxf',
    showSaveFilePicker: async () => { throw cancellation; },
    suggestedName: 'Drawing.dxf',
  });

  assert.deepEqual(result, { status: 'cancelled' });
  assert.equal(serialized, false);
  assert.equal(downloaded, false);
});

test('multi-format Save As defaults to ParaMagic and writes the format selected by extension', async () => {
  const events = [];
  const handle = fakeFileHandle('Pattern.png');
  const result = await saveFileAsWithPicker({
    formats: saveFormats,
    defaultFormat: 'paramagic',
    suggestedBaseName: 'Pattern',
    createContent: async (format, name) => {
      events.push(['serialize', format, name]);
      return `content:${format}`;
    },
    download: () => events.push(['download']),
    showSaveFilePicker: async (options) => {
      events.push(['picker']);
      assert.equal(options.suggestedName, 'Pattern.paramagic');
      assert.equal(options.excludeAcceptAllOption, true);
      assert.deepEqual(options.types.map(({ accept }) => Object.values(accept)[0][0]), [
        '.paramagic', '.dxf', '.svg', '.png', '.json',
      ]);
      return handle;
    },
  });

  assert.deepEqual(events, [
    ['picker'],
    ['serialize', 'png', 'Pattern.png'],
  ]);
  assert.deepEqual(handle.writes, ['content:png', 'closed']);
  assert.equal(result.format, 'png');
  assert.equal(result.name, 'Pattern.png');
});

test('multi-format Save As fallback uses the chosen format, extension, and MIME type', async () => {
  const downloads = [];
  const result = await saveFileAsWithPicker({
    formats: saveFormats,
    defaultFormat: 'paramagic',
    suggestedBaseName: 'Pattern',
    showSaveFilePicker: undefined,
    chooseFallbackTarget: async ({ defaultFormat, formats }) => {
      assert.equal(defaultFormat, 'paramagic');
      assert.deepEqual(formats.map(({ key }) => key), ['paramagic', 'dxf', 'svg', 'png', 'json']);
      return { name: 'Pattern Copy.paramagic', format: 'json' };
    },
    createContent: async (format, name) => `content:${format}:${name}`,
    download: (content, name, mimeType) => downloads.push({ content, name, mimeType }),
  });

  assert.equal(result.format, 'json');
  assert.equal(result.name, 'Pattern Copy.json');
  assert.deepEqual(downloads, [{
    content: 'content:json:Pattern Copy.json',
    name: 'Pattern Copy.json',
    mimeType: 'application/json',
  }]);
  assert.equal(saveFormatForFileName('example.DXF', saveFormats, 'paramagic').key, 'dxf');
});
