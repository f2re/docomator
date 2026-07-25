from __future__ import annotations

import runpy
from pathlib import Path

path = Path(__file__).with_name("apply-assisted-import-word-roster.py")
value = path.read_text(encoding="utf-8")
old = '''replace_once(
    "apps/api/src/template-draft-routes.ts",
    '              enum: ["string", "text", "number", "integer", "boolean", "date", "date-time"]',
    '              enum: ["string", "text", "enum", "number", "integer", "boolean", "date", "date-time"]',
)'''
new = '''replace_once(
    "apps/api/src/template-draft-routes.ts",
    ''' + "'''" + '''              enum: [
                "string",
                "text",
                "number",
                "integer",
                "boolean",
                "date",
                "date-time"
              ]''' + "'''" + ''',
    ''' + "'''" + '''              enum: [
                "string",
                "text",
                "enum",
                "number",
                "integer",
                "boolean",
                "date",
                "date-time"
              ]''' + "'''" + ''',
)'''
if old not in value:
    raise RuntimeError("Не найден устаревший фрагмент схемы поля шаблона в скрипте применения.")
path.write_text(value.replace(old, new, 1), encoding="utf-8")
runpy.run_path(str(path), run_name="__main__")
