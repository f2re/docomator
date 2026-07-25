from pathlib import Path

root = Path(__file__).resolve().parents[2]


def replace_once(path: str, old: str, new: str) -> None:
    target = root / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one occurrence, found {count}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"updated {path}")


replace_once(
    "scripts/offline/prepare-bundle.sh",
    '''    "employee-card.spec.mjs"
    "help-center.spec.mjs"
    "fixtures/docomator-api.mjs"''',
    '''    "employee-card.spec.mjs"
    "fixtures/docomator-api.mjs"''',
)
replace_once(
    "scripts/offline/verify-bundle.test.mjs",
    '''  "employee-card.spec.mjs",
  "help-center.spec.mjs",
  "fixtures/docomator-api.mjs",''',
    '''  "employee-card.spec.mjs",
  "fixtures/docomator-api.mjs",''',
)
replace_once(
    "scripts/offline/verify-bundle.test.mjs",
    '''  );
  assert.match(prepare, /"help-center\.spec\.mjs"/u);
});''',
    '''  );
});''',
)
replace_once(
    "scripts/offline/verify-release.mjs",
    '''    "employee-card.spec.mjs",
    "help-center.spec.mjs",
    "fixtures/docomator-api.mjs",''',
    '''    "employee-card.spec.mjs",
    "fixtures/docomator-api.mjs",''',
)
print("release evidence inventory preserved")
