---
name: docx
description: Create, inspect, update, delete, validate, render, and export Word DOCX artifacts with structured OpenXML operations and mandatory visual QA.
---

# DOCX

Use this skill for Word `.docx` deliverables and edits. Prefer DOCX for reports, memos, letters, proposals, briefs, specs, and other written business documents unless the operator explicitly asks for another editable source.

Run `scripts/docx_document.ts` through `shell` with `bun`. Resolve the script path relative to this skill directory.

## Non-Negotiable Workflow

1. Create or inspect the DOCX source.
2. For edits, inspect first unless the operator supplied exact text or coordinates.
3. Use structured blocks or edit operations. Do not make a Markdown/HTML surrogate unless explicitly requested.
4. Run `validate`.
5. Run `render`; use `--emit-pdf true` when PDF delivery is requested.
6. Inspect the rendered PNG pages visually. Text inspection is not layout QA.
7. Fix visible issues, rerun `validate` and `render`, then deliver.

If `inspect` reports non-empty `issues`, fix them before delivery unless they are explicitly irrelevant and you say why. If `render` fails because LibreOffice or Poppler is unavailable, report that visual QA could not run. Other render failures must be fixed.

## Commands

Prefer JSON files over inline JSON for non-trivial content.

```sh
bun /absolute/path/to/scripts/docx_document.ts create --path <file.docx> --content-file <input.json>
bun /absolute/path/to/scripts/docx_document.ts inspect --path <file.docx>
bun /absolute/path/to/scripts/docx_document.ts edit --path <file.docx> --operations-file <ops.json>
bun /absolute/path/to/scripts/docx_document.ts validate --path <file.docx>
bun /absolute/path/to/scripts/docx_document.ts render --path <file.docx> --output-dir <render-dir> --emit-pdf true
```

Inline aliases are available for small payloads: `--content-json`, `--operations-json`, and `--replacements-json`.

## Create

Use `blocks`. Legacy `title`, `paragraphs`, and `tables` remain compatibility input only.

Supported blocks:

| Block           | Purpose                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| `paragraph`     | Rich runs, alignment, spacing, indents, keep-with-next, page break before. |
| `heading`       | Semantic Heading 1 or 2 with outline levels.                               |
| `table`         | Rows, rich cell text, widths, borders, shading, margins.                   |
| `signatureGrid` | Signature lines in 1 to 3 columns.                                         |
| `rule`          | Horizontal divider.                                                        |
| `spacer`        | Vertical spacing.                                                          |

Use `runs` for mixed bold, italic, underline, font, or size. Use real newline characters in text; literal escaped `\n` is repaired during creation.

## Update And Delete

Use `edit --operations-file` for structured mutations:

```json
[
    { "type": "replace", "oldText": "Draft", "newText": "Final" },
    { "type": "appendBlocks", "blocks": [{ "type": "heading", "text": "Appendix" }] },
    { "type": "deleteParagraph", "contains": "Remove this paragraph" },
    { "type": "deleteTable", "index": 2 }
]
```

`--replacements-json` and `--replacements-file` are supported for simple exact replacements. Replacements work across Word text runs in body, tables, headers, footers, footnotes, endnotes, and comments while preserving unrelated package parts.

Create and edit write only to the workspace. Inspect and validate can read workspace or store. Render reads the selected root and writes PNG/PDF outputs to the workspace. Use relative paths only.
