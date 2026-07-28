import re
from pathlib import Path

path = Path(__file__).resolve().with_name("finalize-generic-release.py")
value = path.read_text(encoding="utf-8")

new_examples = r'''# Exact example inventories inside the release builder and verifier.
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
    source = read(relative)
    actual_count = source.count(old_item)
    if actual_count != expected_count:
        raise RuntimeError(
            f"{relative}: expected {expected_count} example list occurrence(s), found {actual_count}"
        )
    write(relative, source.replace(old_item, new_items, expected_count))
'''
value, count = re.subn(
    r'''# Exact example inventories inside the release builder and verifier\.\n.*?\n\n(?=# ---------------------------------------------------------------------------\n# 3\.)''',
    lambda _match: new_examples + "\n",
    value,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError("example inventory patch block not found")

new_e2e = r'''# Include the new E2E scenario in the exact offline acceptance inventory.
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
    source = read(relative)
    source = replace_in(source, old_item, new_items, f"{relative} E2E inventory")
    write(relative, source)
'''
value, count = re.subn(
    r'''# Include the new E2E scenario in the exact offline acceptance inventory\.\n.*?\n\n(?=# ---------------------------------------------------------------------------\n# 4\.)''',
    lambda _match: new_e2e + "\n",
    value,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError("E2E inventory patch block not found")

value = value.replace(
    '    "# Пространства и аудитории документов\\n",',
    '    "# Пространства, группы и аудитории документов\\n",',
    1,
)

old_ci_finish = r'''if "  offline-bundle:\n" in ci:
    raise RuntimeError("offline-bundle job already exists")
ci += offline_job
write(".github/workflows/ci.yml", ci)
'''
new_ci_finish = r'''if "  offline-bundle:\n" not in ci:
    ci += offline_job
    write(".github/workflows/ci.yml", ci)
'''
if value.count(old_ci_finish) != 1:
    raise RuntimeError("offline CI patch block not found")
value = value.replace(old_ci_finish, new_ci_finish, 1)

marker = 'print("final generic release patch applied")\n'
injection = r"""# The application dispatches view changes on window. The catalog used document,
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

"""
if value.count(marker) != 1:
    raise RuntimeError("final marker not found")
value = value.replace(marker, injection + marker, 1)

path.write_text(value, encoding="utf-8")
print("final generic release script fixed")
