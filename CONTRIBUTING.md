# Contributing to Nano Studio

Bug reports, documentation improvements, and pull requests are welcome. For bugs, include the steps to reproduce, expected behavior, browser, Node.js version, and relevant error text. Remove API keys, private prompts, and personal images before sharing logs or screenshots.

## Local development

Follow the quick install in [README.md](README.md). Use `npm ci` to install the locked dependencies. Read [AGENTS.md](AGENTS.md) before changing Next.js code and preserve the existing workflow and visual design described in [PRODUCT.md](PRODUCT.md) and [DESIGN.md](DESIGN.md).

Before submitting code changes, run:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build -- --webpack
npm run test:browser
```

Browser tests expect Chrome at `/usr/bin/google-chrome`; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to another compatible Chromium executable if necessary. Tests use isolated fixture libraries and mocked generation responses. Do not add paid generation requests to automated tests.

Describe what changed, why, and how it was tested. AI-assisted contributions are welcome; disclose substantial AI assistance in the pull request and review the resulting changes. Never commit credentials, personal library backups, or reference images.

By contributing, you agree to license your contributions under this project's MIT license.
