import { test, expect, type Page } from '@playwright/test';

async function setup(page: Page) {
  page.on('console', msg => { if (msg.type() === 'error') console.error(msg.text()); });
  page.on('pageerror', error => console.error(error));
  await page.route('**/api/models', route => route.fulfill({ json: { data: [{ id: 'hidream', name: 'HiDream', supported_parameters: { resolutions: ['1024x1024'], max_images: 4 } }] } }));
  await page.addInitScript(async () => {
    localStorage.setItem('nano-studio-api-key', 'fixture-key-no-paid-requests');
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('nano-studio', 2);
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('generations', { keyPath: 'id' });
        const metadata = db.createObjectStore('metadata', { keyPath: 'id' }); metadata.createIndex('createdAt', 'createdAt');
        const images = db.createObjectStore('images', { keyPath: 'id' }); images.createIndex('generationId', 'generationId');
        db.createObjectStore('thumbnails', { keyPath: 'id' }); db.createObjectStore('presets', { keyPath: 'id' });
        for (const [index, id] of ['a', 'b'].entries()) {
          metadata.put({ id, prompt: id === 'a' ? 'Coastal source\nMorning light' : 'Forest study', createdAt: 1000 + index, settings: { model: 'hidream', size: '1024x1024', n: 2, seed: index ? undefined : 0, guidance_scale: 7.5, num_inference_steps: 30 }, imageCount: 2 });
          for (let variation = 0; variation < 2; variation++) {
            const canvas = document.createElement('canvas'); canvas.width = index ? 800 : 1200; canvas.height = variation ? 960 : index ? 1200 : 800;
            const ctx = canvas.getContext('2d')!; ctx.fillStyle = index ? '#18785c' : '#d58030'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#fff'; ctx.fillRect(100, 100, 200, 200);
            const bytes = Uint8Array.from(atob(canvas.toDataURL('image/png').split(',')[1]), c => c.charCodeAt(0));
            images.put({ id: `${id}:${variation}`, generationId: id, index: variation, blob: new Blob([bytes], { type: 'image/png' }) });
          }
        }
      };
      request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => request.error?.name === 'VersionError' ? resolve() : reject(request.error);
    });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open generation: Forest study', exact: true })).toBeVisible();
}
async function compare(page: Page) {
  await page.getByRole('checkbox', { name: 'Select Coastal source' }).check();
  await page.getByRole('checkbox', { name: 'Select Forest study' }).check();
  await page.getByRole('button', { name: 'Compare selected' }).click();
  await expect(page.locator('.comparison-metrics').first()).toContainText('1200 × 800');
  await expect(page.locator('.comparison-metrics').last()).toContainText('800 × 1200');
}

test('comparison navigation, variations, fullscreen, responsive panel and exit', async ({ page }) => {
  await setup(page); await compare(page);
  await page.getByRole('button', { name: 'Zoom both in', exact: true }).click();
  await expect(page.getByLabel('Shared zoom')).toHaveText('1.25× fit');
  await page.getByRole('button', { name: 'Actual size', exact: true }).click();
  await expect(page.locator('.comparison-metrics').first()).toContainText('100%');
  await expect(page.locator('.comparison-metrics').last()).toContainText('100%');
  await page.getByRole('button', { name: 'Zoom A in', exact: true }).click();
  await expect(page.locator('.comparison-metrics').first()).toContainText('125%');
  await expect(page.locator('.comparison-metrics').last()).toContainText('100%');
  await page.getByRole('button', { name: 'Link views', exact: true }).click();
  await page.getByRole('button', { name: 'Fit both', exact: true }).click();
  await expect(page.getByLabel('Shared zoom')).toHaveText('1.00× fit');
  await page.getByLabel('Variation B', { exact: true }).selectOption({ value: '1' });
  await expect(page.locator('.comparison-metrics').last()).toContainText('800 × 960');
  await expect(page.getByRole('button', { name: 'Move Generation-setting differences panel.' })).toBeAttached();
  await expect(page.locator('.comparison-table-scroll')).toContainText('Unknown');
  await page.getByRole('button', { name: 'Fullscreen comparison', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  const panes = page.locator('.comparison-pane');
  const left = await panes.nth(0).boundingBox(), right = await panes.nth(1).boundingBox();
  expect(right!.x).toBeGreaterThan(left!.x + left!.width - 2);
  await page.getByRole('button', { name: 'Exit comparison fullscreen', exact: true }).click();
  await page.setViewportSize({ width: 600, height: 900 });
  await expect.poll(async () => { const a = await panes.nth(0).boundingBox(), b = await panes.nth(1).boundingBox(); return b!.y > a!.y; }).toBe(true);
  await page.getByRole('button', { name: 'Replace B', exact: true }).click();
  await page.getByRole('button', { name: 'Use the other pane’s generation' }).click();
  await page.getByLabel('Variation B', { exact: true }).selectOption({ value: '1' });
  await expect(page.locator('.comparison-metrics').last()).toContainText('1200 × 960');
  await page.getByRole('button', { name: 'Swap', exact: true }).click();
  await expect(page.getByLabel('Variation A', { exact: true })).toHaveValue('1');
  await page.getByRole('button', { name: 'Exit comparison', exact: true }).click();
  await expect(page.getByLabel('Image comparison')).toHaveCount(0);
  await expect(page.locator('.result-grid img')).toHaveCount(1);
});

test('iteration preparation is free, captures seed zero, and compares the mocked result', async ({ page }) => {
  await setup(page); await compare(page);
  const requests: Record<string, unknown>[] = [];
  await page.route('**/api/generate', async route => {
    requests.push(route.request().postDataJSON());
    const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; return c.toDataURL('image/png'); });
    await route.fulfill({ json: { images: [image, image], cost: 0.02 } });
  });
  await page.getByRole('button', { name: 'Iterate from A', exact: true }).click();
  await expect(page.locator('.iteration-draft')).toContainText('Coastal source');
  expect(requests).toHaveLength(0);
  await page.locator('.prompt-field textarea').first().fill('Edited coastal source');
  await page.getByRole('button', { name: 'Generate image', exact: true }).click();
  await expect(page.locator('.comparison-metrics').last()).toContainText('640 × 480');
  expect(requests).toHaveLength(1); expect(requests[0].seed).toBe(0); expect(requests[0].source).toBeUndefined();
  const children = await page.evaluate(async () => new Promise<Array<{ source: { generationId: string; variationIndex: number } }>>(resolve => {
    const req = indexedDB.open('nano-studio', 4); req.onsuccess = () => { const db = req.result; const get = db.transaction('metadata').objectStore('metadata').index('sourceGenerationId').getAll('a'); get.onsuccess = () => { resolve(get.result); db.close(); }; };
  }));
  expect(children).toHaveLength(1); expect(children[0].source).toEqual({ generationId: 'a', variationIndex: 0 });
  await expect(page.locator('.iteration-draft')).toContainText('Coastal source');
});

test('linked pan, keyboard resizing and object URL cleanup', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
    const urls = new Set<string>();
    Object.assign(window, { comparisonURLs: urls });
    URL.createObjectURL = blob => { const url = originalCreate(blob); urls.add(url); return url; };
    URL.revokeObjectURL = url => { urls.delete(url); originalRevoke(url); };
  });
  await compare(page);
  await expect.poll(() => page.evaluate(() => (window as unknown as { comparisonURLs: Set<string> }).comparisonURLs.size)).toBe(2);
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Zoom both in', exact: true }).click();
  const panes = page.locator('.comparison-pane');
  const av = panes.nth(0).locator('.viewer-viewport'), bv = panes.nth(1).locator('.viewer-viewport');
  const center = async (side: typeof av) => side.evaluate(el => ({ x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth, y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight }));
  await av.focus(); await av.press('ArrowRight');
  await expect.poll(async () => Math.abs((await center(av)).x - (await center(bv)).x)).toBeLessThan(.01);
  const box = await av.boundingBox();
  await page.mouse.move(box!.x + 150, box!.y + 150); await page.mouse.down(); await page.mouse.move(box!.x + 100, box!.y + 110); await page.mouse.up();
  await expect.poll(async () => Math.abs((await center(av)).y - (await center(bv)).y)).toBeLessThan(.01);
  await av.hover(); await page.mouse.wheel(0, 100);
  await expect.poll(async () => Math.abs((await center(av)).y - (await center(bv)).y)).toBeLessThan(.01);
  const zoom = await page.getByLabel('Shared zoom').textContent();
  const handle = page.getByRole('button', { name: 'Resize Image viewer panel.' });
  await handle.focus();
  for (let i = 0; i < 9; i++) await handle.press('Shift+ArrowLeft');
  await expect.poll(async () => { const a = await panes.nth(0).boundingBox(), b = await panes.nth(1).boundingBox(); return b!.y > a!.y; }).toBe(true);
  await expect(page.getByLabel('Shared zoom')).toHaveText(zoom!);
  await page.getByLabel('Variation B', { exact: true }).selectOption({ value: '1' });
  await expect(page.locator('.comparison-metrics').last()).toContainText('800 × 960');
  await expect.poll(() => page.evaluate(() => (window as unknown as { comparisonURLs: Set<string> }).comparisonURLs.size)).toBe(2);
  await page.screenshot({ path: 'test-results/resized-comparison.png' });
  await page.getByRole('button', { name: 'New exposure', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { comparisonURLs: Set<string> }).comparisonURLs.size)).toBe(0);
});

test('failed saving keeps lineage and download, retry creates no second request, repeated generations are siblings', async ({ page }) => {
  await setup(page); await compare(page);
  let calls = 0;
  await page.route('**/api/generate', async route => {
    calls++;
    const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; return c.toDataURL('image/png'); });
    await route.fulfill({ json: { images: [image], cost: 0.02 } });
  });
  await page.getByRole('button', { name: 'Iterate from A', exact: true }).click();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    Object.assign(window, { restorePut: () => { IDBObjectStore.prototype.put = put; } });
    IDBObjectStore.prototype.put = function(value, key) { if (this.name === 'metadata') throw new DOMException('Fixture quota exhausted', 'QuotaExceededError'); return key === undefined ? put.call(this, value) : put.call(this, value, key); };
  });
  await page.getByRole('button', { name: 'Generate image', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry save', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Iterate from B', exact: true })).toBeDisabled();
  await expect(page.getByRole('link', { name: 'Download B', exact: true })).toHaveAttribute('href', /^data:image/);
  await page.evaluate(() => (window as unknown as { restorePut: () => void }).restorePut());
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Iterate from B', exact: true })).toBeEnabled();
  expect(calls).toBe(1);
  await page.getByRole('button', { name: 'Generate image', exact: true }).click();
  await expect.poll(() => calls).toBe(2);
  await expect.poll(() => page.evaluate(() => new Promise<number>(resolve => {
    const req = indexedDB.open('nano-studio', 4); req.onsuccess = () => { const db = req.result; const get = db.transaction('metadata').objectStore('metadata').index('sourceGenerationId').count('a'); get.onsuccess = () => { resolve(get.result); db.close(); }; };
  }))).toBe(2);
  await page.getByRole('button', { name: 'Remove source', exact: true }).click();
  await expect(page.locator('.iteration-draft')).toHaveCount(0);
});

test('viewer picker and draft source survive selection, presets clear it, deleted parents remain unavailable', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  await page.getByLabel('Search comparison images', { exact: true }).fill('Coastal');
  await expect(page.locator('.comparison-picker-list button')).toHaveCount(1);
  await page.locator('.comparison-picker-list button').click();
  await expect(page.locator('.comparison-metrics').last()).toContainText('1200 × 800');
  await page.getByRole('button', { name: 'Iterate from B', exact: true }).click();
  await page.getByRole('button', { name: 'Open generation: Forest study', exact: true }).click();
  await expect(page.locator('.iteration-draft')).toContainText('Coastal source');
  await page.getByText('Prompt presets', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Preset name', exact: true }).fill('Fixture preset');
  await page.getByRole('button', { name: 'Save current as new', exact: true }).click();
  await page.getByRole('button', { name: 'Apply preset', exact: true }).click();
  await expect(page.locator('.iteration-draft')).toHaveCount(0);
  await page.getByRole('button', { name: 'Iterate from this', exact: true }).first().click();
  await page.getByRole('region', { name: 'Generation details', exact: true }).scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'Use settings', exact: true }).click();
  await expect(page.locator('.iteration-draft')).toHaveCount(0);
  // Add a child of A, then use the real Trash/permanent-delete controls on its parent.
  await page.evaluate(() => new Promise<void>(resolve => {
    const req = indexedDB.open('nano-studio', 4); req.onsuccess = () => {
      const db = req.result, tx = db.transaction('metadata', 'readwrite'), store = tx.objectStore('metadata');
      const get = store.get('b'); get.onsuccess = () => store.put({ ...get.result, source: { generationId: 'a', variationIndex: 0 } });
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }));
  await page.getByRole('button', { name: 'Open generation: Forest study', exact: true }).click();
  await expect(page.locator('.iteration-history')).toContainText('Source: Coastal source');
  await page.getByRole('checkbox', { name: 'Select Coastal source' }).check();
  await page.getByRole('button', { name: 'Move to Trash', exact: true }).click();
  await expect(page.locator('.iteration-history')).toContainText('In Trash');
  await page.getByRole('button', { name: 'Trash', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Select Coastal source' }).check();
  await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm permanent deletion', exact: true }).click();
  await expect(page.locator('.iteration-history')).toContainText('Source unavailable');
  await expect(page.locator('.result-grid img')).toHaveCount(2);
});

test('missing comparison image is recoverable without losing the other pane', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => new Promise<void>(resolve => {
    const req = indexedDB.open('nano-studio', 4); req.onsuccess = () => {
      const db = req.result, tx = db.transaction('images', 'readwrite'); tx.objectStore('images').delete('b:0');
      tx.oncomplete = () => { db.close(); resolve(); };
    };
  }));
  await page.getByRole('checkbox', { name: 'Select Coastal source' }).check();
  await page.getByRole('checkbox', { name: 'Select Forest study' }).check();
  await page.getByRole('button', { name: 'Compare selected' }).click();
  await expect(page.locator('.comparison-pane').last().getByRole('alert')).toContainText('missing');
  await expect(page.locator('.comparison-metrics').first()).toContainText('1200 × 800');
  await page.getByRole('button', { name: 'Replace B', exact: true }).click();
  await page.getByRole('button', { name: 'Use the other pane’s generation' }).click();
  await expect(page.locator('.comparison-pane').last().locator('img')).toBeVisible();
  // Selecting the already displayed variation must not erase known dimensions.
  await page.getByLabel('Variation B', { exact: true }).selectOption({ value: '0' });
  await expect(page.locator('.comparison-metrics').last()).toContainText('1200 × 800');
});

test('details and differences have independent movable, resizable, persistent panels', async ({ page }) => {
  await setup(page); await compare(page);
  const details = page.getByRole('region', { name: 'Generation details', exact: true });
  await expect(details).toContainText('Forest study');
  const differences = page.getByRole('region', { name: 'Generation-setting differences', exact: true });
  await expect(differences).toContainText('Unknown');
  const move = page.getByRole('button', { name: 'Move Generation details panel.' });
  await move.scrollIntoViewIfNeeded();
  const panel = details.locator('..').locator('..');
  const before = await panel.evaluate(el => ({ left: (el as HTMLElement).style.left, width: (el as HTMLElement).style.width }));
  await move.focus(); await move.press('Shift+ArrowRight');
  await expect.poll(() => panel.evaluate(el => (el as HTMLElement).style.left)).not.toBe(before.left);
  const resize = page.getByRole('button', { name: 'Resize Generation details panel.' });
  await resize.focus(); await resize.press('Shift+ArrowRight');
  await expect.poll(() => panel.evaluate(el => (el as HTMLElement).style.width)).not.toBe(before.width);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('nano-studio-panel-layout-v1')!));
  expect(saved).toHaveLength(6);
  await page.screenshot({ path: 'test-results/metadata-panels.png' });
  await page.reload();
  await expect.poll(() => panel.evaluate(el => (el as HTMLElement).style.width)).toBe(`${saved[3].width}px`);
});

test('Custom CivitAI controls validate versions and preserve settings in the generated record', async ({ page }) => {
  await setup(page);
  await page.locator('.control-panel select').filter({ has: page.locator('option[value="custom-civitai"]') }).selectOption('custom-civitai');
  await page.locator('.prompt-field textarea').first().fill('Mountain landscape at sunrise');
  await expect(page.getByRole('button', { name: 'Generate image', exact: true })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Checkpoint AIR or version URL' }).fill('https://civitai.com/models/1025051/model?modelVersionId=1476374');
  await page.getByRole('textbox', { name: 'Scheduler', exact: true }).focus();
  await expect(page.getByRole('textbox', { name: 'Checkpoint AIR or version URL' })).toHaveValue('civitai:1025051@1476374');
  await page.getByRole('checkbox', { name: 'Allow explicit content' }).check();
  const fileInput = page.getByLabel('Reference image (optional)', { exact: true });
  await fileInput.setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await expect(page.locator('.civitai-controls').getByRole('alert')).toContainText('PNG, JPEG or WebP');
  const reference = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; return c.toDataURL('image/png'); });
  await fileInput.setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from(reference.split(',')[1], 'base64') });
  await expect(page.getByRole('button', { name: 'Remove reference', exact: true })).toBeVisible();
  let captured: Record<string, unknown> | undefined;
  await page.route('**/api/generate', async route => {
    captured = route.request().postDataJSON();
    const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 640; c.height = 480; return c.toDataURL('image/png'); });
    await route.fulfill({ json: { images: [image], cost: .0051 } });
  });
  await page.getByRole('button', { name: 'Generate image', exact: true }).click();
  await expect(page.locator('.result-grid img')).toHaveCount(1);
  expect(captured?.customCivitaiAir).toBe('civitai:1025051@1476374');
  expect(captured?.showExplicitContent).toBe(true); expect(captured?.num_inference_steps).toBe(20);
  expect(captured?.scheduler).toBe('Default'); expect(captured?.strength).toBe(.8);
  expect(captured?.imageDataUrl).toBe(reference);
  await expect(page.getByRole('region', { name: 'Generation details', exact: true })).toContainText('civitai:1025051@1476374');
  await page.getByRole('button', { name: 'Use settings', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Checkpoint AIR or version URL' })).toHaveValue('civitai:1025051@1476374');
  await expect(page.getByRole('button', { name: 'Remove reference', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 600, height: 900 });
  await page.locator('.civitai-controls').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/custom-civitai.png' });
});

test('batch builder previews seed expansion, pauses between jobs, and preserves the viewer', async ({ page }) => {
  await setup(page);
  const queue = page.getByRole('region', { name: 'Batch queue', exact: true });
  await queue.getByRole('textbox', { name: 'Batch name', exact: true }).fill('Seed study');
  await queue.getByRole('button', { name: 'New batch', exact: true }).click();
  await queue.getByText('Build from prompt list', { exact: true }).click();
  await queue.getByRole('textbox', { name: 'Batch prompts', exact: true }).fill('Blue mountains\nGreen mountains');
  await queue.getByLabel('Seed mode', { exact: true }).selectOption('range');
  await queue.getByLabel('Repeats / seed count', { exact: true }).fill('2');
  await queue.getByRole('button', { name: 'Preview jobs', exact: true }).click();
  await expect(queue.locator('.batch-preview li')).toHaveCount(4);
  await queue.getByRole('button', { name: 'Add previewed jobs', exact: true }).click();
  await expect(queue.locator('.batch-jobs li')).toHaveCount(4);
  const requests: Record<string, unknown>[] = []; let finish: (() => void) | undefined;
  const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 32; c.height = 32; return c.toDataURL('image/png'); });
  await page.route('**/api/generate', async route => { requests.push(route.request().postDataJSON()); if (requests.length === 1) await new Promise<void>(resolve => { finish = resolve; }); await route.fulfill({ json: { images: [image], cost: .01 } }); });
  await queue.getByRole('button', { name: 'Start / Resume', exact: true }).click();
  await expect(queue.getByLabel('Review batch')).toContainText('4 pending jobs');
  await queue.getByRole('button', { name: 'Confirm run', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  await expect(page.getByRole('button', { name: 'Generate image', exact: true })).toBeDisabled();
  await queue.getByRole('button', { name: 'Pause after current', exact: true }).click();
  finish!();
  await expect(queue.locator('.batch-jobs li').first()).toContainText('succeeded');
  await expect(queue.getByRole('button', { name: 'Start / Resume', exact: true })).toBeEnabled();
  expect(requests).toHaveLength(1);
  await expect(page.locator('.result-grid img').first()).toHaveAttribute('alt', /Forest study/);
  await queue.getByRole('button', { name: 'Start / Resume', exact: true }).click();
  await queue.getByRole('button', { name: 'Confirm run', exact: true }).click();
  await expect.poll(() => requests.length).toBe(4);
  await expect(queue.locator('.batch-jobs li').last()).toContainText('succeeded');
  expect(requests.map(r => r.seed)).toEqual([0, 1, 0, 1]);
  await page.reload();
  await expect(queue.locator('.batch-jobs li')).toHaveCount(4);
  expect(requests).toHaveLength(4);
  await page.setViewportSize({ width: 600, height: 900 });
  await queue.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/batch-queue.png' });
  const resize = page.getByRole('button', { name: 'Resize Batch queue panel.' });
  await resize.focus(); await resize.press('Shift+ArrowRight');
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('nano-studio-panel-layout-v1') || '[]').length)).toBe(6);
});

test('batch save recovery and cross-tab exclusion never repeat the generation', async ({ page, context }) => {
  await setup(page);
  await page.locator('.prompt-field textarea').first().fill('Queued landscape');
  await page.getByRole('button', { name: 'Add to batch', exact: true }).click();
  const queue = page.getByRole('region', { name: 'Batch queue', exact: true });
  await expect(queue.locator('.batch-jobs li')).toHaveCount(1);
  let calls = 0; let finish: (() => void) | undefined;
  const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 32; c.height = 32; return c.toDataURL('image/png'); });
  await page.route('**/api/generate', async route => { calls++; await new Promise<void>(resolve => { finish = resolve; }); await route.fulfill({ json: { images: [image] } }); });
  await queue.getByRole('button', { name: 'Start / Resume', exact: true }).click();
  await queue.getByRole('button', { name: 'Confirm run', exact: true }).click();
  await expect.poll(() => calls).toBe(1);
  const other = await context.newPage();
  await other.route('**/api/models', route => route.fulfill({ json: { data: [{ id: 'hidream', name: 'HiDream', supported_parameters: { resolutions: ['1024x1024'], max_images: 4 } }] } }));
  await other.goto('/');
  await other.locator('.prompt-field textarea').first().fill('Other tab');
  await other.getByRole('button', { name: 'Generate image', exact: true }).click();
  await expect(other.getByRole('alert').filter({ hasText: 'Another tab' })).toBeVisible();
  await other.close();
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    Object.assign(window, { restoreBatchPut: () => { IDBObjectStore.prototype.put = put; } });
    IDBObjectStore.prototype.put = function(value, key) { if (this.name === 'metadata') throw new DOMException('Fixture quota', 'QuotaExceededError'); return key === undefined ? put.call(this, value) : put.call(this, value, key); };
  });
  finish!();
  await expect(queue.getByRole('button', { name: 'Retry batch save', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate image', exact: true })).toBeDisabled();
  await page.evaluate(() => (window as unknown as { restoreBatchPut: () => void }).restoreBatchPut());
  await queue.getByRole('button', { name: 'Retry batch save', exact: true }).click();
  await expect(queue.locator('.batch-jobs li').first()).toContainText('succeeded');
  expect(calls).toBe(1);
});

test('queued Custom CivitAI reference survives reload and a mocked API failure pauses the batch', async ({ page }) => {
  await setup(page);
  await page.locator('.control-panel select').filter({ has: page.locator('option[value="custom-civitai"]') }).selectOption('custom-civitai');
  await page.locator('.prompt-field textarea').first().fill('Reference landscape');
  await page.getByRole('textbox', { name: 'Checkpoint AIR or version URL' }).fill('civitai:1025051@1476374');
  const reference = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 64; return c.toDataURL('image/png'); });
  await page.getByLabel('Reference image (optional)', { exact: true }).setInputFiles({ name: 'reference.png', mimeType: 'image/png', buffer: Buffer.from(reference.split(',')[1], 'base64') });
  await page.getByRole('button', { name: 'Add to batch', exact: true }).click();
  const queue = page.getByRole('region', { name: 'Batch queue', exact: true });
  await expect(queue.locator('.batch-jobs li')).toHaveCount(1);
  await page.reload();
  await expect(queue.locator('.batch-jobs li')).toHaveCount(1);
  let calls = 0; let captured: Record<string, unknown> | undefined;
  await page.route('**/api/generate', async route => { calls++; captured = route.request().postDataJSON(); await route.fulfill({ status: 400, json: { error: 'Fixture provider rejection' } }); });
  await queue.getByRole('button', { name: 'Start / Resume', exact: true }).click();
  await queue.getByRole('button', { name: 'Confirm run', exact: true }).click();
  await expect(queue.locator('.batch-jobs li').first()).toContainText('failed');
  expect(captured?.imageDataUrl).toBe(reference); expect(captured?.customCivitaiAir).toBe('civitai:1025051@1476374');
  await expect(queue.getByRole('button', { name: 'Start / Resume', exact: true })).toBeEnabled();
  await page.reload(); await expect(queue.locator('.batch-jobs li').first()).toContainText('failed'); expect(calls).toBe(1);
});
