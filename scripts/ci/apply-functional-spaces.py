from pathlib import Path

patch = Path("scripts/ci/fix-functional-spaces-regressions.py")
if not patch.is_file():
    raise SystemExit("Не найден сценарий исправления регрессий функциональных пространств")

source = patch.read_text(encoding="utf-8")
exec(compile(source, str(patch), "exec"), {"__name__": "__main__"})

patch.unlink()
for temporary in (
    ".fix-functional-spaces-e2e",
    ".apply-functional-spaces-v2",
):
    Path(temporary).unlink(missing_ok=True)

print("Исправления применены; временные сценарии очищены.")
