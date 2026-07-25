from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def patch(path: str, old: str, new: str) -> None:
    target = ROOT / path
    value = target.read_text(encoding="utf-8")
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}")
    target.write_text(value.replace(old, new, 1), encoding="utf-8")
    print(f"updated {path}")


patch(
    "apps/api/src/data-import-routes.ts",
    '''  groupId: string | null;
}>(result: T, includeTechnicalDetails: boolean) {''',
    '''  groupId: string | null;
  mappingResolutions?: unknown;
}>(result: T, includeTechnicalDetails: boolean) {''',
)
patch(
    "apps/api/src/data-import-routes.ts",
    '''    groupId: _groupId,
    ...publicResult''',
    '''    groupId: _groupId,
    mappingResolutions: _mappingResolutions,
    ...publicResult''',
)
patch(
    "apps/api/src/data-import-routes.ts",
    '''      reply.header("cache-control", "no-store");
      return responseEnvelope(request, plan);''',
    '''      const { mappingResolutions: _mappingResolutions, ...publicPlan } = plan;
      reply.header("cache-control", "no-store");
      return responseEnvelope(request, publicPlan);''',
)
patch(
    "apps/api/ui/bulk-data-import-v2.js",
    '"Устойчивый ключ для повторных импортов"',
    '"Используется при повторных импортах"',
)

print("public import contract fixed")
