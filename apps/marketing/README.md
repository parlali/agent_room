# Agent Room Marketing Site

The public marketing surface for [openagentroom.com](https://openagentroom.com). Built with Vite, React, Tailwind, and TypeScript, matching the rest of the Agent Room stack.

This is a static SPA. It deliberately does not share runtime, auth, room state, or any private data with the main app. The whole point of keeping it in `apps/marketing` is to ship a marketing surface without coupling deploys.

## Develop

From the repo root:

```bash
bun run marketing:dev
```

Or from this directory:

```bash
bun run dev
```

The site runs on [http://localhost:4321](http://localhost:4321) by default.

## Build

```bash
bun run marketing:build
```

Output lives at `apps/marketing/dist`. Drop it on any static host (Cloudflare Pages, Netlify, S3 + CloudFront, GitHub Pages).

## Design notes

The aesthetic direction is an "Operator's Manual": dark editorial typography (Fraunces), warm cream paper accents borrowed from the Agent Room brand, mono technical labels (JetBrains Mono), live status elements, and a single cream-paper section flip for the pricing tease.

The site is intentionally honest about Agent Room being early OSS. The pricing tease names a future managed plan but commits to no dates and no fake numbers.
