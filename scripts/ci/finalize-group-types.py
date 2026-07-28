from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def patch(relative: str, old: str, new: str, *, count: int = 1) -> None:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")
    actual = value.count(old)
    if actual != count:
        raise RuntimeError(
            f"{relative}: expected {count} occurrence(s), found {actual}: {old[:160]!r}"
        )
    path.write_text(value.replace(old, new, count), encoding="utf-8")
    print(f"updated {relative}")


patch(
    "packages/storage/src/spaces.ts",
    '''  memberCount: number;
  createdAt: string;''',
    '''  memberCount: number;
  entityTypeKey: string | null;
  entityTypeLabel: string | null;
  createdAt: string;'''
)
patch(
    "packages/storage/src/spaces.ts",
    '''  member_count: number;
  created_at: string;''',
    '''  member_count: number;
  entity_type_key: string | null;
  entity_type_label: string | null;
  created_at: string;'''
)
patch(
    "packages/storage/src/spaces.ts",
    '''    memberCount: Number(row.member_count),
    createdAt: row.created_at,''',
    '''    memberCount: Number(row.member_count),
    entityTypeKey: row.entity_type_key,
    entityTypeLabel: row.entity_type_label,
    createdAt: row.created_at,'''
)

old_group_query = '''      SELECT g.*,
             (SELECT COUNT(*) FROM audience_group_members gm WHERE gm.group_id = g.id) AS member_count
      FROM audience_groups g
      WHERE g.id = ?'''
new_group_query = '''      SELECT g.*,
             (SELECT COUNT(*) FROM audience_group_members gm WHERE gm.group_id = g.id) AS member_count,
             (
               SELECT et.key
               FROM audience_group_members gm
               JOIN entities e ON e.id = gm.entity_id
               JOIN entity_types et ON et.id = e.entity_type_id
               WHERE gm.group_id = g.id
               ORDER BY gm.position ASC, gm.entity_id ASC
               LIMIT 1
             ) AS entity_type_key,
             (
               SELECT et.label
               FROM audience_group_members gm
               JOIN entities e ON e.id = gm.entity_id
               JOIN entity_types et ON et.id = e.entity_type_id
               WHERE gm.group_id = g.id
               ORDER BY gm.position ASC, gm.entity_id ASC
               LIMIT 1
             ) AS entity_type_label
      FROM audience_groups g
      WHERE g.id = ?'''
patch("packages/storage/src/spaces.ts", old_group_query, new_group_query)

old_list_query = '''          SELECT g.*,
                 (SELECT COUNT(*) FROM audience_group_members gm WHERE gm.group_id = g.id) AS member_count
          FROM audience_groups g
          WHERE g.space_id = ?'''
new_list_query = '''          SELECT g.*,
                 (SELECT COUNT(*) FROM audience_group_members gm WHERE gm.group_id = g.id) AS member_count,
                 (
                   SELECT et.key
                   FROM audience_group_members gm
                   JOIN entities e ON e.id = gm.entity_id
                   JOIN entity_types et ON et.id = e.entity_type_id
                   WHERE gm.group_id = g.id
                   ORDER BY gm.position ASC, gm.entity_id ASC
                   LIMIT 1
                 ) AS entity_type_key,
                 (
                   SELECT et.label
                   FROM audience_group_members gm
                   JOIN entities e ON e.id = gm.entity_id
                   JOIN entity_types et ON et.id = e.entity_type_id
                   WHERE gm.group_id = g.id
                   ORDER BY gm.position ASC, gm.entity_id ASC
                   LIMIT 1
                 ) AS entity_type_label
          FROM audience_groups g
          WHERE g.space_id = ?'''
patch("packages/storage/src/spaces.ts", old_list_query, new_list_query)

patch(
    "packages/storage/src/spaces.test.ts",
    '''    spaces.replaceGroupMembers(
      space.id,
      group.id,
      [room.entityId],
      context("corr-room-group")
    );
    const grouped = spaces.createAudienceSnapshot(''',
    '''    spaces.replaceGroupMembers(
      space.id,
      group.id,
      [room.entityId],
      context("corr-room-group")
    );
    const typedGroup = spaces.listGroups(space.id).find(
      (candidate) => candidate.id === group.id
    );
    assert.ok(typedGroup);
    assert.equal(typedGroup.entityTypeKey, "room");
    assert.equal(typedGroup.entityTypeLabel, "Аудитория");
    const grouped = spaces.createAudienceSnapshot('''
)

# E2E fixture: all space entities expose the stable type key.
patch(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''      entityId: employee.entityId,
      displayName: employee.displayName,
      entityTypeLabel: "Человек",''',
    '''      entityId: employee.entityId,
      displayName: employee.displayName,
      entityTypeKey: "person",
      entityTypeLabel: "Человек",'''
)
patch(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''        entityId: id,
        displayName: employee.displayName,
        entityTypeLabel: "Человек",
        status: employee.status''',
    '''        entityId: id,
        displayName: employee.displayName,
        entityTypeKey: "person",
        entityTypeLabel: "Человек",
        status: employee.status''',
    count=1
)
patch(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''          entityId: id,
          displayName: employee.displayName,
          entityTypeLabel: "Человек",
          status: "active"''',
    '''          entityId: id,
          displayName: employee.displayName,
          entityTypeKey: payload.entityTypeKey || "person",
          entityTypeLabel:
            payload.entityTypeKey && payload.entityTypeKey !== "person"
              ? state.entityTypes.find((type) => type.key === payload.entityTypeKey)?.label || payload.entityTypeKey
              : "Человек",
          status: "active"'''
)
patch(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''        memberCount: 0,
        memberIds: []''',
    '''        memberCount: 0,
        entityTypeKey: null,
        entityTypeLabel: null,
        memberIds: []'''
)
patch(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''      if (group) {
        group.memberIds = [...new Set(payload.entityIds || [])];
        group.memberCount = group.memberIds.length;
        group.version += 1;
      }''',
    '''      if (group) {
        group.memberIds = [...new Set(payload.entityIds || [])];
        group.memberCount = group.memberIds.length;
        const firstEntity = space.entities.find(
          (entity) => entity.entityId === group.memberIds[0]
        );
        group.entityTypeKey = firstEntity?.entityTypeKey || null;
        group.entityTypeLabel = firstEntity?.entityTypeLabel || null;
        group.version += 1;
      }'''
)
patch(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''    properties: Array.isArray(options.properties) ? options.properties.map((property) => structuredClone(property)) : [],''',
    '''    entityTypes: Array.isArray(options.entityTypes)
      ? options.entityTypes.map((type) => structuredClone(type))
      : [{ key: "person", label: "Человек", description: "Сотрудник" }],
    properties: Array.isArray(options.properties) ? options.properties.map((property) => structuredClone(property)) : [],'''
)
patch(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''    } else if (path === "/api/v1/knowledge/entity-types") {
      data = [{ key: "person", label: "Человек", description: "Сотрудник" }];''',
    '''    } else if (
      path === "/api/v1/knowledge/entity-types" &&
      method === "POST"
    ) {
      const payload = await jsonBody(request);
      const type = {
        key: `entity_type_e2e_${state.entityTypes.length + 1}`,
        label: payload.label,
        description: payload.description || null
      };
      state.entityTypes.push(type);
      data = type;
    } else if (path === "/api/v1/knowledge/entity-types") {
      data = state.entityTypes;'''
)

# Filter saved groups by the selected entity type while preserving legacy person fixtures.
generation = ROOT / "apps/api/ui/generic-document-generation.js"
value = generation.read_text(encoding="utf-8")
value = value.replace(
    '  let genericGenerationAllEntities = [];\n  let genericGenerationTypeKey = "";',
    '  let genericGenerationAllEntities = [];\n  let genericGenerationAllGroups = [];\n  let genericGenerationTypeKey = "";',
    1
)
value = value.replace(
    '''    generationEntities = genericGenerationTypeKey
      ? genericGenerationAllEntities.filter(
          (entity) => entity.entityTypeKey === genericGenerationTypeKey
        )
      : [...genericGenerationAllEntities];''',
    '''    generationEntities = genericGenerationTypeKey
      ? genericGenerationAllEntities.filter(
          (entity) => entity.entityTypeKey === genericGenerationTypeKey
        )
      : [...genericGenerationAllEntities];
    generationGroups = genericGenerationTypeKey
      ? genericGenerationAllGroups.filter(
          (group) => (group.entityTypeKey || "person") === genericGenerationTypeKey
        )
      : [...genericGenerationAllGroups];''',
    1
)
value = value.replace(
    '''    if (genericGenerationAllEntities.length === 0 && generationEntities.length > 0) {
      genericGenerationAllEntities = [...generationEntities];
    }
    genericGenerationApplyFilter();''',
    '''    if (genericGenerationAllEntities.length === 0 && generationEntities.length > 0) {
      genericGenerationAllEntities = [...generationEntities];
    }
    if (genericGenerationAllGroups.length === 0 && generationGroups.length > 0) {
      genericGenerationAllGroups = [...generationGroups];
    }
    genericGenerationApplyFilter();''',
    1
)
value = value.replace(
    '''    genericGenerationAllEntities = [];
    await genericGenerationBaseLoadWorkspace();''',
    '''    genericGenerationAllEntities = [];
    genericGenerationAllGroups = [];
    await genericGenerationBaseLoadWorkspace();''',
    1
)
value = value.replace(
    '''    if (genericGenerationAllEntities.length === 0 && generationEntities.length > 0) {
      genericGenerationAllEntities = [...generationEntities];
      genericGenerationApplyFilter();
      renderGenerationWorkspace();
    }''',
    '''    if (genericGenerationAllEntities.length === 0 && generationEntities.length > 0) {
      genericGenerationAllEntities = [...generationEntities];
    }
    if (genericGenerationAllGroups.length === 0 && generationGroups.length > 0) {
      genericGenerationAllGroups = [...generationGroups];
    }
    if (genericGenerationAllEntities.length > 0 || genericGenerationAllGroups.length > 0) {
      genericGenerationApplyFilter();
      renderGenerationWorkspace();
    }''',
    1
)
value = value.replace(
    '''    genericGenerationAllEntities = [];
    genericGenerationTypeKey = "";''',
    '''    genericGenerationAllEntities = [];
    genericGenerationAllGroups = [];
    genericGenerationTypeKey = "";''',
    1
)
generation.write_text(value, encoding="utf-8")
print("updated apps/api/ui/generic-document-generation.js")

print("group type finalization applied")
