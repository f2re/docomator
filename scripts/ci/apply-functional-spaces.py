from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def read(relative: str) -> str:
    return (ROOT / relative).read_text(encoding="utf-8")


def write(relative: str, content: str) -> None:
    (ROOT / relative).write_text(content, encoding="utf-8")


def replace_once(relative: str, old: str, new: str) -> None:
    content = read(relative)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(
            f"{relative}: expected exactly one match, found {count}\n--- expected ---\n{old}"
        )
    write(relative, content.replace(old, new, 1))


def insert_before(relative: str, marker: str, addition: str) -> None:
    content = read(relative)
    count = content.count(marker)
    if count != 1:
        raise RuntimeError(f"{relative}: expected one marker, found {count}: {marker!r}")
    write(relative, content.replace(marker, addition + marker, 1))


def append_once(relative: str, marker: str, addition: str) -> None:
    content = read(relative)
    if marker in content:
        return
    suffix = "" if content.endswith("\n") else "\n"
    write(relative, content + suffix + addition.rstrip() + "\n")


replace_once(
    "packages/storage/src/spaces.ts",
    'export const DEFAULT_SPACE_ID = "00000000-0000-4000-8000-000000000001";\n\n',
    'export const DEFAULT_SPACE_ID = "00000000-0000-4000-8000-000000000001";\n'
    'export const DEFAULT_SPACE_COLOR = "#5B8DEF";\n\n',
)
replace_once(
    "packages/storage/src/spaces.ts",
    """  name: string;
  description: string | null;
  status: SpaceStatus;
""",
    """  name: string;
  description: string | null;
  color: string;
  status: SpaceStatus;
""",
)
replace_once(
    "packages/storage/src/spaces.ts",
    """  key?: string;
  name: string;
  description?: string | null;
}

export interface ListSpacesOptions {
""",
    """  key?: string;
  name: string;
  description?: string | null;
  color?: string;
}

export interface UpdateSpaceInput {
  name?: string;
  description?: string | null;
  color?: string;
}

export interface ListSpacesOptions {
""",
)
replace_once(
    "packages/storage/src/spaces.ts",
    """  name: string;
  description: string | null;
  status: string;
""",
    """  name: string;
  description: string | null;
  color: string;
  status: string;
""",
)
replace_once(
    "packages/storage/src/spaces.ts",
    """function stableKey(value: string, name: string): string {
""",
    """function spaceColor(value: string | undefined): string {
  if (value === undefined) {
    return DEFAULT_SPACE_COLOR;
  }
  const normalized = requiredText(value, "color", 7).toUpperCase();
  if (!/^#[0-9A-F]{6}$/u.test(normalized)) {
    throw new SpaceValidationError("color must use the #RRGGBB format");
  }
  return normalized;
}

function stableKey(value: string, name: string): string {
""",
)
replace_once(
    "packages/storage/src/spaces.ts",
    """    name: row.name,
    description: row.description,
    status: spaceStatus(row.status),
""",
    """    name: row.name,
    description: row.description,
    color: spaceColor(row.color),
    status: spaceStatus(row.status),
""",
)
replace_once(
    "packages/storage/src/spaces.ts",
    """    const name = requiredText(input.name, "name");
    const description = optionalText(input.description, "description");
    const context = normalizeContext(contextInput);
""",
    """    const name = requiredText(input.name, "name");
    const description = optionalText(input.description, "description");
    const color = spaceColor(input.color);
    const context = normalizeContext(contextInput);
""",
)
replace_once(
    "packages/storage/src/spaces.ts",
    """          INSERT INTO spaces(id, key, name, description, status, version, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'active', 1, ?, ?)
        `)
        .run(id, key, name, description, context.now, context.now);
""",
    """          INSERT INTO spaces(
            id, key, name, description, color, status, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)
        `)
        .run(id, key, name, description, color, context.now, context.now);
""",
)
replace_once(
    "packages/storage/src/spaces.ts",
    """          payload: { id, key, name, initiatedBy: context.actorId },
""",
    """          payload: { id, key, name, color, initiatedBy: context.actorId },
""",
)
replace_once(
    "packages/storage/src/spaces.ts",
    """          details: { key, version: 1 }
""",
    """          details: { key, color, version: 1 }
""",
)
insert_before(
    "packages/storage/src/spaces.ts",
    """  listSpaces(options: ListSpacesOptions = {}): SpaceRecord[] {
""",
    """  updateSpace(
    spaceIdentity: string,
    input: UpdateSpaceInput,
    contextInput: MutationContext
  ): SpaceRecord {
    const name = input.name === undefined ? undefined : requiredText(input.name, "name");
    const description =
      input.description === undefined
        ? undefined
        : optionalText(input.description, "description");
    const color = input.color === undefined ? undefined : spaceColor(input.color);
    if (name === undefined && description === undefined && color === undefined) {
      throw new SpaceValidationError("at least one space field must be provided");
    }
    const context = normalizeContext(contextInput);

    return this.store.transaction((connection) => {
      const current = requireSpace(connection, spaceIdentity);
      const nextName = name ?? current.name;
      const nextDescription =
        description === undefined ? current.description : description;
      const currentColor = spaceColor(current.color);
      const nextColor = color ?? currentColor;
      if (
        nextName === current.name &&
        nextDescription === current.description &&
        nextColor === currentColor
      ) {
        return mapSpace(current);
      }

      const nextVersion = current.version + 1;
      connection
        .prepare(`
          UPDATE spaces
          SET name = ?, description = ?, color = ?, version = ?, updated_at = ?
          WHERE id = ?
        `)
        .run(
          nextName,
          nextDescription,
          nextColor,
          nextVersion,
          context.now,
          current.id
        );

      this.outbox.append(
        {
          eventType: "space.updated",
          schemaVersion: 1,
          source: "space-registry",
          occurredAt: context.now,
          payload: {
            id: current.id,
            key: current.key,
            name: nextName,
            description: nextDescription,
            color: nextColor,
            version: nextVersion,
            initiatedBy: context.actorId
          },
          dedupeKey: `space.updated:${current.id}:v${nextVersion}`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "update",
          objectType: "space",
          objectId: current.id,
          correlationId: context.correlationId,
          details: {
            key: current.key,
            name: nextName,
            color: nextColor,
            version: nextVersion
          }
        },
        connection
      );

      const row = spaceRowByIdentity(connection, current.id);
      if (row === undefined) {
        throw new Error(`Updated space was not found: ${current.id}`);
      }
      return mapSpace(row);
    });
  }

""",
)

replace_once(
    "apps/api/src/space-routes.ts",
    """interface CreateSpaceBody {
  key?: string;
  name: string;
  description?: string;
}

interface CreateSpaceEntityBody {
""",
    """interface CreateSpaceBody {
  key?: string;
  name: string;
  description?: string;
  color?: string;
}

interface UpdateSpaceBody {
  name?: string;
  description?: string;
  color?: string;
}

interface CreateSpaceEntityBody {
""",
)
replace_once(
    "apps/api/src/space-routes.ts",
    """const paginationProperties = {
""",
    """const spaceColorSchema = {
  type: "string",
  pattern: "^#[0-9A-Fa-f]{6}$"
} as const;

const paginationProperties = {
""",
)
replace_once(
    "apps/api/src/space-routes.ts",
    """            key: stableKeySchema,
            name: { type: "string", minLength: 1, maxLength: 500 },
            description: { type: "string", maxLength: 2_000 }
""",
    """            key: stableKeySchema,
            name: { type: "string", minLength: 1, maxLength: 500 },
            description: { type: "string", maxLength: 2_000 },
            color: spaceColorSchema
""",
)
insert_before(
    "apps/api/src/space-routes.ts",
    """  app.post<{ Params: SpaceParams; Body: CreateSpaceEntityBody }>(
""",
    """  app.patch<{ Params: SpaceParams; Body: UpdateSpaceBody }>(
    "/api/v1/spaces/:spaceId",
    {
      schema: {
        params: {
          type: "object",
          required: ["spaceId"],
          properties: { spaceId: idSchema }
        },
        body: {
          type: "object",
          additionalProperties: false,
          minProperties: 1,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 500 },
            description: { type: "string", maxLength: 2_000 },
            color: spaceColorSchema
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        registry.updateSpace(
          request.params.spaceId,
          request.body,
          mutationContextFromRequest(request)
        )
      )
  );

""",
)

replace_once(
    "apps/api/src/ui-routes.ts",
    '      "spaces.css",\n',
    '      "spaces.css",\n      "workspace-switcher.css",\n',
)
replace_once(
    "apps/api/src/ui-routes.ts",
    '      "operator-workflows-recovery.js",\n',
    '      "operator-workflows-recovery.js",\n      "workspace-switcher.js",\n',
)
replace_once(
    "scripts/ci/check-ui-bundles.mjs",
    '    "operator-workflows-recovery.js",\n',
    '    "operator-workflows-recovery.js",\n    "workspace-switcher.js",\n',
)
replace_once(
    "package.json",
    "node --check apps/api/ui/app.js && node --check apps/api/ui/help-center.js",
    "node --check apps/api/ui/app.js && node --check apps/api/ui/workspace-switcher.js && node --check apps/api/ui/help-center.js",
)

replace_once(
    "packages/storage/src/spaces.test.ts",
    """  DEFAULT_SPACE_ID,
  SpaceConflictError,
  SpaceNotFoundError,
  SpaceRegistry
""",
    """  DEFAULT_SPACE_COLOR,
  DEFAULT_SPACE_ID,
  SpaceConflictError,
  SpaceNotFoundError,
  SpaceRegistry,
  SpaceValidationError
""",
)
insert_before(
    "packages/storage/src/spaces.test.ts",
    """test("audience snapshots build one-per-member and aggregate document plans", () => {
""",
    """test("space colors persist, normalize and can be updated without moving data", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    assert.equal(spaces.getSpace(DEFAULT_SPACE_ID).color, DEFAULT_SPACE_COLOR);

    const created = spaces.createSpace(
      {
        key: "colored",
        name: "Цветное пространство",
        description: "Исходное описание",
        color: "#3d9472"
      },
      context("corr-colored")
    );
    assert.equal(created.color, "#3D9472");
    assert.equal(created.version, 1);

    const updated = spaces.updateSpace(
      created.id,
      {
        name: "Инженерная служба",
        description: "Отдельные люди, группы и документы",
        color: "#7568e8"
      },
      context("corr-colored-update")
    );
    assert.equal(updated.name, "Инженерная служба");
    assert.equal(updated.description, "Отдельные люди, группы и документы");
    assert.equal(updated.color, "#7568E8");
    assert.equal(updated.version, 2);
    assert.equal(spaces.getSpace(created.id).color, "#7568E8");

    assert.throws(
      () =>
        spaces.updateSpace(
          created.id,
          { color: "violet" },
          context("corr-colored-invalid")
        ),
      SpaceValidationError
    );
  } finally {
    fixture.cleanup();
  }
});

""",
)

replace_once(
    "apps/api/src/space-routes.test.ts",
    """        name: "Инженерная служба",
        description: "Изолированные данные инженерной службы"
""",
    """        name: "Инженерная служба",
        description: "Изолированные данные инженерной службы",
        color: "#3d9472"
""",
)
replace_once(
    "apps/api/src/space-routes.test.ts",
    """    const spaceData = (spaceResponse.json() as { data: { id: string; key: string } }).data;
    const spaceId = spaceData.id;
    assert.match(spaceData.key, /^space\.[a-f0-9]{32}$/u);

""",
    """    const spaceData = (
      spaceResponse.json() as {
        data: { id: string; key: string; color: string; version: number };
      }
    ).data;
    const spaceId = spaceData.id;
    assert.match(spaceData.key, /^space\.[a-f0-9]{32}$/u);
    assert.equal(spaceData.color, "#3D9472");
    assert.equal(spaceData.version, 1);

    const updateResponse = await app.inject({
      method: "PATCH",
      url: `/api/v1/spaces/${spaceId}`,
      headers,
      payload: {
        name: "Инженерное пространство",
        description: "Люди, группы, шаблоны и результаты инженерной службы",
        color: "#7568e8"
      }
    });
    assert.equal(updateResponse.statusCode, 200, updateResponse.body);
    const updatedSpace = (
      updateResponse.json() as {
        data: { name: string; description: string; color: string; version: number };
      }
    ).data;
    assert.equal(updatedSpace.name, "Инженерное пространство");
    assert.equal(
      updatedSpace.description,
      "Люди, группы, шаблоны и результаты инженерной службы"
    );
    assert.equal(updatedSpace.color, "#7568E8");
    assert.equal(updatedSpace.version, 2);

""",
)
insert_before(
    "apps/api/src/space-routes.test.ts",
    """test("spaces API rejects cross-space group membership", async () => {
""",
    """test("spaces API rejects invalid colors", async () => {
  const fixture = migratedFixture();
  const app = buildApp(
    loadApiConfig({
      DOCOMATOR_DATA_DIR: fixture.directory,
      DOCOMATOR_LOG_LEVEL: "fatal"
    }),
    { store: fixture.store }
  );

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/spaces",
      headers,
      payload: { name: "Некорректное пространство", color: "green" }
    });
    assert.equal(response.statusCode, 400, response.body);
  } finally {
    await app.close();
    fixture.cleanup();
  }
});

""",
)

append_once(
    "docs/SPACES_AND_AUDIENCES.md",
    "## 11. Рабочий переключатель пространств",
    """
## 11. Рабочий переключатель пространств

Текущее пространство выбирается из верхней панели на любом экране. Переключатель показывает цвет, название, количество сотрудников и групп. Из него можно создать новое пространство, изменить название и цвет либо открыть полный экран управления.

Цвет хранится в таблице `spaces`, возвращается API и одинаков для всех браузеров, работающих с локальным сервером. Допустим формат `#RRGGBB`; при обновлении старой базы миграция назначает безопасный цвет по умолчанию.

```text
POST  /api/v1/spaces                    # создание с name, description, color
PATCH /api/v1/spaces/:spaceId           # изменение name, description, color
```

При переключении интерфейс очищает локальный выбор и повторно получает данные выбранного пространства. Маршруты сотрудников, групп, исходных документов, шаблонов, выпусков, результатов и расписаний уже содержат `spaceId`; идентификатор ресурса из другого пространства не подмешивается в текущий экран.
""",
)
replace_once(
    "docs/CHANGELOG.md",
    "# Журнал изменений Docomator\n\n",
    """# Журнал изменений Docomator

## 2026-07-26 — функциональные пространства

- Неактивная надпись в верхней панели заменена доступным переключателем пространства на каждом экране.
- Добавлены создание, переименование и выбор цвета; цвет хранится в SQLite и одинаков для всех локальных клиентов.
- При переключении повторно загружаются сотрудники, группы, шаблоны, выпуски, результаты и расписания выбранного пространства.
- API получил `PATCH /api/v1/spaces/:spaceId`, серверную проверку `#RRGGBB` и тесты сохранения и межпространственной целостности.

""",
)

print("Functional spaces patch applied successfully.")
