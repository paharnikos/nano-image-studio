/* eslint-disable @typescript-eslint/no-require-imports */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const fake = require('fake-indexeddb');
// Compile the real TS modules in memory; tests never touch a browser's database.
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  module._compile(outputText, filename);
};
const db = require('../lib/library-db.ts');
const format = require('../lib/backup-format.ts');
const backup = require('../lib/library-backup.ts');
const generation = require('../lib/generation-client.ts');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
const settings = { model: 'hidream', size: '1024x1024', n: 1, guidance_scale: 7.5, num_inference_steps: 30, seed: 0 };
const record = (id = 'one', extra = {}) => ({ id, createdAt: 1000, prompt: 'Coastal evening', settings: { ...settings }, images: [png], ...extra });
const preset = { id: 'preset-1', name: 'Coast', createdAt: 1000, prompt: 'Coastal evening', settings };
const progress = () => {};
// FileReader is a browser adapter; use equivalent Blob encoding in Node.
global.FileReader = class {
  readAsDataURL(blob) { blob.arrayBuffer().then(bytes => { this.result = `data:${blob.type};base64,${Buffer.from(bytes).toString('base64')}`; this.onload(); }).catch(error => { this.error = error; this.onerror(); }); }
};
beforeEach(() => { global.indexedDB = new fake.IDBFactory(); global.IDBKeyRange = fake.IDBKeyRange; });
async function rawOpen(version) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('nano-studio', version);
    request.onupgradeneeded = () => request.result.createObjectStore('generations', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
}
async function legacy(records) {
  const connection = await rawOpen(1);
  await new Promise((resolve, reject) => {
    const tx = connection.transaction('generations', 'readwrite');
    records.forEach(item => tx.objectStore('generations').put(item));
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  }); connection.close();
}
async function count(store) {
  const connection = await rawOpen(4);
  const value = await new Promise((resolve, reject) => {
    const tx = connection.transaction(store); const request = tx.objectStore(store).count();
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  }); connection.close(); return value;
}

test('legacy migration preserves records and removes originals only after a complete commit', async () => {
  await legacy([record('a'), record('b', { seed: undefined, cost: undefined, remainingBalance: undefined })]);
  await db.initializeLibrary();
  assert.equal(await count('generations'), 0);
  assert.equal(await count('metadata'), 2);
  assert.equal(await count('images'), 2);
  const loaded = await db.loadGeneration('a');
  assert.equal(loaded.record.settings.seed, 0);
  assert.ok(loaded.record.images[0].startsWith('blob:'));
  loaded.release();
  await db.initializeLibrary();
  assert.equal(await count('metadata'), 2);
});

test('interrupted migration keeps the failed original and resumes without duplicating successful records', async () => {
  await legacy([record('a'), record('b')]);
  const original = fake.IDBObjectStore.prototype.put;
  fake.IDBObjectStore.prototype.put = function(value, ...args) {
    if (this.name === 'images' && value.generationId === 'b') throw new DOMException('Storage full', 'QuotaExceededError');
    return original.call(this, value, ...args);
  };
  try { await assert.rejects(db.initializeLibrary(), /Storage full/); }
  finally { fake.IDBObjectStore.prototype.put = original; }
  assert.equal(await count('generations'), 1);
  assert.equal(await count('metadata'), 1);
  await db.initializeLibrary();
  assert.equal(await count('generations'), 0);
  assert.equal(await count('metadata'), 2);
});

test('paged query combines prompt search, all tags, favorite, model, sort, and Trash without reading images', async () => {
  await db.initializeLibrary();
  for (let i = 0; i < 1005; i++) await db.saveGeneration(record(`r${i}`, { createdAt: i + 1, favorite: i % 2 === 0, tags: i % 2 === 0 ? ['coast', 'study'] : ['coast'] }));
  const original = fake.IDBDatabase.prototype.transaction;
  fake.IDBDatabase.prototype.transaction = function(stores, ...args) {
    assert.ok(![stores].flat().some(name => ['images', 'generations', 'thumbnails'].includes(name)), 'Queries must read metadata only');
    return original.call(this, stores, ...args);
  };
  try {
    const first = await db.queryLibrary(db.emptyQuery);
    assert.equal(first.records.length, 40); assert.equal(first.total, 1005); assert.equal(first.records[0].id, 'r1004');
    assert.equal((await db.queryLibrary(db.emptyQuery, 1000)).records.length, 5);
    const filtered = await db.queryLibrary({ ...db.emptyQuery, search: 'COASTAL', tags: ['coast', 'study'], favorite: true, model: 'hidream', oldest: true });
    assert.equal(filtered.total, 503); assert.equal(filtered.records[0].id, 'r0');
  } finally { fake.IDBDatabase.prototype.transaction = original; }
  await db.updateGenerations(['r0', 'r2'], { deletedAt: Date.now() });
  assert.equal((await db.queryLibrary({ ...db.emptyQuery, trash: true })).total, 2);
  await db.updateGenerations(['r0'], { deletedAt: undefined, tags: ['extra'] }, true);
  assert.deepEqual((await db.getMetadata('r0')).tags, ['coast', 'study', 'extra']);
  await db.permanentlyDelete(['r0', 'r2']);
  assert.ok(await db.getMetadata('r0'), 'Live records cannot be permanently deleted');
  assert.equal(await db.getMetadata('r2'), undefined);
  assert.equal((await db.getImages('r2')).length, 0);
});

test('presets save, rename, apply data with seed zero, and delete without any generation request', async () => {
  await db.savePreset(preset);
  await db.savePreset({ ...preset, name: 'Renamed' });
  assert.equal((await db.listPresets())[0].name, 'Renamed');
  assert.equal((await db.listPresets())[0].settings.seed, 0);
  await db.deletePreset(preset.id);
  assert.equal((await db.listPresets()).length, 0);
});

test('backup round trip preserves images, optional metadata and presets, excludes extra credentials, skips identical imports', async () => {
  await db.saveGeneration(record('one', { tags: ['coast'], favorite: true, cost: 0.03, remainingBalance: 1.01, apiKey: 'secret' }));
  await db.savePreset({ ...preset, apiKey: 'secret' });
  const file = await backup.exportLibrary(undefined, progress);
  const text = await file.text();
  assert.ok(!text.includes('secret')); assert.ok(!text.includes('apiKey'));
  const preview = format.validateBackup(JSON.parse(text));
  assert.equal(preview.errors.length, 0);
  assert.equal(preview.backup.generations[0].images[0], png);
  global.indexedDB = new fake.IDBFactory(); global.IDBKeyRange = fake.IDBKeyRange;
  assert.match(await backup.importLibrary(preview.backup, progress), /2 entries imported/);
  assert.match(await backup.importLibrary(preview.backup, progress), /2 identical entries skipped/);
  assert.equal(await count('metadata'), 1);
  assert.equal((await db.listPresets()).length, 1);
  const selected = JSON.parse(await (await backup.exportLibrary(['one'], progress)).text());
  assert.equal(selected.presets.length, 0);
});

test('conflicting IDs preserve both generations and presets', async () => {
  await db.saveGeneration(record()); await db.savePreset(preset);
  const incoming = format.validateBackup({ format: 'nano-studio', version: 1, generations: [record('one', { prompt: 'Different image' })], presets: [{ ...preset, name: 'Different preset' }] });
  assert.match(await backup.importLibrary(incoming.backup, progress), /2 conflicts kept/);
  assert.equal(await count('metadata'), 2);
  assert.equal((await db.getMetadata('one')).prompt, 'Coastal evening');
  assert.equal((await db.listPresets()).length, 2);
  assert.match(await backup.importLibrary(incoming.backup, progress), /2 identical entries skipped/);
  assert.equal(await count("metadata"), 2);
});

test('backup validation identifies malformed entries before any writes and rejects unsupported formats', async () => {
  await db.initializeLibrary();
  assert.throws(() => format.validateBackup({ format: 'other', version: 1 }), /Unsupported/);
  const preview = format.validateBackup({ format: 'nano-studio', version: 1, generations: [record(), record('bad', { images: ['https://example.com/image.png'] }), record('bad2', { settings: { ...settings, seed: -1 } })], presets: [{ ...preset, name: '' }] });
  assert.equal(preview.errors.length, 3);
  assert.equal(await count('metadata'), 0);
  assert.equal(await count('presets'), 0);
});

test('failed save leaves a successful generated image usable, and retry does not repeat the paid request', async () => {
  let calls = 0;
  const originalFetch = global.fetch;
  global.fetch = async (...args) => {
    if (args[0] === '/api/generate') { calls++; return Response.json({ images: [png], cost: 0.03 }); }
    return originalFetch(...args);
  };
  try {
    const result = await generation.requestGeneration('test-only', { prompt: 'Coast', settings });
    const original = fake.IDBObjectStore.prototype.put;
    fake.IDBObjectStore.prototype.put = function(value, ...args) {
      if (this.name === 'images') throw new DOMException('Storage full', 'QuotaExceededError');
      return original.call(this, value, ...args);
    };
    try { await assert.rejects(db.saveGeneration(result), /Storage full/); }
    finally { fake.IDBObjectStore.prototype.put = original; }
    assert.equal(result.images[0], png);
    assert.equal(await count('metadata'), 0);
    await db.saveGeneration(result);
    assert.equal(calls, 1);
    assert.equal(await count('metadata'), 1);
  } finally { global.fetch = originalFetch; }
});

test('request snapshots survive edits while awaiting generation', async () => {
  const input = { prompt: 'Original', negativePrompt: 'text', settings: { ...settings } };
  const originalFetch = global.fetch;
  let finish;
  global.fetch = async () => new Promise(resolve => { finish = resolve; });
  try {
    const pending = generation.requestGeneration('test-only', input);
    input.prompt = 'Edited'; input.settings.seed = 999; input.settings.model = 'changed';
    finish(Response.json({ images: [png] }));
    const result = await pending;
    assert.equal(result.prompt, 'Original'); assert.equal(result.settings.seed, 0); assert.equal(result.settings.model, 'hidream');
  } finally { global.fetch = originalFetch; }
});

test('unsupported restored values require correction, while seed zero is supported', () => {
  const models = [{ id: 'hidream', supported_parameters: { resolutions: ['1024x1024'], fixed_image_count: 1, max_images: 1 } }];
  assert.deepEqual(generation.settingsIssues(settings, models), []);
  assert.match(generation.settingsIssues({ ...settings, model: 'removed' }, models)[0], /unavailable/);
  assert.equal(generation.settingsIssues({ ...settings, size: 'old', n: 2 }, models).length, 2);
});

test('storage denial rejects with a recoverable error', async () => {
  global.indexedDB = { open() { throw new DOMException('Storage denied', 'SecurityError'); } };
  await assert.rejects(db.initializeLibrary(), /Storage denied/);
});

test('invalid import cannot write any valid entries preceding a malformed record', async () => {
  await db.initializeLibrary();
  await assert.rejects(backup.importLibrary({ format: 'nano-studio', version: 1, generations: [record(), record('bad', { images: ['data:image/png;base64,aGVsbG8='] })], presets: [] }, progress), /Nothing was imported/);
  assert.equal(await count('metadata'), 0);
});

test('quota failure during import reports partial progress and retries skip already committed records', async () => {
  const incoming = { format: 'nano-studio', version: 1, generations: [record('a'), record('b')], presets: [] };
  const original = fake.IDBObjectStore.prototype.put;
  fake.IDBObjectStore.prototype.put = function(value, ...args) {
    if (this.name === 'images' && value.generationId === 'b') throw new DOMException('Storage full', 'QuotaExceededError');
    return original.call(this, value, ...args);
  };
  try { await assert.rejects(backup.importLibrary(incoming, progress), /after saving 1 entries/); }
  finally { fake.IDBObjectStore.prototype.put = original; }
  assert.equal(await count('metadata'), 1);
  assert.match(await backup.importLibrary(incoming, progress), /1 entries imported; 1 identical entries skipped/);
  assert.equal(await count('metadata'), 2);
});

test('active image object URLs are released explicitly', async () => {
  await db.saveGeneration(record());
  const revoked = [], original = URL.revokeObjectURL;
  URL.revokeObjectURL = url => { revoked.push(url); original.call(URL, url); };
  try {
    const loaded = await db.loadGeneration('one');
    loaded.release();
    assert.deepEqual(revoked, loaded.record.images);
  } finally { URL.revokeObjectURL = original; }
});

test('lineage upgrade, direct children, Trash and source deletion preserve iterations', async () => {
  const connection = await new Promise((resolve, reject) => {
    const request = indexedDB.open('nano-studio', 2);
    request.onupgradeneeded = () => {
      const conn = request.result;
      conn.createObjectStore('generations', { keyPath: 'id' });
      const meta = conn.createObjectStore('metadata', { keyPath: 'id' }); meta.createIndex('createdAt', 'createdAt');
      meta.put(db.metadata(record('v2-existing')));
      conn.createObjectStore('images', { keyPath: 'id' }).createIndex('generationId', 'generationId');
      conn.createObjectStore('thumbnails', { keyPath: 'id' });
      conn.createObjectStore('presets', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  connection.close();
  await db.saveGeneration(record('parent'));
  assert.equal((await db.getMetadata('v2-existing')).settings.seed, 0);
  assert.equal((await db.getMetadata('v2-existing')).source, undefined);
  for (let i = 0; i < 12; i++) await db.saveGeneration(record(`child-${i}`, { source: { generationId: 'parent', variationIndex: 0 } }));
  await db.saveGeneration(record('unresolved', { source: { generationId: 'parent', variationIndex: 0, unresolved: true } }));
  assert.equal((await db.directIterations('parent')).records.length, 10);
  assert.equal((await db.directIterations('parent', 10)).records.length, 2);
  assert.equal((await db.directIterations('parent')).total, 12);
  await db.updateGenerations(['parent'], { deletedAt: 1 });
  const trashed = await db.loadImage({ generationId: 'parent', variationIndex: 0 }); trashed.release();
  await db.permanentlyDelete(['parent']);
  assert.equal((await db.directIterations('parent')).total, 12);
  await assert.rejects(db.loadImage({ generationId: 'parent', variationIndex: 0 }));
});

test('comparison loads exactly the selected variation and releases its object URL', async () => {
  await db.saveGeneration(record('many', { images: [png, png, png] }));
  const originalGet = fake.IDBObjectStore.prototype.get, originalRevoke = URL.revokeObjectURL;
  const reads = [], revoked = [];
  fake.IDBObjectStore.prototype.get = function(key) { if (this.name === 'images') reads.push(key); return originalGet.call(this, key); };
  URL.revokeObjectURL = url => { revoked.push(url); originalRevoke(url); };
  try {
    const image = await db.loadImage({ generationId: 'many', variationIndex: 1 });
    assert.deepEqual(reads, ['many:1']); image.release(); assert.deepEqual(revoked, [image.url]);
    await assert.rejects(db.loadImage({ generationId: 'many', variationIndex: 4 }));
    await assert.rejects(db.loadImage({ generationId: 'many', variationIndex: 0, unresolved: true }));
  } finally { fake.IDBObjectStore.prototype.get = originalGet; URL.revokeObjectURL = originalRevoke; }
});

test('v2 lineage imports remap conflicting parents, preserve unresolved sources and retry safely', async () => {
  await db.saveGeneration(record('parent', { prompt: 'Local parent' }));
  const incoming = { format: 'nano-studio', version: 2, presets: [], generations: [
    record('child', { source: { generationId: 'parent', variationIndex: 0 } }), record('parent'),
    record('orphan', { source: { generationId: 'absent', variationIndex: 0 } })
  ] };
  await backup.importLibrary(incoming, progress);
  const child = await db.getMetadata('child');
  assert.notEqual(child.source.generationId, 'parent');
  assert.equal((await db.getMetadata(child.source.generationId)).prompt, 'Coastal evening');
  assert.equal((await db.getMetadata('orphan')).source.unresolved, true);
  assert.match(await backup.importLibrary(incoming, progress), /0 entries imported/);
  const exported = JSON.parse(await (await backup.exportLibrary(undefined, progress)).text());
  assert.equal(exported.version, 2);
  assert.deepEqual(exported.generations.find(item => item.id === 'child').source, child.source);
  const v1 = format.validateBackup({ ...incoming, version: 1 });
  assert.ok(v1.backup.generations.every(item => !item.source));
});

test('lineage validation rejects self references, cycles and invalid variation indices before writes', async () => {
  for (const records of [
    [record('self', { source: { generationId: 'self', variationIndex: 0 } })],
    [record('a', { source: { generationId: 'b', variationIndex: 0 } }), record('b', { source: { generationId: 'a', variationIndex: 0 } })],
    [record('a'), record('b', { source: { generationId: 'a', variationIndex: 1 } })],
    [record('b', { source: { generationId: 'missing', variationIndex: -1 } })]
  ]) {
    const input = { format: 'nano-studio', version: 2, generations: records, presets: [] };
    assert.ok(format.validateBackup(input).errors.length);
    await assert.rejects(backup.importLibrary(input, progress), /Nothing was imported/);
  }
  assert.equal((await db.queryLibrary(db.emptyQuery)).total, 0);
});

test('relative navigation fits different aspect ratios, clamps centers and preserves native size', () => {
  const { viewGeometry, scrollCenter } = require('../lib/view-navigation.ts');
  const bounds = { width: 400, height: 300 }, nav = { zoom: 2, x: .7, y: .3 };
  const wide = viewGeometry({ width: 1200, height: 800 }, bounds, nav);
  const tall = viewGeometry({ width: 800, height: 1200 }, bounds, nav);
  assert.equal(wide.scale, 2 / 3); assert.equal(tall.scale, .5);
  assert.equal(tall.left, 0); assert.ok(wide.left > 0);
  assert.equal(viewGeometry({ width: 1200, height: 800 }, bounds, { ...nav, actual: true }).scale, 1);
  assert.deepEqual(scrollCenter(0, 0, { width: 200, height: 200 }, bounds), { x: .5, y: .5 });
  const resized = viewGeometry({ width: 1200, height: 800 }, { width: 800, height: 600 }, nav);
  assert.equal(resized.scale, wide.scale * 2);
});

test('generation snapshots source and settings together and never sends local lineage to the provider', async () => {
  const original = global.fetch; let finish, body;
  global.fetch = async (_url, options) => { body = JSON.parse(options.body); await new Promise(resolve => { finish = resolve; }); return { ok: true, json: async () => ({ images: [png] }) }; };
  try {
    const input = { prompt: 'Original', settings: { ...settings }, source: { generationId: 'parent', variationIndex: 0 } };
    const request = generation.requestGeneration('test', input);
    input.prompt = 'Edited'; input.settings.seed = 10; input.source.generationId = 'other'; finish();
    const result = await request;
    assert.equal(result.prompt, 'Original'); assert.equal(result.settings.seed, 0);
    assert.deepEqual(result.source, { generationId: 'parent', variationIndex: 0 });
    assert.equal(body.source, undefined);
  } finally { global.fetch = original; }
});

test('comparison differences retain multiline prompts and distinguish zero from missing values', () => {
  const { comparisonRows } = require('../lib/comparison.ts');
  const rows = comparisonRows(record('a', { prompt: 'First line\nSecond line', cost: 0 }), record('b', { settings: { ...settings, seed: undefined }, cost: undefined }));
  assert.equal(rows.find(row => row.label === 'Prompt').a, 'First line\nSecond line');
  assert.deepEqual(rows.find(row => row.label === 'Seed'), { label: 'Seed', a: '0', b: 'Unknown', changed: true });
  assert.equal(rows.find(row => row.label === 'Recorded cost').a, '$0.0000');
});

test('Custom CivitAI AIR parsing and native payload preserve explicit false and seed zero', () => {
  const { normalizeCivitaiAir, customCivitaiPayload } = require('../lib/civitai.ts');
  assert.equal(normalizeCivitaiAir('https://civitai.com/models/1025051/model?modelVersionId=1476374'), 'civitai:1025051@1476374');
  assert.equal(normalizeCivitaiAir('1025051'), undefined);
  assert.equal(normalizeCivitaiAir('https://evil.example/models/1025051?modelVersionId=1476374'), undefined);
  const payload = customCivitaiPayload({ prompt: 'Landscape', settings: { ...settings, model: 'custom-civitai', customCivitaiAir: 'civitai:1025051@1476374', num_inference_steps: 20, guidance_scale: 7, strength: .8, showExplicitContent: false } });
  assert.equal(payload.seed, 0); assert.equal(payload.steps, 20); assert.equal(payload.CFGScale, 7);
  assert.equal(payload.showExplicitContent, false); assert.equal(payload.nImages, 1);
  assert.equal(payload.scheduler, 'Default'); assert.equal(payload.resolution, '1024x1024');
  assert.throws(() => customCivitaiPayload({ prompt: 'Landscape', settings: { ...settings, model: 'custom-civitai', customCivitaiAir: '1025051' } }));
});

test('Custom CivitAI settings survive preset and library backup round trips', async () => {
  const custom = { ...settings, model: 'custom-civitai', customCivitaiAir: 'civitai:1025051@1476374', scheduler: 'Default', strength: .8, showExplicitContent: true };
  await db.saveGeneration(record('custom', { settings: custom }));
  await db.savePreset({ ...preset, settings: custom });
  const exported = JSON.parse(await (await backup.exportLibrary(undefined, progress)).text());
  assert.deepEqual(exported.generations[0].settings, custom);
  assert.deepEqual(exported.presets[0].settings, custom);
  assert.equal(format.validateBackup(exported).errors.length, 0);
  exported.generations[0].settings.strength = 9;
  assert.ok(format.validateBackup(exported).errors.length);
});

test('Custom CivitAI route uses native endpoint and x-api-key with validated aliases', async () => {
  const { POST } = require('../app/api/generate/route.ts');
  const original = global.fetch; let calls = 0;
  global.fetch = async (url, options) => {
    calls++; assert.equal(url, 'https://nano-gpt.com/api/v1/images/generations');
    assert.equal(options.headers['x-api-key'], 'fixture-key'); assert.equal(options.headers.Authorization, undefined);
    const payload = JSON.parse(options.body);
    assert.equal(payload.customCivitaiAir, 'civitai:1025051@1476374'); assert.equal(payload.steps, 20); assert.equal(payload.CFGScale, 7);
    assert.equal(payload.showExplicitContent, true); assert.equal(payload.seed, 0);
    return Response.json({ data: [{ b64_json: png.split(',')[1] }], cost: .0051 });
  };
  try {
    const body = { apiKey: 'fixture-key', prompt: 'Mountain landscape', model: 'custom-civitai', customCivitaiAir: 'civitai:1025051@1476374', steps: 20, CFGScale: 7, scheduler: 'Default', strength: .8, resolution: '1024x1024', nImages: 1, seed: 0, showExplicitContent: true };
    const request = value => new Request('http://localhost/api/generate', { method: 'POST', body: JSON.stringify(value) });
    const response = await POST(request(body)); assert.equal(response.status, 200); assert.deepEqual((await response.json()).images, [png]);
    assert.equal((await POST(request({ ...body, steps: 100 }))).status, 400);
    assert.equal((await POST(request({ ...body, customCivitaiAir: '' }))).status, 400);
    assert.equal(calls, 1);
  } finally { global.fetch = original; }
});

const batches = require('../lib/batch-db.ts');
const batchTypes = require('../lib/batch-types.ts');
const runner = require('../lib/batch-runner.ts');
const coordinator = require('../lib/generation-coordinator.ts');
const exportsBatch = require('../lib/batch-export.ts');
const models = [{ id: 'hidream', name: 'HiDream', supported_parameters: { resolutions: ['1024x1024'], max_images: 4 } }];
function installLocks() {
  let held = false;
  Object.defineProperty(global, 'navigator', { configurable: true, value: { locks: { request: async (_name, _options, callback) => {
    if (held) return callback(null);
    held = true; try { return await callback({ name: 'fixture' }); } finally { held = false; }
  } } } });
}
const jobInput = () => ({ prompt: 'Batch landscape', settings: { ...settings }, source: { generationId: 'parent', variationIndex: 0 } });

test('batch builders expand prompt-first, preserve zero and snapshots, and reject oversized expansions', () => {
  const input = jobInput();
  const jobs = batchTypes.expandBatch(input, 'One\nTwo', 'line', 'range', 2, 0, '');
  assert.deepEqual(jobs.map(j => [j.prompt, j.settings.seed]), [['One', 0], ['One', 1], ['Two', 0], ['Two', 1]]);
  input.settings.seed = 22; input.source.generationId = 'changed';
  assert.equal(jobs[0].settings.seed, 0); assert.equal(jobs[0].source.generationId, 'parent');
  assert.equal(batchTypes.expandBatch(input, 'First\nline\n\nSecond', 'paragraph', 'list', 1, 0, '0, 8')[0].prompt, 'First\nline');
  assert.equal(batchTypes.expandBatch(input, 'One', 'line', 'random', 2, 0, '')[0].settings.seed, undefined);
  assert.throws(() => batchTypes.expandBatch(input, 'One\nTwo', 'line', 'range', 51, 0, ''));
  assert.throws(() => batchTypes.expandBatch(input, 'One', 'line', 'list', 1, 0, '1, nope'));
});

test('batch queue snapshots references once, pages metadata, rejects overflow atomically, and removes orphan references', async () => {
  const batch = await batches.createBatch('Study'); const input = { ...jobInput(), imageDataUrl: png };
  await batches.appendJobs(batch.id, [input, input]); input.settings.seed = 99;
  const jobs = await batches.allJobs(batch.id); assert.equal(jobs[0].input.settings.seed, 0);
  assert.equal(await count('batchReferences'), 1); assert.equal(jobs[0].input.imageDataUrl, undefined);
  await batches.appendJobs(batch.id, Array.from({ length: 98 }, jobInput));
  assert.equal((await batches.jobsPage(batch.id)).jobs.length, 40);
  await assert.rejects(batches.appendJobs(batch.id, [jobInput()]), /100 jobs/);
  assert.equal((await batches.jobsPage(batch.id)).total, 100);
  await batches.removeJob(jobs[0]); assert.equal(await count('batchReferences'), 1);
  await batches.removeJob(jobs[1]); assert.equal(await count('batchReferences'), 0);
  await db.saveGeneration(record('kept'));
  await batches.deleteBatch(batch.id); assert.equal(await count('batchJobs'), 0); assert.ok(await db.getMetadata('kept'));
});

test('batch runner is sequential, excludes manual requests, and pauses after the current request', async () => {
  installLocks(); const batch = await batches.createBatch('Run'); await batches.appendJobs(batch.id, [jobInput(), jobInput()]);
  const original = global.fetch; let complete; let calls = 0;
  global.fetch = async (url, options) => {
    if (url !== '/api/generate') return original(url, options);
    calls++; await new Promise(resolve => { complete = resolve; }); return Response.json({ images: [png], cost: .01 });
  };
  try {
    const run = runner.runBatch(batch, () => 'fixture', () => models, () => {});
    while (!complete) await new Promise(resolve => setTimeout(resolve, 1));
    await assert.rejects(coordinator.acquireGeneration(), /Another/);
    runner.pauseBatch(); complete(); await run;
    const jobs = await batches.allJobs(batch.id); assert.equal(calls, 1); assert.equal(jobs[0].status, 'succeeded'); assert.equal(jobs[1].status, 'pending');
    assert.equal((await db.getMetadata(jobs[0].resultId)).source.generationId, 'parent');
    assert.equal(coordinator.generationBusy(), false);
  } finally { global.fetch = original; }
});

test('batch save failure retains an unsaved result and retry commits without another request', async () => {
  installLocks(); const batch = await batches.createBatch('Quota'); await batches.appendJobs(batch.id, [jobInput()]);
  const original = global.fetch, put = fake.IDBObjectStore.prototype.put; let calls = 0;
  global.fetch = async (url, options) => url === '/api/generate' ? (calls++, Response.json({ images: [png] })) : original(url, options);
  fake.IDBObjectStore.prototype.put = function(value, ...args) { if (this.name === 'images') throw new DOMException('Full', 'QuotaExceededError'); return put.call(this, value, ...args); };
  try { await runner.runBatch(batch, () => 'fixture', () => models, () => {}); }
  finally { fake.IDBObjectStore.prototype.put = put; global.fetch = original; }
  assert.ok(runner.runnerSnapshot().unsaved); assert.equal(coordinator.generationBusy(), true);
  assert.equal((await batches.allJobs(batch.id))[0].status, 'running'); assert.equal(await count('metadata'), 0);
  await runner.recoverBatchSave(false, () => {});
  assert.equal(calls, 1); assert.equal(coordinator.generationBusy(), false); assert.equal((await batches.allJobs(batch.id))[0].status, 'succeeded');
});

test('batch reload reconciliation never retries unknown work and recognizes committed results', async () => {
  const batch = await batches.createBatch('Interrupted'); await batches.appendJobs(batch.id, [jobInput(), jobInput()]);
  const jobs = await batches.allJobs(batch.id);
  await batches.putJob({ ...jobs[0], status: 'running', resultId: 'already-saved' });
  await batches.putJob({ ...jobs[1], status: 'running', resultId: 'unknown' });
  await db.saveGeneration(record('already-saved')); await batches.putBatch({ ...batch, running: true });
  await batches.reconcileBatches(); const restored = await batches.allJobs(batch.id);
  assert.deepEqual(restored.map(j => j.status), ['succeeded', 'unknown']); assert.equal((await batches.listBatches())[0].running, false);
});

test('batch API failure pauses and network uncertainty is distinct', async () => {
  installLocks(); const batch = await batches.createBatch('Errors'); await batches.appendJobs(batch.id, [jobInput(), jobInput()]);
  const original = global.fetch; let calls = 0;
  global.fetch = async (url, options) => { if (url !== '/api/generate') return original(url, options); calls++; return Response.json({ error: 'Rejected' }, { status: 400 }); };
  await runner.runBatch(batch, () => 'fixture', () => models, () => {});
  assert.deepEqual((await batches.allJobs(batch.id)).map(j => j.status), ['failed', 'pending']); assert.equal(calls, 1);
  global.fetch = async (url, options) => { if (url !== '/api/generate') return original(url, options); throw new Error('Network lost'); };
  try { await runner.runBatch(batch, () => 'fixture', () => models, () => {}); } finally { global.fetch = original; }
  assert.deepEqual((await batches.allJobs(batch.id)).map(j => j.status), ['failed', 'unknown']);
});

test('batch ZIP and JSON export results and manifest without references or credentials', async () => {
  const batch = await batches.createBatch('Export'); await batches.appendJobs(batch.id, [{ ...jobInput(), imageDataUrl: png }]);
  const job = (await batches.allJobs(batch.id))[0]; const result = record('batch-result'); await db.saveGeneration(result, false, job);
  const file = await exportsBatch.exportBatchZIP(batch, () => {}, new AbortController().signal);
  const { unzipSync, strFromU8 } = require('fflate'); const zip = unzipSync(new Uint8Array(await file.arrayBuffer()));
  assert.ok(zip['job-001/1.png']); const manifest = JSON.parse(strFromU8(zip['manifest.json']));
  assert.equal(manifest.jobs[0].status, 'succeeded'); assert.equal(manifest.jobs[0].input.imageDataUrl, undefined);
  const json = JSON.parse(await (await exportsBatch.exportBatchJSON(batch.id, () => {})).text()); assert.equal(json.version, 2); assert.equal(json.generations.length, 1); assert.equal(json.batches, undefined);
  const abort = new AbortController(); abort.abort(); await assert.rejects(exportsBatch.exportBatchZIP(batch, () => {}, abort.signal), /canceled/);
});

test('cancel remaining finishes one request and stale controls cannot change completed jobs', async () => {
  installLocks(); const batch = await batches.createBatch('Cancel'); await batches.appendJobs(batch.id, [jobInput(), jobInput()]);
  const stale = (await batches.allJobs(batch.id))[0];
  const original = global.fetch; let calls = 0;
  global.fetch = async (url, options) => { if (url !== '/api/generate') return original(url, options); calls++; runner.pauseBatch(true); return Response.json({ images: [png] }); };
  try { await runner.runBatch(batch, () => 'fixture', () => models, () => {}); } finally { global.fetch = original; }
  assert.equal(calls, 1); assert.deepEqual((await batches.allJobs(batch.id)).map(j => j.status), ['succeeded', 'canceled']);
  await assert.rejects(batches.removeJob(stale), /Only pending/);
  await assert.rejects(batches.moveJob(stale, 1), /Only pending/);
  await assert.rejects(batches.editJob(stale, jobInput(), false), /Only pending/);
  await batches.copyJob(stale); assert.equal((await batches.allJobs(batch.id))[2].status, 'pending');
});

test('missing references and changes after review prevent dispatch', async () => {
  installLocks(); const batch = await batches.createBatch('Review'); await batches.appendJobs(batch.id, [jobInput()]);
  const signature = JSON.stringify(await batches.allJobs(batch.id));
  await batches.appendJobs(batch.id, [jobInput()]);
  let calls = 0; const original = global.fetch;
  global.fetch = async () => { calls++; throw new Error('Must not dispatch'); };
  try { await runner.runBatch(batch, () => 'fixture', () => models, () => {}, signature); } finally { global.fetch = original; }
  assert.equal(calls, 0); assert.match(runner.runnerSnapshot().error, /queue changed/);
  const job = (await batches.allJobs(batch.id))[0]; await batches.putJob({ ...job, referenceId: 'missing' });
  await assert.rejects(runner.validateBatch(batch.id, models), /reference image is missing/);
});

test('v3 upgrade preserves all existing records and adds only batch stores', async () => {
  const connection = await new Promise((resolve, reject) => {
    const request = indexedDB.open('nano-studio', 3);
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore('generations', { keyPath: 'id' });
      const metadata = database.createObjectStore('metadata', { keyPath: 'id' });
      metadata.createIndex('createdAt', 'createdAt'); metadata.createIndex('sourceGenerationId', 'source.generationId');
      database.createObjectStore('images', { keyPath: 'id' }); database.createObjectStore('thumbnails', { keyPath: 'id' }); database.createObjectStore('presets', { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = connection.transaction('metadata', 'readwrite'); tx.objectStore('metadata').put({ ...record('v3-kept'), imageCount: 1 });
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  }); connection.close();
  await batches.createBatch('Upgrade'); assert.equal((await db.getMetadata('v3-kept')).settings.seed, 0);
  assert.equal(await count('batchJobs'), 0); assert.equal(await count('batchReferences'), 0); assert.equal(await count('metadata'), 1);
});

test('batch exports report permanently deleted results and retain trashed results', async () => {
  const batch = await batches.createBatch('Missing results'); await batches.appendJobs(batch.id, [jobInput(), jobInput()]);
  const jobs = await batches.allJobs(batch.id);
  await db.saveGeneration(record('trashed-result', { deletedAt: 1 }), false, jobs[0]);
  await batches.putJob({ ...jobs[1], status: 'succeeded', resultId: 'permanently-deleted' });
  const { unzipSync, strFromU8 } = require('fflate');
  const zip = unzipSync(new Uint8Array(await (await exportsBatch.exportBatchZIP(batch, () => {}, new AbortController().signal)).arrayBuffer()));
  const manifest = JSON.parse(strFromU8(zip['manifest.json']));
  assert.ok(zip['job-001/1.png']); assert.deepEqual(manifest.jobs[1].missing, ['Result unavailable']);
  const json = JSON.parse(await (await exportsBatch.exportBatchJSON(batch.id, () => {})).text());
  assert.equal(json.generations.length, 1); assert.equal(json.generations[0].deletedAt, 1);
});

test('batch validation checks reference presence without reading its blob', async () => {
  const batch = await batches.createBatch('Lazy reference'); await batches.appendJobs(batch.id, [{ ...jobInput(), imageDataUrl: png }]);
  const get = fake.IDBObjectStore.prototype.get;
  fake.IDBObjectStore.prototype.get = function(...args) { if (this.name === 'batchReferences') throw new Error('Reference blob must remain unloaded'); return get.apply(this, args); };
  try { assert.equal((await runner.validateBatch(batch.id, models)).length, 1); } finally { fake.IDBObjectStore.prototype.get = get; }
});
