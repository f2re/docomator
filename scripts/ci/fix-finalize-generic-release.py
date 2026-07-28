from pathlib import Path

path = Path(__file__).resolve().with_name("finalize-generic-release.py")
value = path.read_text(encoding="utf-8")

old_examples = '''# Exact example inventories inside the release builder and verifier.
for relative in [
    "scripts/offline/prepare-bundle.sh",
    "scripts/offline/verify-bundle.sh",
    "scripts/offline/verify-bundle.test.mjs",
]:
    value = read(relative)
    value = replace_in(
        value,
        '  "data/employees.csv"\n',
        '  "data/auditoriums.csv"\n  "data/employees.csv"\n  "data/scientific-articles.csv"\n',
        f"{relative} example list"
    )
    write(relative, value)
'''
new_examples = '''# Exact example inventories inside the release builder and verifier.
example_inventory_patches = [
    (
        "scripts/offline/prepare-bundle.sh",
        '  "data/employees.csv"\n',
        '  "data/auditoriums.csv"\n  "data/employees.csv"\n  "data/scientific-articles.csv"\n',
        1,
    ),
    (
        "scripts/offline/verify-bundle.sh",
        '  "data/employees.csv"\n',
        '  "data/auditoriums.csv"\n  "data/employees.csv"\n  "data/scientific-articles.csv"\n',
        2,
    ),
    (
        "scripts/offline/verify-bundle.test.mjs",
        '  "data/employees.csv",\n',
        '  "data/auditoriums.csv",\n  "data/employees.csv",\n  "data/scientific-articles.csv",\n',
        2,
    ),
]
for relative, old_item, new_items, expected_count in example_inventory_patches:
    value = read(relative)
    actual_count = value.count(old_item)
    if actual_count != expected_count:
        raise RuntimeError(
            f"{relative}: expected {expected_count} example list occurrence(s), found {actual_count}"
        )
    write(relative, value.replace(old_item, new_items, expected_count))
'''
if value.count(old_examples) != 1:
    raise RuntimeError("example inventory patch block not found")
value = value.replace(old_examples, new_examples, 1)

old_e2e = '''# Include the new E2E scenario in the exact offline acceptance inventory.
for relative in [
    "scripts/offline/prepare-bundle.sh",
    "scripts/offline/verify-release.mjs",
    "scripts/offline/verify-bundle.test.mjs",
]:
    value = read(relative)
    value = replace_in(
        value,
        '    "employee-card.spec.mjs",\n',
        '    "employee-card.spec.mjs",\n    "generic-entities.spec.mjs",\n',
        f"{relative} E2E inventory"
    )
    write(relative, value)
'''
new_e2e = '''# Include the new E2E scenario in the exact offline acceptance inventory.
e2e_inventory_patches = [
    (
        "scripts/offline/prepare-bundle.sh",
        '    "employee-card.spec.mjs"\n',
        '    "employee-card.spec.mjs"\n    "generic-entities.spec.mjs"\n',
    ),
    (
        "scripts/offline/verify-release.mjs",
        '    "employee-card.spec.mjs",\n',
        '    "employee-card.spec.mjs",\n    "generic-entities.spec.mjs",\n',
    ),
    (
        "scripts/offline/verify-bundle.test.mjs",
        '  "employee-card.spec.mjs",\n',
        '  "employee-card.spec.mjs",\n  "generic-entities.spec.mjs",\n',
    ),
]
for relative, old_item, new_items in e2e_inventory_patches:
    value = read(relative)
    value = replace_in(value, old_item, new_items, f"{relative} E2E inventory")
    write(relative, value)
'''
if value.count(old_e2e) != 1:
    raise RuntimeError("E2E inventory patch block not found")
value = value.replace(old_e2e, new_e2e, 1)

value = value.replace(
    '    "# Пространства и аудитории документов\n",',
    '    "# Пространства, группы и аудитории документов\n",',
    1,
)

old_finish = 'print("final generic release patch applied")\n'
new_finish = '''# The application dispatches view changes on window. The catalog used document,
# so its first load was silently skipped after navigation.
entity_workspace = read("apps/api/ui/entity-workspace.js")
entity_workspace = replace_in(
    entity_workspace,
    '''    document.addEventListener("docomator:view-changed", (event) => {
      if (event.detail?.view === "entities") void entityWorkspaceLoad();
    });''',
    '''    window.addEventListener("docomator:view-changed", (event) => {
      if (event.detail?.view === "entities") void entityWorkspaceLoad();
    });''',
    "entity workspace view event target",
)
entity_workspace = replace_in(
    entity_workspace,
    '''    document.addEventListener("docomator:space-changed", () => {
      entityWorkspaceState.ready = false;
      entityWorkspaceState.entities = [];
      entityWorkspaceState.search = "";
      if (state.view === "entities") void entityWorkspaceLoad();
    });
  }''',
    '''    document.addEventListener("docomator:space-changed", () => {
      entityWorkspaceState.ready = false;
      entityWorkspaceState.entities = [];
      entityWorkspaceState.search = "";
      if (state.view === "entities") void entityWorkspaceLoad();
    });
    globalThis.docomatorEntityWorkspaceReload = entityWorkspaceLoad;
    if (state.view === "entities") void entityWorkspaceLoad();
  }''',
    "entity workspace initial load",
)
write("apps/api/ui/entity-workspace.js", entity_workspace)

print("final generic release patch applied")
'''
if value.count(old_finish) != 1:
    raise RuntimeError("final marker not found")
value = value.replace(old_finish, new_finish, 1)

path.write_text(value, encoding="utf-8")
print("final generic release script fixed")
