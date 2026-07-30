from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(relative: str, old: str, new: str) -> None:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{relative}: ожидалось одно вхождение, найдено {count}")
    path.write_text(value.replace(old, new, 1), encoding="utf-8")


replace_once(
    "packages/storage/src/database-admin.ts",
    "    const limit = normalizedLimit(input.limit, 200);",
    "    const limit = normalizedLimit(input.limit, 10_000);"
)
replace_once(
    "apps/api/src/database-admin-routes.ts",
    "const querySchema = {",
    "const pageQuerySchema = {"
)
replace_once(
    "apps/api/src/database-admin-routes.ts",
    '    limit: { type: "integer", minimum: 1, maximum: 10_000 },',
    '    limit: { type: "integer", minimum: 1, maximum: 200 },'
)
replace_once(
    "apps/api/src/database-admin-routes.ts",
    "        querystring: querySchema",
    "        querystring: pageQuerySchema"
)
replace_once(
    "apps/api/src/database-admin-routes.ts",
    '''          ...querySchema,
          properties: {
            ...querySchema.properties,
            format: { type: "string", enum: ["csv", "json"] }
          }''',
    '''          ...pageQuerySchema,
          properties: {
            ...pageQuerySchema.properties,
            limit: { type: "integer", minimum: 1, maximum: 10_000 },
            format: { type: "string", enum: ["csv", "json"] }
          }'''
)
print("database admin limits fixed")
