# Nano Studio

A personal hobby project: an image-generation workbench for the NanoGPT API, built with Next.js and TypeScript.

## AI development disclosure

Nano Studio was built with substantial AI assistance, including code generated and revised with OpenAI Codex. AI assistance has been used for implementation, documentation, and tests. This is an experimental personal project; the code and tests are available for inspection and improvement.

Model: GPT 6 Astra, light thinking

## Open source

Released under the [MIT License](LICENSE). Contributions and forks are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for a short development guide.

The license covers this project's code. NanoGPT API usage requires your own key and balance; provider services, models, and generated content have their own applicable terms. Nano Studio is an independent hobby project. Neither this project nor its creator is affiliated with, endorsed by, or sponsored by Nano-GPT.com.

## Quick install

You need **Node.js 20.9 or newer**, npm, and a NanoGPT API key to generate images. Use a browser with Web Locks support for batch execution.

1. Download this repository using GitHub's **Code → Download ZIP**, then extract it. Alternatively, clone it using the URL shown under **Code**.
2. Open a terminal in the extracted or cloned project folder and run:

   ```bash
   npm ci
   npm run dev -- -H 127.0.0.1
   ```

3. Open **http://127.0.0.1:3000**. Select **Connect API key**, enter your NanoGPT key, and choose **Save key**.
4. Choose a model, enter a prompt, and generate. Requests use your NanoGPT balance.

No environment file or database server is required. Keep the terminal running while using the app; press **Ctrl+C** to stop it.

For a local production build:

```bash
npm run build -- --webpack
npm start -- -H 127.0.0.1
```

### Your key and local data

**Save key** stores the key in this browser's local storage; **Forget key** removes it. Only save it in a browser profile you trust. The key is sent to the app's same-origin generation route, which forwards requests to NanoGPT. It is excluded from generation history and exports.

Library images, presets, batches, and panel layouts stay in this browser. Storage is specific to the browser profile and site address: `localhost` and `127.0.0.1` have separate libraries. Export a backup before clearing site data. Prompts and any attached reference images are sent to NanoGPT when you generate.

Development uses webpack to avoid the Turbopack cache corruption and startup exits encountered locally.

## Creative workflow

- **Use settings:** open a generation's details and restore its prompts, model, resolution, seed, guidance, steps, and image count to Compose. This does not generate or spend credits. Unsupported restored values are shown and must be corrected before generating. A random seed remains unknown when the API did not return it.
- **Prompt presets:** expand Prompt presets in Compose to save the current prompts and settings under a name, apply a preset, rename it, or delete it.
- **Library:** search prompts, filter favorites/model/tags, and choose newest or oldest first. Tag filters match every selected tag. Generations keep all variations grouped together. Metadata is paged in sets of 40; thumbnails load as they enter view.
- **Organize:** favorite a generation from the Library or its details. Edit its tags in details, or select multiple records and add tags in bulk. Selection can span pages and clears when filters change.
- **Trash:** moving records to Trash is recoverable. Switch to Trash, select records, and restore them or explicitly confirm permanent deletion. Permanent deletion also removes their stored images.
- **Back up:** Backup all downloads a version 2 JSON file containing all generations (including Trash), images, and presets. Export selected includes only the selected generations. API keys and workspace layouts are excluded.
- **Restore:** Import validates the complete file and previews counts and invalid entries before any write. Fix invalid files before importing. Identical records are skipped; conflicting IDs are preserved as separate copies. Repeating an interrupted import skips records and conflict copies already committed. A storage failure reports partial progress and leaves existing records intact.
- **Save recovery:** a successful generation remains visible and downloadable if browser storage fails. Retry save does not make another generation request. Download the image before closing the tab; explicitly discarding the unsaved copy lets you continue without saving it.

## Viewer and workspace

- Text-to-image generation through NanoGPT with live model discovery and model-specific resolution/count controls.
- Negative prompt, guidance, inference steps, and seed controls; per-variation downloads and saved generation details.
- Image inspection: fit to image, zoom in/out, actual size by clicking the percentage, and fullscreen (Escape to exit).
- Move Library, Image viewer, Compose, Generation details, Generation-setting differences, and Batch queue by dragging their headers. Resize from the bottom-right corner. Focus a handle and use arrow keys; hold Shift for larger steps.
- Snap on/off controls edge snapping; hold Alt to bypass it. Auto-layout arranges panels for the current window width. Layouts save in this browser; Reset layout restores defaults. Scroll the workspace to reach panels outside the window.

## Compare and iterate

Select exactly two Library records and choose **Compare selected**, or choose **Compare** in the viewer and search for a second image. Each pane can show any variation, including two variations from one generation. Replace, swap, favorite, download, or expand the entire comparison to fullscreen. Pan by dragging, scrolling, or using arrow keys. The panes stack when the viewer panel is narrower than 700px.

Views link by default. Shared zoom is relative to each image’s fitted size; each pane also reports its native zoom percentage. **Fit both** resets the views. **Actual size** sets both to 100% and unlinks them. Relinking adopts A’s navigation. Use the separate Generation-setting differences panel to compare saved requests; unknown seeds are not reproducible seeds.

**Iterate from A/B** (or **Iterate from this** in the normal viewer) prepares Compose with a source relationship without making a request. Edit and generate when ready: the result opens beside its source. Repeated generations from the same draft are siblings. Choose Iterate again to branch from a result. Presets, ordinary Use settings, New exposure, and Remove source clear the draft relationship. Details show the source and paginated direct iterations, including sources in Trash. Permanent source deletion leaves iterations intact.

Backups include lineage. Version 1 imports remain independent roots; version 2 imports remap conflicting parent IDs and mark omitted sources unresolved, even when a local ID happens to match. Invalid source indices, self-references, and cycles block import before writes. The v2→v3 database upgrade preserves existing stores and adds a source index.

## Local storage and upgrades

The library uses IndexedDB database `nano-studio`, version 4, with separate metadata, image blob, thumbnail, preset, batch, job, and reference stores. Existing version 1 history migrates one generation at a time. Each original stays in the legacy store until the replacement commits atomically; interrupted migration resumes on the next attempt. Do not clear browser site data to troubleshoot without exporting a backup first.

Only the active generation, selected comparison variations, downloads, and exports load full-resolution images. The API requests base64 images for durable storage. Legacy URL-only records remain readable while their original links work; exporting such a record needs access to its image URL. Older unavailable links cannot be reconstructed by the app.

Backups embed image data and can be large. Import must parse the selected JSON file in memory; export builds its file one generation at a time. Storage quotas and private-browsing restrictions vary by browser. Failures are shown with retry/recovery actions.

## Commands

```bash
npm run dev
npm run build -- --webpack
npm run lint
npm test
npm run test:browser
npm start
```

## API references

- https://docs.nano-gpt.com/api-reference/image-generation
- https://docs.nano-gpt.com/api-reference/endpoint/image-generation-openai

## Validation

`npm test` exercises the real storage and backup modules against isolated fake IndexedDB instances. It covers migration rollback/resume, a 1,005-record paged library, combined filters, Trash/restore, presets, credential-free backup round trips, import conflicts, quota failures, object URL cleanup, unsupported settings, and immutable generation requests. Tests do not access your browser library or make paid generation calls.

Browser tests use isolated fixture libraries, generated raster fixtures, and mocked API responses: no paid requests or access to your personal library. Run `npm run test:browser` with Chrome installed at `/usr/bin/google-chrome`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to your browser executable. The tests start a local server on port 3100. They cover comparison controls, fullscreen, resized/narrow panels, linked pan, variation loading and URL cleanup, iteration preparation, lineage, and failed-save recovery.

## Later milestones

Model-supported masked editing and scheduled/cloud execution remain future releases.

Generation details and setting differences are independent scrollable panels. Existing layouts keep their original panels, with the two new panels below them; Auto-layout arranges all six. Details follows comparison B (or A before B is selected). Fullscreen comparison keeps its differences table inside fullscreen.

## Custom CivitAI

Select **Custom CivitAI** in Compose and enter an exact checkpoint AIR (for example `civitai:1025051@1476374`) or a CivitAI version URL with `modelVersionId`. Bare model IDs and name searches are not supported: the supplied NanoGPT integration export does not expose its compatible-model search API. An AIR identifies a version; NanoGPT determines whether that version is available when generating.

The custom route uses `https://nano-gpt.com/api/v1/images/generations` with `x-api-key`, mapping Compose to `steps` (1–60), `CFGScale` (1–15), `resolution`, `nImages` (1–4), `scheduler`, `strength` (0.1–1), `showExplicitContent`, and `customCivitaiAir`. Explicit content is an opt-in preference. Other models retain their existing request path.

An optional PNG/JPEG/WebP reference is limited to 30 MB and 8–16,384 pixels per side. Strength only applies with a reference image. References remain in the current draft, are cleared when changing models or applying settings, and are not included in presets/history/backups; attach the reference again when reusing settings. The checkpoint AIR, scheduler, strength, and explicit-content preference are preserved with saved settings and shown in details/comparisons. No automatic retries are made.

## Batch workflows

The movable **Batch queue** panel stores named local batches of up to 100 jobs. Add a Compose draft or preview a prompt list with random repeats, consecutive seeds, or explicit seeds. Each job keeps its own settings, iteration source, image count, and optional reference. Pending jobs can be edited independently of Compose.

Review counts and estimated costs before Start / Resume. Jobs run sequentially while this tab stays open; Web Locks prevent competing requests across tabs. Pause and Cancel remaining finish the current request first. Failures pause the queue; interrupted requests become unknown and are never retried automatically. Queue another attempt explicitly when needed. Results update Library without changing the viewer.

A failed save retains downloadable images and offers Retry save without making another request. Saved batches and references use IndexedDB version 4. Deleting a batch preserves Library results. ZIP exports contain available images and an outcome manifest; JSON exports use generation-backup version 2. Neither includes credentials, reference images, or restorable queue definitions. References queued in a batch persist locally even though ordinary draft references do not.
