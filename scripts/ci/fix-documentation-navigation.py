from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
path = ROOT / "apps/api/ui/documentation-center.js"
value = path.read_text(encoding="utf-8")
old = '''    button.addEventListener("click", (event) => {
      event.preventDefault();
      documentationOpen();
    });'''
new = '''    button.addEventListener("click", (event) => {
      event.preventDefault();
      documentationSetVisible(true);
      documentationShowIndex(true);
      documentQuery("#documentationSearch")?.focus();
    });'''
if old not in value:
    if new in value:
        print("documentation navigation already fixed")
    else:
        raise RuntimeError("Documentation navigation handler was not found")
else:
    path.write_text(value.replace(old, new, 1), encoding="utf-8")
    print("updated apps/api/ui/documentation-center.js")
