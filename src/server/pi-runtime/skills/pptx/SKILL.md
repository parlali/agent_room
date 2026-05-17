---
name: pptx
description: Create, inspect, and edit PowerPoint PPTX files through the bundled PPTX script.
---

# PPTX

Use this skill for PowerPoint `.pptx` create, inspect, and edit work.

Run the bundled script through `shell`. Resolve `scripts/pptx_deck.ts` relative to this skill directory and pass that absolute path to `bun`.

Commands:

```sh
bun /absolute/path/to/scripts/pptx_deck.ts create --path deck.pptx --content-json '{"slides":[{"title":"Launch plan","bullets":["Scope","Risks"]}]}'
bun /absolute/path/to/scripts/pptx_deck.ts inspect --path deck.pptx
bun /absolute/path/to/scripts/pptx_deck.ts edit --path deck.pptx --replacements-json '[{"oldText":"Launch plan","newText":"Updated launch plan"}]'
```

`content-json` accepts:

```json
{
    "slides": [
        {
            "title": "Launch plan",
            "bullets": ["Scope", "Risks"]
        }
    ]
}
```

Inspect reports slide paragraph text and counts notes, charts, media, layouts, and masters. Edits replace text across DrawingML text runs in slide and speaker-note parts while preserving unrelated package parts such as layouts, masters, images, charts, and relationships.

Workflow:

1. Inspect before editing unless the user supplied exact replacement text.
2. Edit with explicit `oldText` and `newText` replacements.
3. Inspect after editing and verify the intended text changed.
4. Report the changed relative file path and verification result.

Create and edit operations are workspace-only. Inspect operations can use `--root workspace` or `--root store`. Use relative paths only.
