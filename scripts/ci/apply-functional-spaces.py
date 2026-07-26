from __future__ import annotations

from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=ROOT,
        check=check,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )


def write_from_main(path: str) -> None:
    result = run("git", "show", f"origin/main:{path}")
    (ROOT / path).write_text(result.stdout, encoding="utf-8")


def insert_after(path: str, marker: str, addition: str) -> None:
    file = ROOT / path
    text = file.read_text(encoding="utf-8")
    if addition in text:
        return
    if marker not in text:
        raise RuntimeError(f"{path}: не найден ориентир {marker!r}")
    file.write_text(text.replace(marker, marker + addition, 1), encoding="utf-8")


if run("git", "rev-parse", "--is-shallow-repository").stdout.strip() == "true":
    run("git", "fetch", "--unshallow", "origin")
else:
    run("git", "fetch", "origin", "--prune", "--no-tags")
run("git", "fetch", "origin", "main:refs/remotes/origin/main")
run("git", "config", "user.name", "github-actions[bot]")
run(
    "git",
    "config",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com",
)

merge = run("git", "merge", "--no-commit", "--no-ff", "origin/main", check=False)
if merge.returncode not in (0, 1):
    raise RuntimeError(merge.stdout)

conflicts = {
    line.strip()
    for line in run(
        "git", "diff", "--name-only", "--diff-filter=U", check=False
    ).stdout.splitlines()
    if line.strip()
}
allowed_conflicts = {
    "apps/api/src/ui-routes.ts",
    "package.json",
    "scripts/ci/check-ui-bundles.mjs",
}
unexpected = conflicts - allowed_conflicts
if unexpected:
    raise RuntimeError(
        "Неожиданные конфликты при синхронизации с main: "
        + ", ".join(sorted(unexpected))
    )
if conflicts:
    run("git", "checkout", "--theirs", "--", *sorted(conflicts))

# Основой пересекающихся файлов является актуальная main с новым
# представлением строк DOCX. Подключение переключателя пространств
# добавляется поверх неё, не удаляя template-row-flow и UI-иерархию.
for path in (
    "apps/api/src/ui-routes.ts",
    "package.json",
    "scripts/ci/check-ui-bundles.mjs",
):
    write_from_main(path)

insert_after(
    "apps/api/src/ui-routes.ts",
    '      "spaces.css",\n',
    '      "workspace-switcher.css",\n',
)
insert_after(
    "apps/api/src/ui-routes.ts",
    '      "group-management-v2.js",\n',
    '      "workspace-switcher.js",\n',
)
insert_after(
    "package.json",
    "node --check apps/api/ui/app.js && ",
    "node --check apps/api/ui/workspace-switcher.js && ",
)
insert_after(
    "scripts/ci/check-ui-bundles.mjs",
    '    "group-management-v2.js",\n',
    '    "workspace-switcher.js",\n',
)

run("git", "add", "--all")
remaining = run(
    "git", "diff", "--name-only", "--diff-filter=U", check=False
).stdout.strip()
if remaining:
    raise RuntimeError(f"Остались неразрешённые конфликты:\n{remaining}")
run("git", "commit", "-m", "merge repeat row fixes into functional spaces")
print("Актуальная main повторно объединена с функциональными пространствами.")
