# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js with TypeScript, as previously chosen by the user.

## Users

The first version is a personal tool for its owner, used to generate images without moving between an API console, prompt notes, and a separate history.

## Product Purpose

Turn a written prompt into a downloadable image through nano-gpt.com with the shortest credible path from idea to result. Success means the user can configure access once, generate confidently, understand the current state, and return to prior results after restarting the browser.

## Positioning

The product is a compact personal image workbench: generation, essential controls, and local continuity in one focused surface, with the user's own API access.

## Operating Context

The primary flow is prompt to image. The user supplies a nano-gpt.com API key, writes a prompt, chooses essential generation settings, generates an image, downloads it, and can revisit generation history later.

## Capabilities and Constraints

- Current release: text-to-image generation, reusable settings and prompt presets, a searchable local library with favorites/tags/Trash, JSON backup/import, image inspection, two-image comparison with linked navigation, explicit iteration lineage, and persistent movable panels.
- Custom CivitAI supports exact checkpoint AIR/version URLs, scheduler, explicit-content preference, and one optional draft reference image. Compatible-model search awaits a documented NanoGPT discovery API.
- Authentication uses the user's nano-gpt.com API key.
- Stack: Next.js and TypeScript.
- Team collaboration, shared libraries, image editing, AI prompt assistance are later possibilities, not first-release requirements.
- Exact API request shape and available models must be verified against current nano-gpt.com documentation before live integration.

## Evidence on Hand

No logo, brand system, product claims, benchmark data, or generated-image assets were supplied. The interface must not invent reliability, speed, or quality claims.

## Product Principles

- Keep the creative act central and configuration secondary.
- Make every generation state understandable without technical guesswork.
- Keep personal credentials and history handling explicit and predictable.
- Prefer a small complete workflow over a wide set of unfinished controls.

## Accessibility & Inclusion

Keyboard operation, visible focus, sufficient contrast, meaningful control labels, reduced-motion support, and responsive behavior are required for the web interface.

## Batch workflows

Named persistent batches run sequentially in the open app, with explicit Start / Resume, pause on failure, and no automatic retries. A sixth movable panel contains prompt/seed expansion, pending-job editing, progress, recovery, and results-only ZIP/JSON exports. Jobs snapshot settings, lineage, and local references. IndexedDB v4 preserves existing Library stores and adds batches, ordered jobs, and reference blobs. Shared Web Locks coordinate manual and batch requests across tabs. Batch completion never changes the viewed image. Scheduling, parallel execution, cloud queues, and portable batch definitions remain deferred.
