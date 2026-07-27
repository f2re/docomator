from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(relative: str, old: str, new: str) -> None:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{relative}: expected one occurrence, found {count}: {old[:120]!r}")
    path.write_text(value.replace(old, new, 1), encoding="utf-8")
    print(f"updated {relative}")


def append_once(relative: str, marker: str, addition: str) -> None:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")
    if addition.strip() in value:
        print(f"already present {relative}")
        return
    if marker not in value:
        raise RuntimeError(f"{relative}: marker not found: {marker[:120]!r}")
    path.write_text(value + addition, encoding="utf-8")
    print(f"appended {relative}")


# Assisted mapping must resolve labels inside the selected entity type, not globally.
replace_once(
    "packages/storage/src/data-import-assist.ts",
    '''  ): PreparedAssistedImport {
    const definitions = this.knowledge.listPropertyDefinitions(500);''',
    '''  ): PreparedAssistedImport {
    const entityTypeKey = (input.entityTypeKey ?? "person").trim().toLowerCase();
    const definitions = this.knowledge.listPropertyDefinitions(500);'''
)
replace_once(
    "packages/storage/src/data-import-assist.ts",
    '''    for (const definition of definitions) {
      const key = normalizeIdentity(definition.label);''',
    '''    for (const definition of definitions) {
      const appliesTo = Array.isArray(definition.appliesTo) ? definition.appliesTo : [];
      if (appliesTo.length > 0 && !appliesTo.includes(entityTypeKey)) continue;
      const key = normalizeIdentity(definition.label);'''
)
replace_once(
    "packages/storage/src/data-import-assist.ts",
    '''            sensitivity: source.sensitivity ?? "personal",
            appliesTo: [input.entityTypeKey ?? "person"],''',
    '''            sensitivity:
              source.sensitivity ?? (entityTypeKey === "person" ? "personal" : "internal"),
            appliesTo: [entityTypeKey],'''
)

# Generic imports use neutral generated keys and neutral operator messages.
path = ROOT / "packages/storage/src/data-import.ts"
value = path.read_text(encoding="utf-8")
replacements = {
    'generateOpaqueStableKey("employee_field")': 'generateOpaqueStableKey("entity_field")',
    'generateOpaqueStableKey("employee_group")': 'generateOpaqueStableKey("entity_group")',
    '"Выбранные колонки для поиска сотрудника и его ФИО должны присутствовать в файле."': '"Выбранные колонки для поиска объекта и его отображаемого названия должны присутствовать в файле."',
    '? `Не заполнена колонка «${identityColumn}», выбранная для поиска сотрудника.`': '? `Не заполнена колонка «${identityColumn}», выбранная для поиска объекта.`',
    ': `Не заполнена колонка «${displayNameColumn}» с ФИО сотрудника.`': ': `Не заполнена колонка «${displayNameColumn}» с отображаемым названием объекта.`',
    '"Найдено несколько сотрудников с одинаковым значением выбранной колонки."': '"Найдено несколько объектов с одинаковым значением выбранной колонки."'
}
for old, new in replacements.items():
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"packages/storage/src/data-import.ts: expected one occurrence, found {count}: {old!r}")
    value = value.replace(old, new, 1)
path.write_text(value, encoding="utf-8")
print("updated packages/storage/src/data-import.ts")

# A group and one document context must contain objects of one entity type.
replace_once(
    "packages/storage/src/spaces.ts",
    '''      const group = requireGroup(connection, space.id, groupIdValue);
      for (const entityId of entityIds) {
        requireEntityInSpace(connection, space.id, entityId);
      }

      connection.prepare("DELETE FROM audience_group_members WHERE group_id = ?").run(group.id);''',
    '''      const group = requireGroup(connection, space.id, groupIdValue);
      const entityTypes = new Set<string>();
      for (const entityId of entityIds) {
        const entity = requireEntityInSpace(connection, space.id, entityId);
        entityTypes.add(entity.entity_type_key);
      }
      if (entityTypes.size > 1) {
        throw new SpaceValidationError(
          "Одна группа может содержать только объекты одного типа. Создайте отдельные группы для разных типов данных."
        );
      }

      connection.prepare("DELETE FROM audience_group_members WHERE group_id = ?").run(group.id);'''
)
replace_once(
    "packages/storage/src/spaces.ts",
    '''      if (rows.length === 0) {
        throw new SpaceValidationError(
          "Audience is empty. Select at least one active member before creating a snapshot."
        );
      }

      const criteria = toJsonValue({''',
    '''      if (rows.length === 0) {
        throw new SpaceValidationError(
          "Состав пуст. Выберите хотя бы один активный объект перед созданием снимка."
        );
      }
      const entityTypes = [...new Set(rows.map((row) => row.entity_type_key))];
      if (entityTypes.length > 1) {
        throw new SpaceValidationError(
          "Один выпуск документов может использовать только объекты одного типа. Выберите тип данных или создайте отдельные группы."
        );
      }
      entityTypeKey = entityTypes[0] ?? entityTypeKey;

      const criteria = toJsonValue({'''
)

append_once(
    "packages/storage/src/data-import-assist.test.ts",
    "test(\"closed imported list rejects a value outside configured options without creating a person\"",
    r'''

test("assisted import resolves equal labels inside the selected arbitrary entity type", () => {
  const fixture = createMigratedTestStore();
  try {
    const spaces = new SpaceRegistry(fixture.store);
    const knowledge = new KnowledgeRegistry(fixture.store);
    const imports = new AssistedDataImportRegistry(fixture.store, { spaces, knowledge });
    knowledge.createEntityType(
      { key: "room", label: "Аудитория", description: "Учебное помещение" },
      context("corr-room-type")
    );
    knowledge.createEntityType(
      { key: "article", label: "Научная статья" },
      context("corr-article-type")
    );
    const roomNumber = knowledge.createPropertyDefinition(
      {
        key: "room.number",
        label: "Номер",
        valueType: "string",
        sensitivity: "internal",
        appliesTo: ["room"]
      },
      context("corr-room-number")
    );
    knowledge.createPropertyDefinition(
      {
        key: "article.number",
        label: "Номер",
        valueType: "string",
        sensitivity: "internal",
        appliesTo: ["article"]
      },
      context("corr-article-number")
    );
    const space = spaces.createSpace(
      { key: "campus", name: "Учебный корпус" },
      context("corr-campus")
    );
    const input: AssistedExecuteDataImportInput = {
      entityTypeKey: "room",
      fileName: "аудитории.csv",
      fileFormat: "csv",
      sourceSha256: "d".repeat(64),
      identityColumn: "Код",
      displayNameColumn: "Название",
      headers: ["Код", "Название", "Номер", "Вместимость"],
      rows: [
        {
          "Код": "ROOM-101",
          "Название": "Аудитория 101",
          "Номер": "101",
          "Вместимость": "32"
        }
      ],
      mappings: [
        {
          column: "Номер",
          createIfMissing: true,
          label: "Номер",
          valueType: "string"
        },
        {
          column: "Вместимость",
          createIfMissing: true,
          label: "Вместимость",
          valueType: "integer"
        }
      ]
    };

    const result = imports.execute(space.id, input, context("corr-room-import"));
    assert.equal(result.createdCount, 1);
    assert.equal(result.failedCount, 0);
    assert.equal(
      result.mappingResolutions.find((item) => item.column === "Номер")?.propertyKey,
      roomNumber.key
    );
    assert.equal(
      result.mappingResolutions.find((item) => item.column === "Номер")?.matchedBy,
      "label"
    );
    const capacity = knowledge
      .listPropertyDefinitions()
      .find((definition) => definition.label === "Вместимость");
    assert.ok(capacity);
    assert.deepEqual(capacity.appliesTo, ["room"]);
    assert.equal(capacity.sensitivity, "internal");
    assert.deepEqual(
      spaces.listEntities(space.id).map((entity) => entity.entityTypeKey),
      ["room"]
    );
  } finally {
    fixture.cleanup();
  }
});
'''
)

append_once(
    "packages/storage/src/spaces.test.ts",
    "test(\"spaces isolate entities and preserve default ownership\"",
    r'''

test("groups and document snapshots keep one arbitrary entity type", () => {
  const fixture = createMigratedTestStore();
  try {
    const knowledge = new KnowledgeRegistry(fixture.store);
    const spaces = new SpaceRegistry(fixture.store);
    knowledge.createEntityType(
      { key: "room", label: "Аудитория" },
      context("corr-room-type")
    );
    knowledge.createEntityType(
      { key: "article", label: "Научная статья" },
      context("corr-article-type")
    );
    const space = spaces.createSpace(
      { key: "generic", name: "Произвольные объекты" },
      context("corr-generic-space")
    );
    const room = spaces.createEntity(
      space.id,
      { entityTypeKey: "room", displayName: "Аудитория 101" },
      context("corr-room")
    );
    const article = spaces.createEntity(
      space.id,
      { entityTypeKey: "article", displayName: "Статья о прогнозе" },
      context("corr-article")
    );
    const group = spaces.createGroup(
      space.id,
      { key: "rooms", name: "Аудитории" },
      context("corr-group")
    );

    assert.throws(
      () =>
        spaces.replaceGroupMembers(
          space.id,
          group.id,
          [room.entityId, article.entityId],
          context("corr-mixed-group")
        ),
      SpaceValidationError
    );

    spaces.replaceGroupMembers(
      space.id,
      group.id,
      [room.entityId],
      context("corr-room-group")
    );
    const grouped = spaces.createAudienceSnapshot(
      space.id,
      { source: { kind: "group", groupId: group.id }, targetMode: "aggregate" },
      context("corr-room-snapshot")
    );
    assert.equal(grouped.snapshot.entityTypeKey, "room");
    assert.deepEqual(grouped.snapshot.members.map((member) => member.entityTypeKey), ["room"]);

    assert.throws(
      () =>
        spaces.createAudienceSnapshot(
          space.id,
          { source: { kind: "all_space" }, targetMode: "aggregate" },
          context("corr-mixed-snapshot")
        ),
      SpaceValidationError
    );
    const filtered = spaces.createAudienceSnapshot(
      space.id,
      {
        source: { kind: "all_space", entityTypeKey: "article" },
        targetMode: "one_per_member"
      },
      context("corr-article-snapshot")
    );
    assert.equal(filtered.snapshot.entityTypeKey, "article");
    assert.deepEqual(filtered.snapshot.members.map((member) => member.entityId), [article.entityId]);
  } finally {
    fixture.cleanup();
  }
});
'''
)

print("generic entity backend patches applied")
