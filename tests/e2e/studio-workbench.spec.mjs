import { expect, test } from './fixtures/test.mjs';
import { installОформляторApiMock, E2E_SECOND_SPACE_ID } from './fixtures/docomator-api.mjs';
import { installVisualLayoutApiMock } from './fixtures/visual-layout-api.mjs';
import { ОформляторPage } from './pages/docomator-page.mjs';

async function studio(page, format = 'docx') {
  const scenario = await installОформляторApiMock(page, { secondSpace: true, employeeCount: 2 });
  await installVisualLayoutApiMock(page);
  const app = new ОформляторPage(page);
  await app.open();
  await app.openView('templates');
  await page.locator('#documentIntakeFile').setInputFiles({ name: `Рабочий шаблон.${format}`, mimeType: 'application/octet-stream', buffer: Buffer.from(`controlled-${format}-fixture`) });
  await expect(page.locator('#documentQuarantineButton')).toBeVisible();
  await page.locator('#documentQuarantineButton').click();
  await expect(page.locator('.studio-toolbar')).toBeVisible();
  await expect(page.locator('.structure-element:visible').first()).toBeVisible();
  return { scenario, app };
}
async function assign(page) {
  await page.locator('.structure-element:visible').first().click();
  const text = page.locator('#documentFieldTextRange');
  if (await text.count()) await text.evaluate((element) => {
    const start = element.value.indexOf('______');
    element.focus(); element.setSelectionRange(start, start + 6);
    element.dispatchEvent(new Event('select', { bubbles: true }));
  });
  await page.locator('#documentFieldSave').click();
  await expect(page.locator('#studioFieldCount')).toHaveText('1');
  await expect(page.locator('#documentTemplateSave')).toBeEnabled();
}
async function editAssigned(page) {
  await page.locator('[data-studio-fields]').click();
  await page.locator('[data-studio-field]').first().click();
  await expect(page.locator('#studioEditForm')).toBeVisible();
}
async function noOverflow(page) {
  const layout = await page.evaluate(() => ({
    viewport: innerWidth, width: document.documentElement.scrollWidth,
    outside: [...document.querySelectorAll('body *')].filter((item) => item.checkVisibility())
      .map((item) => ({ name: item.id || item.className || item.tagName,
        left: item.getBoundingClientRect().left, right: item.getBoundingClientRect().right,
        text: item.textContent?.trim().slice(0, 55) }))
      .filter((item) => item.left < -1 || item.right > innerWidth + 1).slice(0, 20)
  }));
  expect(layout.width, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport + 1);
}

for (const format of ['docx', 'xlsx']) test(`${format}: инструменты рядом, сохранение и точный переход к выпуску`, async ({ page }) => {
  const { scenario } = await studio(page, format);
  await expect(page.locator('#documentStructureSelection')).toBeHidden();
  await expect(page.locator('#documentTemplateSave')).toBeDisabled();
  await assign(page);
  await expect(page.locator('.studio-binding-label:visible').first()).toContainText('Поле:');
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath("studio.png"), fullPage: true });
  await page.locator('[data-studio-zoom]').selectOption('150');
  await noOverflow(page);
  await page.locator('[data-studio-zoom]').selectOption('fit');
  await page.locator('#documentTemplateSave').click();
  await expect(page.locator('#configuredTemplateSaveStatus')).toContainText('Шаблон сохранён');
  const saved = scenario.primary.activeTemplates[0];
  scenario.primary.activeTemplates.unshift({ ...saved, id: 'another-active-template', title: 'Другой шаблон' });
  await page.locator('[data-studio-handoff]').click();
  await expect(page.locator('#generationTemplate')).toHaveValue(saved.id);
});

test('редактирование обязательности сохраняет формат ФИО и не создаёт новое поле', async ({ page }) => {
  const { scenario } = await studio(page);
  await assign(page);
  const original = structuredClone(scenario.primary.drafts[0].fields[0]);
  await editAssigned(page);
  await page.locator('#studioEditRequired').check();
  await page.locator('#studioEditForm').getByRole('button', { name: 'Сохранить назначение' }).click();
  await expect(page.locator('#studioEditStatus')).toContainText('Назначение сохранено');
  expect(scenario.primary.drafts[0].fields).toHaveLength(1);
  expect(scenario.primary.drafts[0].fields[0].formatter).toEqual(original.formatter);
  expect(scenario.primary.drafts[0].fields[0].required).toBe(true);
  expect(scenario.fieldRequests).toHaveLength(1);
  await noOverflow(page);
});

test('снятие назначения сохраняет исходный документ и позволяет назначить поле заново', async ({ page }) => {
  const { scenario } = await studio(page);
  await assign(page);
  const source = structuredClone(scenario.primary.documentSources[0]);
  await editAssigned(page);
  await page.locator('[data-studio-remove]').click();
  await expect(page.locator('#studioFieldCount')).toHaveText('0');
  await expect(page.locator('#documentTemplateSave')).toBeDisabled();
  expect(scenario.primary.documentSources[0]).toEqual(source);
  await assign(page);
  expect(scenario.primary.drafts[0].fields).toHaveLength(1);
});

test('ошибка изменения сохраняет выбор и допускает повтор без повторной разметки', async ({ page }) => {
  await studio(page);
  await assign(page);
  await editAssigned(page);
  await page.locator('#studioEditRequired').check();
  let failed = false;
  await page.route('**/template-drafts/*/fields/*', async (route) => {
    if (!failed && route.request().method() === 'PUT') {
      failed = true;
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Сервер временно занят' }, correlationId: 'studio-retry' }) });
    }
    return route.fallback();
  });
  await page.locator('#studioEditForm').getByRole('button', { name: 'Сохранить назначение' }).click();
  await expect(page.locator('#studioEditStatus')).toContainText('studio-retry');
  await expect(page.locator('#studioEditRequired')).toBeChecked();
  await page.locator('#studioEditForm').getByRole('button', { name: 'Сохранить назначение' }).click();
  await expect(page.locator('#studioEditStatus')).toContainText('Назначение сохранено');
});

test('отложенное чтение прежнего пространства не запускает изменение в новом', async ({ page }) => {
  const { scenario } = await studio(page);
  await assign(page);
  await editAssigned(page);
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let started = false;
  await page.route('**/template-drafts/*', async (route) => {
    if (route.request().method() === 'GET' && /\/template-drafts\/[^/]+$/.test(new URL(route.request().url()).pathname)) { started = true; await pending; }
    await route.fallback();
  });
  try {
    await page.locator('#studioEditForm').getByRole('button', { name: 'Сохранить назначение' }).click();
    await expect.poll(() => started).toBe(true);
    await page.locator('#currentSpaceChip').click();
    await page.locator(`[data-workspace-switcher-space="${E2E_SECOND_SPACE_ID}"]`).click();
    await expect(page.locator('#currentSpaceChipText')).toHaveText('Отдел эксплуатации');
    release();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(scenario.fieldUpdateRequests).toHaveLength(0);
    await expect(page.locator('#studioEditForm')).toHaveCount(0);
  } finally { release(); }
});

test('клавиатура, закрытие инспектора, темы и 200% не создают переполнение', async ({ page }) => {
  await studio(page);
  const target = page.locator('.structure-element:visible').first();
  await target.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#documentStructureSelection')).toBeVisible();
  await page.getByRole('button', { name: 'Закрыть назначение поля' }).click();
  await expect(target).toBeFocused();
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
    await noOverflow(page);
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { frameTree } = await cdp.send('Page.getFrameTree');
  const { styleSheetId } = await cdp.send('CSS.createStyleSheet', { frameId: frameTree.frame.id });
  await cdp.send('CSS.setStyleSheetText', { styleSheetId, text: 'html { font-size: 200% !important; }' });
  await noOverflow(page);
});


test('быстрый новый щелчок после выделения не подавляется таймером', async ({ page }) => {
  await studio(page);
  const result = await page.locator('.template-visual-target[data-visual-docx]').first().evaluate((target) => {
    const content = target.querySelector('.template-visual-text');
    const node = document.createTreeWalker(content, NodeFilter.SHOW_TEXT).nextNode();
    const start = node.textContent.indexOf('______');
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, start + 6);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    const before = document.querySelector('#documentFieldTextRange').selectionEnd - document.querySelector('#documentFieldTextRange').selectionStart;
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const after = document.querySelector('#documentFieldTextRange').selectionEnd - document.querySelector('#documentFieldTextRange').selectionStart;
    return { before, after };
  });
  expect(result).toEqual({ before: 6, after: 0 });
});

test('подтверждённое назначение остаётся сохранённым при ошибке обновления списка', async ({ page }) => {
  const { scenario } = await studio(page);
  await assign(page); await editAssigned(page);
  await page.locator('#studioEditRequired').check();
  let written = false;
  await page.route('**/template-drafts/**', async (route) => {
    const request = route.request();
    if (request.method() === 'PUT' && /\/fields\//.test(request.url())) { written = true; return route.fallback(); }
    if (written && request.method() === 'GET' && /\/template-drafts\/[^/]+$/.test(new URL(request.url()).pathname)) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Не удалось обновить список' } }) });
    }
    return route.fallback();
  });
  await page.locator('#studioEditForm').getByRole('button', { name: 'Сохранить назначение' }).click();
  await expect(page.locator('#studioEditStatus')).toContainText('подтверждённое изменение сохранено');
  expect(scenario.primary.drafts[0].fields[0].required).toBe(true);
  await expect(page.locator('#studioEditRequired')).toBeChecked();
  await expect(page.locator('#documentTemplateSave')).toBeEnabled();
});

test('ошибка чтения после подтверждённой записи не меняет мастер другого пространства', async ({ page }) => {
  const { scenario } = await studio(page);
  await assign(page); await editAssigned(page);
  let written = false;
  let pending = false;
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route('**/template-drafts/**', async (route) => {
    const request = route.request();
    if (request.method() === 'PUT' && /\/fields\//.test(request.url())) { written = true; return route.fallback(); }
    if (written && request.method() === 'GET' && /\/template-drafts\/[^/]+$/.test(new URL(request.url()).pathname)) {
      pending = true; await held;
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'Поздняя ошибка прежнего пространства' } }) });
    }
    return route.fallback();
  });
  try {
    await page.locator('#studioEditForm').getByRole('button', { name: 'Сохранить назначение' }).click();
    await expect.poll(() => pending).toBe(true);
    await page.locator('#currentSpaceChip').click();
    await page.locator(`[data-workspace-switcher-space="${E2E_SECOND_SPACE_ID}"]`).click();
    await expect(page.locator('#currentSpaceChipText')).toHaveText('Отдел эксплуатации');
    release();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('[data-template-step="1"]')).toHaveAttribute('data-wizard-state', 'current');
    await expect(page.locator('#studioEditForm')).toHaveCount(0);
    expect(scenario.fieldUpdateRequests).toHaveLength(1);
  } finally { release(); }
});
