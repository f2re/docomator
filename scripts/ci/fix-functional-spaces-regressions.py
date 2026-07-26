from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: ожидалось одно совпадение, найдено {count}\n{old}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '      .replace(/[^\\p{L}\\p{N}]+/gu, " ")\n',
    '      .replace(/[^\\p{L}\\p{N}#№]+/gu, " ")\n',
)

replace_once(
    "apps/api/ui/help-center.js",
    '''  function helpCenterFilteredArticles() {
    const query = helpCenterQuery.trim().toLocaleLowerCase("ru-RU");
    return helpCenterArticles.filter((article) =>
      (helpCenterCategory === "all" || article.category === helpCenterCategory) &&
      (!query || helpCenterPlainText(article).includes(query))
    );
  }
''',
    '''  function helpCenterSearchTerms(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/gu, "е")
      .match(/[\\p{L}\\p{N}]+/gu) || [];
  }

  function helpCenterFilteredArticles() {
    const terms = helpCenterSearchTerms(helpCenterQuery);
    return helpCenterArticles.filter((article) => {
      if (helpCenterCategory !== "all" && article.category !== helpCenterCategory) {
        return false;
      }
      if (terms.length === 0) return true;
      const searchable = helpCenterPlainText(article).replace(/ё/gu, "е");
      return terms.every((term) => searchable.includes(term));
    });
  }
''',
)

replace_once(
    "apps/api/ui/app.js",
    '''selectView(location.hash.slice(1) in views ? location.hash.slice(1) : "overview");
loadData();
''',
    '''const docomatorRequestedInitialView = location.hash.slice(1);
selectView(
  docomatorRequestedInitialView in views
    ? docomatorRequestedInitialView
    : "overview"
);
if (docomatorRequestedInitialView === "help") {
  window.history.replaceState(null, "", "#help");
}
loadData();
''',
)

replace_once(
    "apps/api/ui/template-multi-trial.js",
    '''  if (!spaceId) {
    content.innerHTML = `<div class="multi-trial-state"><span aria-hidden="true">🧑‍🤝‍🧑</span><div><strong>Выберите пространство</strong><p>Черновики и проверенные версии относятся к выбранному пространству.</p></div></div>`;
    return;
  }
''',
    '''  if (!spaceId) {
    content.innerHTML = `<div class="multi-trial-state"><span aria-hidden="true">🧑‍🤝‍🧑</span><div><strong>Выберите пространство</strong><p>Черновики и проверенные версии относятся к выбранному пространству.</p></div></div>`;
    return false;
  }
''',
)
replace_once(
    "apps/api/ui/template-multi-trial.js",
    '''    multiTrialDrafts = Array.isArray(body.data) ? body.data : [];
    renderMultiTrialWorkspace();
  } catch (error) {
''',
    '''    multiTrialDrafts = Array.isArray(body.data) ? body.data : [];
    renderMultiTrialWorkspace();
    return Boolean(document.querySelector("#templateMultiTrialForm"));
  } catch (error) {
''',
)
replace_once(
    "apps/api/ui/template-multi-trial.js",
    '''    content
      .querySelector("#templateMultiTrialRetry")
      ?.addEventListener("click", loadMultiTrialDrafts);
  }
}

async function submitMultiTrial(event) {
''',
    '''    content
      .querySelector("#templateMultiTrialRetry")
      ?.addEventListener("click", loadMultiTrialDrafts);
    return false;
  }
}

async function submitMultiTrial(event) {
''',
)
replace_once(
    "apps/api/ui/template-multi-trial.js",
    '''if (multiTrialView) {
''',
    '''globalThis.docomatorMultiTrial = {
  reload: loadMultiTrialDrafts,
  hasForm: () => Boolean(document.querySelector("#templateMultiTrialForm"))
};

if (multiTrialView) {
''',
)

replace_once(
    "apps/api/ui/template-row-editor-v2.js",
    '''      panel.querySelector("#rowEditorContinueTrial")?.addEventListener("click", () =>
        globalThis.docomatorTemplateWizard?.complete(2, {
          sourceId: latest.sourceRecordId || structureWizardArtifacts().sourceId,
          draftId: draft.id
        })
      );
''',
    '''      panel
        .querySelector("#rowEditorContinueTrial")
        ?.addEventListener("click", async (event) => {
          const continueButton = event.currentTarget;
          continueButton.disabled = true;
          continueButton.textContent = "Готовим общую проверку…";
          const ready = await globalThis.docomatorMultiTrial?.reload?.();
          if (!ready) {
            errorBox.hidden = false;
            errorBox.textContent =
              "Форму общей проверки подготовить не удалось. Повторите действие.";
            continueButton.disabled = false;
            continueButton.textContent = "Перейти к проверке шаблона";
            return;
          }
          globalThis.docomatorTemplateWizard?.complete(2, {
            sourceId: latest.sourceRecordId || structureWizardArtifacts().sourceId,
            draftId: draft.id
          });
        });
''',
)

replace_once(
    "apps/api/ui/workspace-switcher.css",
    '''.workspace-switcher-host {
  position: relative;
  display: inline-flex;
  min-width: 0;
}

.workspace-switcher-button {
  max-width: min(310px, 32vw);
''',
    '''.workspace-switcher-host {
  position: relative;
  display: inline-flex;
  min-width: 0;
  max-width: min(310px, 32vw);
}

.workspace-switcher-button {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
''',
)
replace_once(
    "apps/api/ui/workspace-switcher.css",
    '''.workspace-switcher-button .context-dot {
''',
    '''.workspace-switcher-button #currentSpaceChipText {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-switcher-button .context-dot {
''',
)
replace_once(
    "apps/api/ui/workspace-switcher.css",
    '''@media (max-width: 760px) {
  .workspace-switcher-button {
    max-width: min(235px, 52vw);
  }
''',
    '''@media (max-width: 760px) {
  .workspace-switcher-host {
    max-width: min(112px, 32vw);
  }

  .workspace-switcher-button {
    width: 100%;
    max-width: 100%;
  }
''',
)

replace_once(
    "tests/e2e/help-center.spec.mjs",
    '''import { DocomatorPage } from "./pages/docomator-page.mjs";

test("встроенное руководство открывается, ищет кейсы и ведёт к рабочему разделу", async ({
''',
    '''import { DocomatorPage } from "./pages/docomator-page.mjs";

async function openFullHelpCenter(page, app) {
  const sidebarButton = page.locator("#helpCenterNavButton");
  if (await sidebarButton.isVisible()) {
    await sidebarButton.click();
    return;
  }
  await app.openView("settings");
  await page
    .locator('[data-view="settings"] [data-help-center-open]:visible')
    .first()
    .click();
}

async function openContextHelp(page) {
  await page
    .locator("#helpButton:visible, #mobileHelpButton:visible")
    .first()
    .click();
}

test("встроенное руководство открывается, ищет кейсы и ведёт к рабочему разделу", async ({
''',
)
replace_once(
    "tests/e2e/help-center.spec.mjs",
    '''  await page.locator("#helpCenterNavButton").click();
''',
    '''  await openFullHelpCenter(page, app);
''',
)
replace_once(
    "tests/e2e/help-center.spec.mjs",
    '''  await page.locator("#helpButton").click();
''',
    '''  await openContextHelp(page);
''',
)

print("Регрессии функциональных пространств исправлены.")
