from pathlib import Path

path = Path(__file__).with_name("apply-template-structure-preview-csp.py")
value = path.read_text(encoding="utf-8")
old = '''.generation-progress-bar {
  height: 0.65rem;
  overflow: hidden;
  background: var(--surface-2);
  border-radius: 999px;
}

.generation-progress-bar span {
  display: block;
  width: var(--progress);
  height: 100%;
  background: var(--accent);
  border-radius: inherit;
}'''
new = '''.generation-progress-bar {
  height: 0.55rem;
  overflow: hidden;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.generation-progress-bar > span {
  display: block;
  height: 100%;
  width: var(--progress, 0%);
  background: var(--accent);
  transition: width 180ms ease;
}'''
if value.count(old) != 1:
    raise RuntimeError("Не найдено исходное ожидание CSS полосы выпуска.")
path.write_text(value.replace(old, new, 1), encoding="utf-8")
print("updated patch expectation for document-generation.css")
