from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(relative_path: str, old: str, new: str) -> None:
    path = ROOT / relative_path
    value = path.read_text(encoding="utf-8")
    count = value.count(old)
    if count != 1:
        raise RuntimeError(
            f"{relative_path}: ожидалось одно вхождение, найдено {count}"
        )
    path.write_text(value.replace(old, new, 1), encoding="utf-8")
    print(f"updated {relative_path}")


replace_once(
    "apps/api/ui/interface-hierarchy.css",
    "  --hint: #6d7480;",
    "  --hint: #606873;",
)
replace_once(
    "apps/api/ui/interface-hierarchy.css",
    "  --success: #167144;",
    "  --success: #12683b;",
)
replace_once(
    "apps/api/ui/interface-hierarchy.css",
    '''.employee-row:hover { background: color-mix(in srgb, var(--accent) 4%, var(--surface-hover)); }
.template-step-rail { box-shadow: none; }''',
    '''.employee-row:hover { background: color-mix(in srgb, var(--accent) 4%, var(--surface-hover)); }
.employee-row-copy small { color: var(--muted); }
.generation-selected-count { color: var(--accent-strong); }
.sidebar .nav-item [data-interface-attention-badge] {
  position: absolute;
  top: 3px;
  right: 3px;
  display: grid;
  min-width: 18px;
  min-height: 18px;
  place-items: center;
  padding: 0 5px;
  color: white;
  font-size: 0.64rem;
  background: var(--danger);
  border: 2px solid var(--background);
  border-radius: 999px;
}
.template-step-rail { box-shadow: none; }''',
)
replace_once(
    "apps/api/ui/interface-hierarchy.css",
    '''  .system-status-control { max-width: 118px; min-height: 38px; padding-inline: 9px; }
  .system-status-control span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mobile-guide-button { display: grid; width: 40px; height: 40px; }''',
    '''  .system-status-control { max-width: 118px; min-width: 44px; min-height: 44px; padding-inline: 9px; }
  .system-status-control span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mobile-guide-button { display: grid; width: 44px; height: 44px; }
  .topbar .icon-button { width: 44px; height: 44px; }
  .topbar .context-chip { min-height: 44px; }''',
)
replace_once(
    "apps/api/ui/interface-hierarchy.css",
    '''  .system-status-control { width: 38px; padding: 0; justify-content: center; }''',
    '''  .system-status-control { width: 44px; padding: 0; justify-content: center; }
  .topbar .context-chip { max-width: 84px; }''',
)

replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '''    const previous = structureReport?.elements?.find(
      (candidate) =>
        candidate.kind === "paragraph" &&
        candidate.part === element.part &&
        candidate.tableLocation?.tableIndex === location.tableIndex &&
        candidate.tableLocation?.rowIndex === location.rowIndex - 1 &&
        candidate.tableLocation?.columnIndex === location.columnIndex
    );
    return String(previous?.text || "").trim();''',
    '''    const candidates = (structureReport?.elements || []).filter(
      (candidate) =>
        candidate.kind === "paragraph" &&
        candidate.part === element.part &&
        candidate.tableLocation?.tableIndex === location.tableIndex &&
        candidate.tableLocation?.rowIndex === location.rowIndex - 1 &&
        candidate.tableLocation?.columnIndex === location.columnIndex
    );
    const previous =
      candidates.find((candidate) => String(candidate.text || "").trim() !== "") ||
      candidates[0];
    return String(previous?.text || "").trim();''',
)

replace_once(
    "tests/e2e/help-center.spec.mjs",
    '''  await expect(page.locator("#helpCenterArticlePane")).toContainText(
    "Один сводный документ"
  );''',
    '''  await expect(page.locator("#helpCenterArticlePane")).toContainText(
    /один сводный документ/ui
  );''',
)

print("browser regressions fixed")
