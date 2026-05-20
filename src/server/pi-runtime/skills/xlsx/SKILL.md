---
name: xlsx
description: Create, inspect, and edit Excel XLSX files through the bundled XLSX script.
---

# XLSX

Use this skill for Excel `.xlsx` create, inspect, and edit work.

Default to this skill for normal spreadsheet business artifacts when the user does not specify a format, including spreadsheets, trackers, models, budgets, and workbooks. Do not deliberate between XLSX, CSV, PDF, HTML, Markdown, or custom generation paths for these requests unless the user explicitly asks for another source format or a bounded renderer is required.

When the user asks for a PDF version of a normal spreadsheet deliverable, create or preserve the editable XLSX source first, then export or convert that source to PDF as the delivery format.

Run the bundled script through `shell`. Resolve `scripts/xlsx_workbook.ts` relative to this skill directory and pass that absolute path to `bun`.

Commands:

```sh
bun /absolute/path/to/scripts/xlsx_workbook.ts create --path model.xlsx --content-json '{"sheets":[{"name":"Data","rows":[["Metric","Value"],["Revenue",42],["Margin","=B2*0.2"]]}]}'
bun /absolute/path/to/scripts/xlsx_workbook.ts inspect --path model.xlsx
bun /absolute/path/to/scripts/xlsx_workbook.ts edit --path model.xlsx --edits-json '[{"sheet":"Data","cell":"B2","value":45},{"sheet":"Data","cell":"C2","formula":"=B2*2"}]'
```

`content-json` accepts:

```json
{
    "sheets": [
        {
            "name": "Data",
            "rows": [
                ["Metric", "Value"],
                ["Revenue", 42],
                ["Margin", "=B2*0.2"]
            ]
        }
    ]
}
```

Edits are targeted by sheet and cell address. Use `value` for literal values and `formula` for formulas. The script inspects cell coordinates, values, formulas, style ids, number formats, merged ranges, and chart parts. It edits worksheet cells structurally so formulas, styles, charts, drawings, relationships, and unrelated workbook parts are not rewritten as global text.

Workflow:

1. Inspect before editing and identify exact sheet names and cell addresses.
2. Edit with `--edits-json`; do not use global text replacement for normal spreadsheet work.
3. Inspect after editing and verify coordinates, formulas, and expected workbook parts are still present.
4. Report the changed relative file path and verification result.

Create and edit operations are workspace-only. Inspect operations can use `--root workspace` or `--root store`. Use relative paths only.
