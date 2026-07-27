from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
path = ROOT / "tests/e2e/fixtures/docomator-api.mjs"
value = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str) -> None:
    global value
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"expected one occurrence, found {count}: {old[:80]}")
    value = value.replace(old, new, 1)


replace_once(
    "    properties: [],",
    "    properties: Array.isArray(options.properties) ? options.properties.map((property) => structuredClone(property)) : [],"
)
replace_once(
    '''      state.properties.push(definition);
      data = definition;
    } else if (path === "/api/v1/spaces") {''',
    '''      state.properties.push(definition);
      data = definition;
    } else if (
      /\\/knowledge\\/property-definitions\\/[^/]+\\/group$/.test(path) &&
      method === "PUT"
    ) {
      const key = decodeURIComponent(path.split("/").at(-2));
      const payload = await jsonBody(request);
      const definition = state.properties.find((candidate) => candidate.key === key);
      if (definition) {
        definition.validation = {
          ...(definition.validation || {}),
          uiGroup: payload.uiGroup
        };
      }
      data = definition;
    } else if (path === "/api/v1/spaces") {'''
)
replace_once(
    '''               sensitivity: "personal",
               appliesTo: ["person"]
             };''',
    '''               sensitivity: "personal",
               appliesTo: ["person"],
               validation: {
                 uiGroup: field.definition.uiGroup || "unassigned"
               }
             };'''
)
path.write_text(value, encoding="utf-8")
print("updated e2e property group fixture")
