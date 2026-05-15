---
name: office-documents
description: Create, inspect, and edit DOCX, XLSX, and PPTX files using Agent Room's bundled office document script through agent_room_shell.
---

# Office Documents

Use this skill for DOCX, XLSX, and PPTX create, inspect, and edit work in Agent Room. PDF reading is handled separately by `agent_room_read_pdf`.

Run the bundled script through `agent_room_shell`. Resolve `scripts/office_document.py` relative to this skill directory and pass that absolute path to `python3`.

The script uses `AGENT_ROOM_WORKSPACE_DIR` and `AGENT_ROOM_STORE_DIR` from the room-owned shell environment. Use relative paths. Create and edit operations are workspace-only. Inspect operations can read workspace or store files.

Commands:

```sh
python3 /absolute/path/to/scripts/office_document.py create --format docx --path report.docx --content-json '{"title":"Quarterly report","paragraphs":["Summary","Next steps"]}'
python3 /absolute/path/to/scripts/office_document.py inspect --format docx --path report.docx
python3 /absolute/path/to/scripts/office_document.py edit --format docx --path report.docx --replacements-json '[{"oldText":"Summary","newText":"Updated summary"}]'
```

DOCX `content-json` accepts:

```json
{
    "title": "Report title",
    "paragraphs": ["First paragraph", "Second paragraph"]
}
```

XLSX `content-json` accepts either an array of sheet objects or an object with `sheets`:

```json
{
    "sheets": [
        {
            "name": "Data",
            "rows": [
                ["Metric", "Value"],
                ["Revenue", 42]
            ]
        }
    ]
}
```

PPTX `content-json` accepts either an array of slide objects or an object with `slides`:

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

Workflow:

1. Inspect before editing unless the user already supplied the exact replacement.
2. Edit with explicit `oldText` and `newText` replacements.
3. Inspect after editing and verify the intended text changed.
4. Report the changed relative file path and any verification result.

Do not fetch remote skills, install document packages, use provider credentials, or write files outside the room workspace.
