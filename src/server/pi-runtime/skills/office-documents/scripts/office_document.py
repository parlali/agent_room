import argparse
import html
import json
import os
import re
import sys
import tempfile
import zipfile
from xml.etree import ElementTree


def fail(message):
    print(json.dumps({"ok": False, "error": message}, indent=4, sort_keys=True), file=sys.stderr)
    raise SystemExit(1)


def json_output(value):
    print(json.dumps({"ok": True, **value}, indent=4, sort_keys=True))


def parse_json(value, fallback):
    if value is None or not value.strip():
        return fallback
    try:
        return json.loads(value)
    except json.JSONDecodeError as error:
        fail(f"Invalid JSON: {error.msg}")


def xml_escape(value):
    return html.escape(str(value), quote=True).replace("&#x27;", "&apos;")


def xml_unescape(value):
    return html.unescape(value)


def room_root(root):
    if root == "workspace":
        key = "AGENT_ROOM_WORKSPACE_DIR"
    elif root == "store":
        key = "AGENT_ROOM_STORE_DIR"
    else:
        fail("Root must be workspace or store")
    value = os.environ.get(key)
    if not value:
        fail(f"{key} is not set")
    return os.path.realpath(value)


def assert_inside(path, root_path):
    common = os.path.commonpath([os.path.realpath(path), root_path])
    if common != root_path:
        fail("Path escapes the selected room root")


def resolve_path(root, path, must_exist):
    if os.path.isabs(path):
        fail("Path must be relative to the selected room root")
    root_path = room_root(root)
    joined = os.path.normpath(os.path.join(root_path, path))
    if must_exist:
        if not os.path.exists(joined):
            fail("File does not exist")
        resolved = os.path.realpath(joined)
        assert_inside(resolved, root_path)
        return resolved
    parent = os.path.realpath(os.path.dirname(joined) or root_path)
    assert_inside(parent, root_path)
    if os.path.exists(joined):
        assert_inside(os.path.realpath(joined), root_path)
    return joined


def require_workspace(root, operation):
    if root != "workspace":
        fail(f"{operation} writes are only supported in the workspace")


def ensure_parent(path):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)


def as_strings(values):
    if not isinstance(values, list):
        return []
    return [str(value) for value in values]


def normalize_docx_content(value):
    record = value if isinstance(value, dict) else {}
    return {
        "title": str(record.get("title", "")).strip(),
        "paragraphs": as_strings(record.get("paragraphs", [])),
    }


def normalize_xlsx_content(value):
    sheets = value.get("sheets") if isinstance(value, dict) else value
    if not isinstance(sheets, list) or not sheets:
        sheets = [{"name": "Sheet 1", "rows": [[""]]}]
    normalized = []
    for index, sheet in enumerate(sheets):
        record = sheet if isinstance(sheet, dict) else {}
        rows = record.get("rows", record.get("data", []))
        if not isinstance(rows, list):
            rows = []
        normalized_rows = [row if isinstance(row, list) else [row] for row in rows]
        normalized.append(
            {
                "name": str(record.get("name") or f"Sheet {index + 1}")[:31],
                "rows": normalized_rows or [[""]],
            },
        )
    return normalized


def normalize_pptx_content(value):
    slides = value.get("slides") if isinstance(value, dict) else value
    if not isinstance(slides, list) or not slides:
        slides = [{"title": "Untitled", "bullets": []}]
    normalized = []
    for index, slide in enumerate(slides):
        record = slide if isinstance(slide, dict) else {}
        normalized.append(
            {
                "title": str(record.get("title") or f"Slide {index + 1}"),
                "bullets": as_strings(record.get("bullets", [])),
                "notes": str(record.get("notes", "")),
            },
        )
    return normalized


def normalize_replacements(value):
    replacements = parse_json(value, [])
    if not isinstance(replacements, list):
        fail("Replacements must be a JSON array")
    normalized = []
    for replacement in replacements:
        if not isinstance(replacement, dict):
            fail("Each replacement must be an object")
        old_text = replacement.get("oldText")
        new_text = replacement.get("newText")
        if not isinstance(old_text, str) or not isinstance(new_text, str):
            fail("Each replacement must include oldText and newText")
        normalized.append((old_text, new_text))
    return normalized


def write_zip(path, entries):
    ensure_parent(path)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as package:
        for name, content in entries:
            package.writestr(name, content)


def replace_zip_entries(path, matcher, replacements):
    fd, temp_path = tempfile.mkstemp(suffix=".zip", dir=os.path.dirname(path) or None)
    os.close(fd)
    replacement_count = 0
    try:
        with zipfile.ZipFile(path, "r") as source:
            with zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_DEFLATED) as target:
                for info in source.infolist():
                    data = source.read(info.filename)
                    if matcher(info.filename):
                        text = data.decode("utf-8")
                        before = text
                        for old_text, new_text in replacements:
                            escaped_old = xml_escape(old_text)
                            escaped_new = xml_escape(new_text)
                            text = text.replace(escaped_old, escaped_new)
                            text = text.replace(old_text, new_text)
                        if text != before:
                            replacement_count += 1
                            data = text.encode("utf-8")
                    target.writestr(info, data)
        if replacement_count == 0:
            fail("No replacement text was found")
        os.replace(temp_path, path)
        return replacement_count
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def text_from_tags(xml, names):
    values = []
    pattern = re.compile(r"<(?:[A-Za-z0-9]+:)?(" + "|".join(names) + r")\b[^>]*>(.*?)</(?:[A-Za-z0-9]+:)?\1>", re.S)
    for match in pattern.finditer(xml):
        values.append(xml_unescape(match.group(2)))
    return "\n".join(values)


def docx_paragraph(text, bold):
    run_properties = "<w:rPr><w:b/></w:rPr>" if bold else ""
    return f'<w:p><w:r>{run_properties}<w:t xml:space="preserve">{xml_escape(text)}</w:t></w:r></w:p>'


def create_docx(path, content):
    document = normalize_docx_content(content)
    paragraphs = []
    if document["title"]:
        paragraphs.append(docx_paragraph(document["title"], True))
    paragraphs.extend(docx_paragraph(paragraph, False) for paragraph in document["paragraphs"])
    entries = [
        (
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>',
        ),
        (
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        ),
        (
            "word/document.xml",
            '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
            + "".join(paragraphs)
            + "<w:sectPr/></w:body></w:document>",
        ),
        ("docProps/core.xml", '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>'),
        ("docProps/app.xml", '<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>'),
    ]
    write_zip(path, entries)


def inspect_docx(path):
    with zipfile.ZipFile(path, "r") as package:
        xml = package.read("word/document.xml").decode("utf-8")
    return text_from_tags(xml, ["t"])


def edit_docx(path, replacements):
    return replace_zip_entries(path, lambda name: name == "word/document.xml", replacements)


def column_name(index):
    value = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        value = chr(65 + remainder) + value
    return value


def cell_xml(row_index, column_index, value):
    ref = f"{column_name(column_index)}{row_index + 1}"
    if isinstance(value, bool):
        return f'<c r="{ref}" t="b"><v>{1 if value else 0}</v></c>'
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return f'<c r="{ref}"><v>{value}</v></c>'
    text = str(value)
    if text.startswith("="):
        return f'<c r="{ref}"><f>{xml_escape(text[1:])}</f><v>0</v></c>'
    return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{xml_escape(text)}</t></is></c>'


def create_xlsx(path, content):
    sheets = normalize_xlsx_content(content)
    workbook_sheets = []
    workbook_relationships = []
    entries = [
        (
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
        ),
        (
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        ),
        ("xl/styles.xml", '<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>'),
    ]
    for index, sheet in enumerate(sheets):
        sheet_number = index + 1
        rel_id = f"rId{sheet_number}"
        workbook_sheets.append(f'<sheet name="{xml_escape(sheet["name"])}" sheetId="{sheet_number}" r:id="{rel_id}"/>')
        workbook_relationships.append(f'<Relationship Id="{rel_id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{sheet_number}.xml"/>')
        rows = []
        for row_index, row in enumerate(sheet["rows"]):
            cells = "".join(cell_xml(row_index, column_index, value) for column_index, value in enumerate(row))
            rows.append(f'<row r="{row_index + 1}">{cells}</row>')
        entries.append(
            (
                f"xl/worksheets/sheet{sheet_number}.xml",
                '<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
                + "".join(rows)
                + "</sheetData></worksheet>",
            ),
        )
    entries.extend(
        [
            (
                "xl/workbook.xml",
                '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                + "".join(workbook_sheets)
                + "</sheets></workbook>",
            ),
            (
                "xl/_rels/workbook.xml.rels",
                '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                + "".join(workbook_relationships)
                + "</Relationships>",
            ),
        ],
    )
    write_zip(path, entries)


def element_children(element, local_name):
    return [child for child in element.iter() if child.tag.rsplit("}", 1)[-1] == local_name]


def parse_xml(value):
    return ElementTree.fromstring(value)


def shared_strings(package):
    if "xl/sharedStrings.xml" not in package.namelist():
        return []
    root = parse_xml(package.read("xl/sharedStrings.xml"))
    return ["".join(text.text or "" for text in element_children(item, "t")) for item in element_children(root, "si")]


def workbook_sheet_map(package):
    names = package.namelist()
    if "xl/workbook.xml" not in names or "xl/_rels/workbook.xml.rels" not in names:
        return [(f"Sheet {index + 1}", name) for index, name in enumerate(sorted(name for name in names if re.match(r"xl/worksheets/sheet\d+\.xml$", name)))]
    workbook = parse_xml(package.read("xl/workbook.xml"))
    rels = parse_xml(package.read("xl/_rels/workbook.xml.rels"))
    targets = {}
    for relation in rels:
        rel_id = relation.attrib.get("Id")
        target = relation.attrib.get("Target")
        if rel_id and target:
            targets[rel_id] = target if target.startswith("xl/") else f"xl/{target.lstrip('/')}"
    sheets = []
    for sheet in element_children(workbook, "sheet"):
        name = sheet.attrib.get("name", "Sheet")
        rel_id = sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        target = targets.get(rel_id or "")
        if target:
            sheets.append((name, target))
    return sheets


def cell_value(cell, strings):
    formula = next((child.text or "" for child in cell if child.tag.rsplit("}", 1)[-1] == "f"), None)
    if formula:
        return f"={formula}"
    cell_type = cell.attrib.get("t")
    if cell_type == "inlineStr":
        return "".join(text.text or "" for text in element_children(cell, "t"))
    value = next((child.text or "" for child in cell if child.tag.rsplit("}", 1)[-1] == "v"), "")
    if cell_type == "s":
        try:
            return strings[int(value)]
        except (ValueError, IndexError):
            return value
    return value


def inspect_xlsx(path):
    with zipfile.ZipFile(path, "r") as package:
        strings = shared_strings(package)
        sheets = []
        for name, target in workbook_sheet_map(package):
            root = parse_xml(package.read(target))
            rows = []
            for row in element_children(root, "row"):
                rows.append([cell_value(cell, strings) for cell in element_children(row, "c")])
            sheets.append({"name": name, "rows": rows})
    return json.dumps(sheets, indent=4)


def edit_xlsx(path, replacements):
    return replace_zip_entries(path, lambda name: re.match(r"xl/worksheets/sheet\d+\.xml$", name) or name == "xl/sharedStrings.xml", replacements)


def slide_xml(slide, index):
    title = xml_escape(slide["title"])
    bullets = "\n".join(slide["bullets"])
    body_shape = ""
    if bullets:
        body_shape = f'<p:sp><p:nvSpPr><p:cNvPr id="{index * 10 + 2}" name="Body"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{xml_escape(bullets)}</a:t></a:r></a:p></p:txBody></p:sp>'
    return f'<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="{index * 10 + 1}" name="Title"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>{title}</a:t></a:r></a:p></p:txBody></p:sp>{body_shape}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'


def create_pptx(path, content):
    slides = normalize_pptx_content(content)
    slide_overrides = []
    slide_ids = []
    slide_rels = []
    entries = [
        (
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>',
        ),
        ("docProps/core.xml", '<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"/>'),
        ("docProps/app.xml", '<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"/>'),
    ]
    for index, slide in enumerate(slides):
        number = index + 1
        slide_overrides.append(f'<Override PartName="/ppt/slides/slide{number}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>')
        slide_ids.append(f'<p:sldId id="{255 + number}" r:id="rId{number}"/>')
        slide_rels.append(f'<Relationship Id="rId{number}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide{number}.xml"/>')
        entries.append((f"ppt/slides/slide{number}.xml", slide_xml(slide, number)))
    entries.extend(
        [
            (
                "[Content_Types].xml",
                '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
                + "".join(slide_overrides)
                + "</Types>",
            ),
            (
                "ppt/presentation.xml",
                '<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>'
                + "".join(slide_ids)
                + '</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>',
            ),
            (
                "ppt/_rels/presentation.xml.rels",
                '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                + "".join(slide_rels)
                + "</Relationships>",
            ),
        ],
    )
    write_zip(path, entries)


def inspect_pptx(path):
    with zipfile.ZipFile(path, "r") as package:
        parts = []
        for name in sorted(package.namelist()):
            if re.match(r"ppt/slides/slide\d+\.xml$", name):
                parts.append(f"{name}\n{text_from_tags(package.read(name).decode('utf-8'), ['t'])}")
    return "\n\n".join(parts)


def edit_pptx(path, replacements):
    return replace_zip_entries(path, lambda name: re.match(r"ppt/slides/slide\d+\.xml$", name), replacements)


CREATE = {
    "docx": create_docx,
    "xlsx": create_xlsx,
    "pptx": create_pptx,
}

INSPECT = {
    "docx": inspect_docx,
    "xlsx": inspect_xlsx,
    "pptx": inspect_pptx,
}

EDIT = {
    "docx": edit_docx,
    "xlsx": edit_xlsx,
    "pptx": edit_pptx,
}


def build_parser():
    parser = argparse.ArgumentParser(prog="office_document.py")
    subparsers = parser.add_subparsers(dest="operation", required=True)
    for operation in ("create", "inspect", "edit"):
        command = subparsers.add_parser(operation)
        command.add_argument("--format", required=True, choices=sorted(CREATE.keys()))
        command.add_argument("--path", required=True)
        command.add_argument("--root", default="workspace", choices=["workspace", "store"])
    subparsers.choices["create"].add_argument("--content-json", default="")
    subparsers.choices["edit"].add_argument("--replacements-json", default="")
    return parser


def main():
    args = build_parser().parse_args()
    if args.operation == "create":
        require_workspace(args.root, args.operation)
        path = resolve_path(args.root, args.path, False)
        CREATE[args.format](path, parse_json(args.content_json, {}))
        json_output({"operation": args.operation, "format": args.format, "root": args.root, "path": args.path})
        return
    path = resolve_path(args.root, args.path, True)
    if args.operation == "inspect":
        text = INSPECT[args.format](path)
        json_output({"operation": args.operation, "format": args.format, "root": args.root, "path": args.path, "text": text})
        return
    require_workspace(args.root, args.operation)
    count = EDIT[args.format](path, normalize_replacements(args.replacements_json))
    json_output({"operation": args.operation, "format": args.format, "root": args.root, "path": args.path, "replacementCount": count})


if __name__ == "__main__":
    main()
