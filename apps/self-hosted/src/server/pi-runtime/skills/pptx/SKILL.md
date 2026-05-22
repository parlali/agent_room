---
name: pptx
description: Create, inspect, update, delete, validate, render, and export PowerPoint PPTX artifacts with structured deck operations and mandatory visual QA.
---

# PPTX

Use this skill for PowerPoint `.pptx` decks, slides, presentation files, and slide-based PDF deliverables unless the operator explicitly asks for another editable source.

Run `scripts/pptx_deck.ts` through `shell` with `bun`. Resolve the script path relative to this skill directory.

## Non-Negotiable Workflow

1. Create or inspect the deck.
2. For edits, inspect first unless the operator supplied exact text.
3. Use structured slide operations. Do not create image-only or HTML surrogate slides unless explicitly requested.
4. Verify slide text, notes, layouts, media, and chart counts with `inspect`.
5. Run `validate`.
6. Run `render`; use `--emit-pdf true` when PDF delivery is requested.
7. Inspect the rendered slide PNGs visually, fix blank slides, overlap, clipping, contrast, or missing media, then rerun validation and render.

If `inspect` reports non-empty `issues`, fix them before delivery unless they are explicitly irrelevant and you say why. If `render` fails because LibreOffice or Poppler is unavailable, report that visual QA could not run. Other render failures must be fixed.

## Commands

Prefer JSON files over inline JSON for non-trivial decks.

```sh
bun /absolute/path/to/scripts/pptx_deck.ts create --path <file.pptx> --content-file <input.json>
bun /absolute/path/to/scripts/pptx_deck.ts inspect --path <file.pptx>
bun /absolute/path/to/scripts/pptx_deck.ts edit --path <file.pptx> --operations-file <ops.json>
bun /absolute/path/to/scripts/pptx_deck.ts validate --path <file.pptx>
bun /absolute/path/to/scripts/pptx_deck.ts render --path <file.pptx> --output-dir <render-dir> --emit-pdf true
```

Inline aliases are available for small payloads: `--content-json`, `--operations-json`, and `--replacements-json`.

## Create

`content-file` accepts `{ "slides": [...] }`. Each slide supports:

| Field        | Purpose                                                   |
| ------------ | --------------------------------------------------------- |
| `title`      | Primary slide title.                                      |
| `subtitle`   | Optional secondary line.                                  |
| `bullets`    | Default body bullets.                                     |
| `blocks`     | Structured blocks for text, bullets, metrics, and tables. |
| `notes`      | Speaker notes.                                            |
| `background` | Hex background color.                                     |

Slide blocks support `text`, `bullets`, `metric`, and `table`. Position fields `x`, `y`, `width`, and `height` are in inches. Created decks include theme, master, layout, slide relationships, notes relationships, and editable DrawingML text.

## Update And Delete

Use `edit --operations-file` for structured mutations:

```json
[
    { "type": "replace", "oldText": "Draft", "newText": "Final" },
    { "type": "addSlide", "slide": { "title": "Next Steps", "bullets": ["Validate", "Render"] } },
    { "type": "deleteSlide", "slide": 3 }
]
```

`--replacements-json` and `--replacements-file` are supported for simple exact replacements. Replacements work across slide text, table text, and speaker notes while preserving layouts, masters, charts, media, and unrelated package parts.

Create and edit write only to the workspace. Inspect and validate can read workspace or store. Render reads the selected root and writes PNG/PDF outputs to the workspace. Use relative paths only.
