from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(relative: str, old: str, new: str) -> None:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{relative}: ожидалось одно вхождение, найдено {count}: {old[:140]!r}")
    path.write_text(value.replace(old, new, 1), encoding="utf-8")
    print(f"updated {relative}")


replace_once(
    "packages/storage/src/database-admin.ts",
    'import { SqliteStore } from "./database.js";',
    'import { SqliteStore, type SqliteExecutor } from "./database.js";'
)
replace_once(
    "packages/storage/src/database-admin.ts",
    '''    database: Parameters<Parameters<SqliteStore["execute"]>[0]>[0],''',
    '''    database: SqliteExecutor,'''
)
replace_once(
    "packages/storage/src/index.ts",
    'export * from "./database.js";\n',
    'export * from "./database.js";\nexport * from "./database-admin.js";\nexport * from "./data-import-normalization.js";\n'
)

replace_once(
    "apps/api/src/app.ts",
    '''  ContentAddressedObjectStore,
  DocumentDeliveryConflictError,''',
    '''  ContentAddressedObjectStore,
  DatabaseAdminRegistry,
  DatabaseAdminValidationError,
  DocumentDeliveryConflictError,'''
)
replace_once(
    "apps/api/src/app.ts",
    '''import { registerDocumentDeliveryRoutes } from "./document-delivery-routes.js";''',
    '''import { registerDatabaseAdminRoutes } from "./database-admin-routes.js";
import { registerDocumentDeliveryRoutes } from "./document-delivery-routes.js";'''
)
replace_once(
    "apps/api/src/app.ts",
    '''  knowledgeRegistry?: KnowledgeRegistry;
  spaceRegistry?: SpaceRegistry;''',
    '''  knowledgeRegistry?: KnowledgeRegistry;
  databaseAdminRegistry?: DatabaseAdminRegistry;
  spaceRegistry?: SpaceRegistry;'''
)
replace_once(
    "apps/api/src/app.ts",
    '''  const knowledgeRegistry =
    dependencies.knowledgeRegistry ?? new KnowledgeRegistry(store);
  const spaceRegistry = dependencies.spaceRegistry ?? new SpaceRegistry(store);''',
    '''  const knowledgeRegistry =
    dependencies.knowledgeRegistry ?? new KnowledgeRegistry(store);
  const databaseAdminRegistry =
    dependencies.databaseAdminRegistry ??
    new DatabaseAdminRegistry(store, knowledgeRegistry);
  const spaceRegistry = dependencies.spaceRegistry ?? new SpaceRegistry(store);'''
)
replace_once(
    "apps/api/src/app.ts",
    '''    } else if (error instanceof SpaceValidationError) {
      statusCode = 400;
      code = "space_validation_failed";
      message = toUserMessage(error);''',
    '''    } else if (error instanceof DatabaseAdminValidationError) {
      statusCode = 400;
      code = "database_admin_validation_failed";
      message = toUserMessage(error);
    } else if (error instanceof SpaceValidationError) {
      statusCode = 400;
      code = "space_validation_failed";
      message = toUserMessage(error);'''
)
replace_once(
    "apps/api/src/app.ts",
    '''  registerUiRoutes(app, dependencies.uiDirectory);
  registerKnowledgeRoutes(app, knowledgeRegistry);''',
    '''  registerUiRoutes(app, dependencies.uiDirectory);
  registerDatabaseAdminRoutes(app, databaseAdminRegistry);
  registerKnowledgeRoutes(app, knowledgeRegistry);'''
)

replace_once(
    "apps/api/src/ui-routes.ts",
    '''      "bulk-data-import-v2.css",
      "operation-center.css",''',
    '''      "bulk-data-import-v2.css",
      "bulk-data-import-v3.css",
      "database-admin.css",
      "operation-center.css",'''
)
replace_once(
    "apps/api/src/ui-routes.ts",
    '''      "help-project-documents.js",
      "interface-hierarchy.js"''',
    '''      "help-project-documents.js",
      "interface-hierarchy.js",
      "database-admin.js"'''
)
replace_once(
    "apps/api/src/ui-routes.ts",
    '''      "bulk-data-import.js",
      "bulk-data-import-v2.js",
      "operation-center.js",''',
    '''      "bulk-data-import.js",
      "bulk-data-import-v2.js",
      "bulk-data-import-v3.js",
      "operation-center.js",'''
)

replace_once(
    "scripts/ci/check-ui-bundles.mjs",
    '''    "help-project-documents.js",
    "interface-hierarchy.js"''',
    '''    "help-project-documents.js",
    "interface-hierarchy.js",
    "database-admin.js"'''
)
replace_once(
    "scripts/ci/check-ui-bundles.mjs",
    '''    "bulk-data-import.js",
    "bulk-data-import-v2.js",
    "operation-center.js",''',
    '''    "bulk-data-import.js",
    "bulk-data-import-v2.js",
    "bulk-data-import-v3.js",
    "operation-center.js",'''
)

replace_once(
    "scripts/ci/check-user-facing-language.mjs",
    '''  "apps/api/ui/bulk-data-import.js",
  "apps/api/ui/operation-center.js",''',
    '''  "apps/api/ui/bulk-data-import.js",
  "apps/api/ui/bulk-data-import-v3.js",
  "apps/api/ui/database-admin.js",
  "apps/api/ui/operation-center.js",'''
)

replace_once(
    "package.json",
    '''    "check:runtime": "node --check scripts/runtime/automatic-backup.mjs''',
    '''    "check:runtime": "node --check scripts/runtime/database-admin.mjs && node --check scripts/runtime/automatic-backup.mjs'''
)
replace_once(
    "package.json",
    '''node --check apps/api/ui/bulk-data-import-v2.js && node --check apps/api/ui/operation-center.js''',
    '''node --check apps/api/ui/bulk-data-import-v2.js && node --check apps/api/ui/bulk-data-import-v3.js && node --check apps/api/ui/database-admin.js && node --check apps/api/ui/operation-center.js'''
)
replace_once(
    "package.json",
    '''    "restore": "node scripts/runtime/restore.mjs",''',
    '''    "restore": "node scripts/runtime/restore.mjs",
    "database:admin": "node scripts/runtime/database-admin.mjs",'''
)

replace_once(
    "apps/api/ui/entity-workspace.js",
    '''      rows: preview.rows,
      mappings: entityWorkspaceCollectImportMappings(),''',
    '''      rows: preview.rows,
      sourceRowNumbers:
        preview.sourceRowNumbers ?? preview.rows.map((_row, index) => index + 2),
      identityCaseInsensitive: true,
      mappings: entityWorkspaceCollectImportMappings(),'''
)

replace_once(
    "scripts/offline/verify-bundle.sh",
    '''[[ -f "$BUNDLE_ROOT/payload/app/scripts/runtime/automatic-backup.mjs" ]] || \\
  die "В комплекте отсутствует сценарий автоматического резервирования"''',
    '''[[ -f "$BUNDLE_ROOT/payload/app/scripts/runtime/database-admin.mjs" ]] || \\
  die "В комплекте отсутствует инструмент администратора базы данных"
[[ -f "$BUNDLE_ROOT/payload/app/scripts/runtime/automatic-backup.mjs" ]] || \\
  die "В комплекте отсутствует сценарий автоматического резервирования"'''
)
replace_once(
    "scripts/offline/verify-bundle.sh",
    '''[[ -f "$BUNDLE_ROOT/payload/app/apps/api/ui/generic-document-generation.js" ]] || die "В комплекте отсутствует выпуск документов по объектам"''',
    '''[[ -f "$BUNDLE_ROOT/payload/app/apps/api/ui/generic-document-generation.js" ]] || die "В комплекте отсутствует выпуск документов по объектам"
[[ -f "$BUNDLE_ROOT/payload/app/apps/api/ui/database-admin.js" ]] || die "В комплекте отсутствует интерфейс администратора базы данных"
[[ -f "$BUNDLE_ROOT/payload/app/apps/api/ui/bulk-data-import-v3.js" ]] || die "В комплекте отсутствует нормализация массового импорта"'''
)

print("database admin and import UI integrated")
