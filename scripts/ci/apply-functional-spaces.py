from __future__ import annotations

from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def run(*args: str) -> str:
    return subprocess.run(
        args,
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    ).stdout


def replace_once(path: str, old: str, new: str) -> None:
    file = ROOT / path
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(
            f"{path}: ожидалось одно совпадение, найдено {count}\n--- ориентир ---\n{old}"
        )
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "apps/api/ui/interface-hierarchy.js",
    '''      const context = interfaceQuery("#currentSpaceChip", actions);
      actions.insertBefore(stage, context || control);
''',
    '''      const context = interfaceQuery("#currentSpaceChip", actions);
      const contextHost = context?.closest(".workspace-switcher-host");
      const anchor =
        contextHost?.parentElement === actions
          ? contextHost
          : context?.parentElement === actions
            ? context
            : control?.parentElement === actions
              ? control
              : null;
      actions.insertBefore(stage, anchor);
''',
)

# Диагностическое изменение CI использовалось только для получения компактного
# отчёта Playwright. В продуктовый PR оно не входит.
run("git", "fetch", "origin", "main:refs/remotes/origin/main")
ci = run("git", "show", "origin/main:.github/workflows/ci.yml")
(ROOT / ".github/workflows/ci.yml").write_text(ci, encoding="utf-8")

print("Точка вставки верхней панели исправлена; временная диагностика CI удалена.")
