---
name: xlsx
description: Create, inspect, update, delete, validate, render, and export Excel XLSX artifacts with structured workbook operations and mandatory visual QA.
---

# XLSX

Use this skill for Excel `.xlsx` workbooks, trackers, models, budgets, tables, and spreadsheet deliverables unless the operator explicitly asks for another editable source.

Run `scripts/xlsx_workbook.ts` through `shell` with `bun`. Resolve the script path relative to this skill directory.

## Non-Negotiable Workflow

1. Create or inspect the workbook.
2. For edits, identify sheet names and cell addresses from `inspect`.
3. Use targeted workbook operations. Do not use global text replacement for spreadsheet work.
4. Verify formulas, number formats, merged ranges, charts, and sheet names with `inspect`.
5. Run `validate`.
6. Run `render`; use `--emit-pdf true` when PDF delivery is requested.
7. Inspect the rendered PNG pages visually, fix clipped text or unreadable layout, then rerun validation and render.

If `inspect` reports non-empty `issues`, fix them before delivery unless they are explicitly irrelevant and you say why. If `render` fails because LibreOffice or Poppler is unavailable, report that visual QA could not run. Other render failures must be fixed.

## Commands

Prefer JSON files over inline JSON for non-trivial workbook data.

```sh
bun /absolute/path/to/scripts/xlsx_workbook.ts create --path <file.xlsx> --content-file <input.json>
bun /absolute/path/to/scripts/xlsx_workbook.ts inspect --path <file.xlsx>
bun /absolute/path/to/scripts/xlsx_workbook.ts edit --path <file.xlsx> --edits-file <ops.json>
bun /absolute/path/to/scripts/xlsx_workbook.ts validate --path <file.xlsx>
bun /absolute/path/to/scripts/xlsx_workbook.ts render --path <file.xlsx> --output-dir <render-dir> --emit-pdf true
```

Inline aliases are available for small payloads: `--content-json` and `--edits-json`.

## Create

`content-file` accepts `{ "sheets": [...] }`. Each sheet supports:

| Field        | Purpose                                          |
| ------------ | ------------------------------------------------ |
| `name`       | Sheet name, validated against Excel rules.       |
| `rows`       | Cell matrix. Cells may be primitives or objects. |
| `columns`    | Column widths.                                   |
| `merges`     | Merge ranges such as `A1:C1`.                    |
| `autoFilter` | `true` or a range.                               |
| `freezePane` | `true` or a top-left cell.                       |

Cell objects support `value`, `formula`, `style`, `numberFormat`, `bold`, `italic`, `fill`, and `alignment`. Supported built-in styles are `header`, `currency`, `percent`, `integer`, and `date`.

## Update And Delete

Use `edit --edits-file` for structured mutations:

```json
[
    { "type": "setCell", "sheet": "Data", "cell": "B2", "value": 100 },
    { "type": "setCell", "sheet": "Data", "cell": "C2", "formula": "=B2*2" },
    { "type": "deleteCell", "sheet": "Data", "cell": "D4" },
    { "type": "addSheet", "name": "Summary", "rows": [["Metric", "Value"]] },
    { "type": "deleteSheet", "sheet": "Scratch" }
]
```

Cell edits preserve existing cell style ids unless the cell is newly created. Formula edits must use formulas, not hardcoded results. Existing charts, drawings, relationships, formulas, styles, and merged ranges are preserved unless directly targeted.

Create and edit write only to the workspace. Inspect and validate can read workspace or store. Render reads the selected root and writes PNG/PDF outputs to the workspace. Use relative paths only.
