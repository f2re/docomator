from pathlib import Path

root = Path(__file__).resolve().parents[2]
path = root / "scripts/offline/verify-release.mjs"
text = path.read_text(encoding="utf-8")
old = '''    "employee-card.spec.mjs",
    "fixtures/docomator-api.mjs",'''
new = '''    "employee-card.spec.mjs",
    "help-center.spec.mjs",
    "fixtures/docomator-api.mjs",'''
count = text.count(old)
if count != 1:
    raise RuntimeError(f"expected one UX file list occurrence, found {count}")
path.write_text(text.replace(old, new, 1), encoding="utf-8")
print("updated scripts/offline/verify-release.mjs")
