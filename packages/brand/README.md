# Agent Room Branding Package

This package contains the Agent Room logo as a clean room-and-door mark derived from the approved reference screenshot. The source is vector-first, with generated PNG exports for web, favicon, PWA, iOS, Android, and presentation use.

## Source Files

- `source/agent-room-mark.svg`: canonical transparent SVG mark using `currentColor`
- `source/agent-room-app-icon-light.svg`: light app icon source
- `source/agent-room-app-icon-dark.svg`: dark app icon source
- `brand.tokens.json`: brand colors and source geometry metadata
- `site.webmanifest`: starter manifest pointing at the generated web exports

## Key Exports

- `exports/master/agent-room-logo-1024x1024.png`: transparent 1024 master mark
- `exports/master/agent-room-app-icon-light-1024x1024.png`: light 1024 app icon
- `exports/master/agent-room-app-icon-dark-1024x1024.png`: dark 1024 app icon
- `exports/favicon/favicon.ico`: multi-size favicon containing 16, 32, and 48 px PNG assets
- `exports/favicon/favicon.svg`: SVG favicon
- `exports/web/apple-touch-icon.png`: 180 px Apple touch icon
- `exports/web/android-chrome-192x192.png`: PWA icon
- `exports/web/android-chrome-512x512.png`: PWA icon
- `exports/web/maskable-icon-192x192.png`: maskable PWA icon
- `exports/web/maskable-icon-512x512.png`: maskable PWA icon
- `exports/ios/`: native iOS app icon sizes
- `exports/android/`: native Android density sizes
- `exports/mark/`: transparent black and light mark PNGs from 16 to 1024 px

## Regeneration

Run this from the repository root:

```bash
bun run brand:export
```

The generated files are intentionally isolated from `public/` so this package can be reviewed and shared before the app assets are replaced.
