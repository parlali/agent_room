---
name: docx
description: Create, inspect, and edit Word DOCX files through the bundled DOCX script.
---

# DOCX

Use this skill for Word `.docx` create, inspect, and edit work.

Run the bundled script through `shell`. Resolve `scripts/docx_document.ts` relative to this skill directory and pass that absolute path to `bun`.

Commands:

```sh
bun /absolute/path/to/scripts/docx_document.ts create --path report.docx --content-json '{"title":"Quarterly report","paragraphs":["Summary","Next steps"],"tables":[[["Metric","Value"],["Revenue","42"]]]}'
bun /absolute/path/to/scripts/docx_document.ts inspect --path report.docx
bun /absolute/path/to/scripts/docx_document.ts edit --path report.docx --replacements-json '[{"oldText":"Summary","newText":"Updated summary"}]'
```

`content-json` accepts:

```json
{
    "title": "Report title",
    "paragraphs": ["First paragraph", "Second paragraph"],
    "tables": [
        [
            ["Metric", "Value"],
            ["Revenue", "42"]
        ]
    ]
}
```

Inspect reports paragraphs, paragraph styles, table text, and the DOCX story part that contained each item. Edits replace text across Word text runs in document body, tables, headers, footers, footnotes, endnotes, and comments while preserving unrelated package parts such as styles, relationships, and media.

Workflow:

1. Inspect before editing unless the user supplied exact replacement text.
2. Edit with explicit `oldText` and `newText` replacements.
3. Inspect after editing and verify the intended text changed.
4. Report the changed relative file path and verification result.

Create and edit operations are workspace-only. Inspect operations can use `--root workspace` or `--root store`. Use relative paths only.
