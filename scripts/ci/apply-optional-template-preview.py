from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(relative: str, old: str, new: str) -> None:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")
    count = value.count(old)
    if count != 1:
        raise RuntimeError(f"{relative}: expected one occurrence, found {count}")
    path.write_text(value.replace(old, new, 1), encoding="utf-8")
    print(f"updated {relative}")


def insert_before(relative: str, marker: str, addition: str) -> None:
    path = ROOT / relative
    value = path.read_text(encoding="utf-8")
    if addition in value:
        return
    count = value.count(marker)
    if count != 1:
        raise RuntimeError(f"{relative}: expected one marker, found {count}")
    path.write_text(value.replace(marker, addition + marker, 1), encoding="utf-8")
    print(f"updated {relative}")


# Storage: a tested version may be activated directly; PDF remains an optional review artifact.
insert_before(
    "packages/storage/src/template-releases.ts",
    "export interface ActiveTemplateReleaseRecord {",
    '''export interface ActivateTemplateReleaseCandidateInput {
  spaceId: string;
  versionId: string;
  versionKind: TemplateReleaseCandidateKind;
}

'''
)
replace_once(
    "packages/storage/src/template-releases.ts",
    '''  previewSha256: string;
  versionNumber: number;''',
    '''  previewSha256: string;
  previewMode: "pdf" | "skipped";
  versionNumber: number;'''
)
replace_once(
    "packages/storage/src/template-releases.ts",
    '''  preview_sha256: string;
  candidate_id: string;''',
    '''  preview_sha256: string;
  preview_converter_json: string | null;
  candidate_id: string;'''
)
insert_before(
    "packages/storage/src/template-releases.ts",
    "function requiredText(value: string, name: string, maximum = 500): string {",
    '''function previewModeFromConverter(
  converterJson: string | null
): "pdf" | "skipped" {
  if (converterJson === null) return "pdf";
  const converter = parseJson(converterJson);
  return jsonObject(converter) && converter.mode === "skipped"
    ? "skipped"
    : "pdf";
}

'''
)
replace_once(
    "packages/storage/src/template-releases.ts",
    '''function mapRelease(row: ReleaseRow): ActiveTemplateReleaseRecord {
  return {
    id: row.id,
    spaceId: row.space_id,
    draftId: row.draft_id,
    versionId: row.candidate_id,
    versionKind: candidateKind(row.version_kind),
    sourceVersionNumber: Number(row.source_version_number),
    fieldCount: Number(row.field_count),
    previewRequestId: row.preview_request_id,
    compiledFileId: row.compiled_file_id,
    previewFileId: row.preview_file_id,
    compiledSha256: row.compiled_sha256,
    previewSha256: row.preview_sha256,
    versionNumber: Number(row.version_number),
    title: row.title,
    format: formatValue(row.format),
    manifest: parseJson(row.manifest_json),
    activatedBy: row.activated_by,
    correlationId: row.correlation_id,
    activatedAt: row.activated_at
  };
}''',
    '''function mapRelease(row: ReleaseRow): ActiveTemplateReleaseRecord {
  const manifest = parseJson(row.manifest_json);
  const previewMode =
    jsonObject(manifest) && manifest.previewMode === "skipped"
      ? "skipped"
      : "pdf";
  return {
    id: row.id,
    spaceId: row.space_id,
    draftId: row.draft_id,
    versionId: row.candidate_id,
    versionKind: candidateKind(row.version_kind),
    sourceVersionNumber: Number(row.source_version_number),
    fieldCount: Number(row.field_count),
    previewRequestId: row.preview_request_id,
    compiledFileId: row.compiled_file_id,
    previewFileId: row.preview_file_id,
    compiledSha256: row.compiled_sha256,
    previewSha256: row.preview_sha256,
    previewMode,
    versionNumber: Number(row.version_number),
    title: row.title,
    format: formatValue(row.format),
    manifest,
    activatedBy: row.activated_by,
    correlationId: row.correlation_id,
    activatedAt: row.activated_at
  };
}'''
)
insert_before(
    "packages/storage/src/template-releases.ts",
    '''  activateVersion(
    input: ActivateTemplateReleaseInput,''',
    '''  activateVersionWithoutPreview(
    input: ActivateTemplateReleaseCandidateInput,
    contextInput: MutationContext
  ): ActiveTemplateReleaseRecord {
    const spaceId = requiredText(input.spaceId, "spaceId", 160);
    const versionId = requiredText(input.versionId, "versionId", 160);
    const versionKind = candidateKind(input.versionKind);
    const context = contextValue(contextInput);

    const preview = this.store.transaction((connection) => {
      const candidate = connection
        .prepare(`
          SELECT id, space_id, trial_file_id, trial_sha256
          FROM template_release_candidates
          WHERE id = ? AND space_id = ? AND kind = ?
        `)
        .get(versionId, spaceId, versionKind) as
        | {
            id: string;
            space_id: string;
            trial_file_id: string;
            trial_sha256: string;
          }
        | undefined;
      if (candidate === undefined) {
        throw new TemplatePreviewNotFoundError(
          `Template release candidate was not found in this space: ${versionId}`
        );
      }

      const existing = connection
        .prepare(`
          SELECT id, state, request_attempt
          FROM template_release_previews
          WHERE space_id = ? AND candidate_id = ?
        `)
        .get(spaceId, versionId) as
        | { id: string; state: string; request_attempt: number }
        | undefined;
      if (existing?.state === "ready") {
        const row = previewRow(connection, existing.id, spaceId);
        if (row === undefined) throw new Error(`Preview request was not found: ${existing.id}`);
        return mapPreview(row);
      }
      if (existing !== undefined && existing.state !== "failed") {
        throw new TemplatePreviewConflictError(
          "PDF уже создаётся. Дождитесь завершения визуальной проверки, затем сохраните шаблон."
        );
      }

      const requestId = existing?.id ?? randomUUID();
      const attempt = existing === undefined ? 1 : Number(existing.request_attempt) + 1;
      const queued = this.queue.enqueue(
        {
          jobType: "template.preview.skipped",
          payload: toJsonValue({
            previewRequestId: requestId,
            spaceId,
            versionId,
            versionKind,
            attempt
          }),
          priority: 70,
          maxAttempts: 1,
          idempotencyKey: `template.preview.skipped:${spaceId}:${versionId}`,
          now: context.now
        },
        connection
      );
      connection
        .prepare(`
          UPDATE worker_jobs
          SET state = 'completed', attempts = 1, completed_at = ?,
              locked_by = NULL, locked_at = NULL, lease_expires_at = NULL,
              updated_at = ?
          WHERE id = ? AND state = 'pending'
        `)
        .run(context.now, context.now, queued.job.id);

      const converterJson = stringifyJson(
        toJsonValue({ mode: "skipped", reason: "tested-version-confirmed" })
      );
      if (existing === undefined) {
        connection
          .prepare(`
            INSERT INTO template_release_previews(
              id, space_id, candidate_id, worker_job_id, request_attempt,
              state, preview_file_id, preview_sha256, converter_json,
              error_json, requested_by, correlation_id, requested_at,
              completed_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, ?, NULL, ?, ?, ?, ?, ?)
          `)
          .run(
            requestId,
            spaceId,
            versionId,
            queued.job.id,
            attempt,
            candidate.trial_file_id,
            candidate.trial_sha256,
            converterJson,
            context.actorId,
            context.correlationId,
            context.now,
            context.now,
            context.now
          );
      } else {
        connection
          .prepare(`
            UPDATE template_release_previews
            SET worker_job_id = ?, request_attempt = ?, state = 'ready',
                preview_file_id = ?, preview_sha256 = ?, converter_json = ?,
                error_json = NULL, requested_by = ?, correlation_id = ?,
                requested_at = ?, completed_at = ?, updated_at = ?
            WHERE id = ? AND state = 'failed'
          `)
          .run(
            queued.job.id,
            attempt,
            candidate.trial_file_id,
            candidate.trial_sha256,
            converterJson,
            context.actorId,
            context.correlationId,
            context.now,
            context.now,
            context.now,
            requestId
          );
      }

      this.outbox.append(
        {
          eventType: "template.release-preview.skipped",
          schemaVersion: 1,
          source: "template-release-registry",
          occurredAt: context.now,
          payload: { requestId, spaceId, versionId, versionKind },
          dedupeKey: `template.release-preview.skipped:${requestId}:attempt:${attempt}`,
          now: context.now
        },
        connection
      );
      this.audit.record(
        {
          occurredAt: context.now,
          actorType: context.actorType,
          actorId: context.actorId,
          action: "skip_preview",
          objectType: "template_release_candidate",
          objectId: versionId,
          correlationId: context.correlationId,
          details: { requestId, versionKind, attempt }
        },
        connection
      );
      const row = previewRow(connection, requestId, spaceId);
      if (row === undefined) throw new Error(`Created review record was not found: ${requestId}`);
      return mapPreview(row);
    });

    return this.activateVersion(
      { spaceId, previewRequestId: preview.id },
      contextInput
    );
  }

'''
)
replace_once(
    "packages/storage/src/template-releases.ts",
    '''            p.preview_sha256,
            c.id AS candidate_id,''',
    '''            p.preview_sha256,
            p.converter_json AS preview_converter_json,
            c.id AS candidate_id,'''
)
replace_once(
    "packages/storage/src/template-releases.ts",
    '''      const versionKind = candidateKind(source.version_kind);
      const releaseFormat = formatValue(source.format);
      const xlsxMetadata = xlsxMetadataManifest(releaseFormat, fields);
      const manifest = toJsonValue({''',
    '''      const versionKind = candidateKind(source.version_kind);
      const releaseFormat = formatValue(source.format);
      const previewMode = previewModeFromConverter(source.preview_converter_json);
      const xlsxMetadata = xlsxMetadataManifest(releaseFormat, fields);
      const manifest = toJsonValue({'''
)
replace_once(
    "packages/storage/src/template-releases.ts",
    '''        previewSha256: source.preview_sha256,
        compatibilityLevel:''',
    '''        previewSha256: source.preview_sha256,
        previewMode,
        compatibilityLevel:'''
)

# Hide synthetic skipped-preview records from the operations journal.
replace_once(
    "packages/storage/src/operation-center.ts",
    '''            WHERE p.space_id = ?

            UNION ALL''',
    '''            WHERE p.space_id = ?
              AND (
                p.converter_json IS NULL OR
                p.converter_json NOT LIKE '%"mode":"skipped"%'
              )

            UNION ALL'''
)

# API routes for direct activation and optional preview links.
insert_before(
    "apps/api/src/template-preview-activation-routes.ts",
    "export function registerTemplatePreviewActivationRoutes(",
    '''function registerDirectActivationRoute(
  app: FastifyInstance,
  registry: TemplatePreviewActivationRegistry,
  route: string,
  versionKind: TemplateReleaseCandidateKind
): void {
  app.post<{ Params: VersionParams }>(
    route,
    { schema: { params: versionParamsSchema } },
    async (request, reply) => {
      const active = registry.activateVersionWithoutPreview(
        {
          spaceId: request.params.spaceId,
          versionId: request.params.versionId,
          versionKind
        },
        mutationContextFromRequest(request)
      );
      reply.code(201).header("cache-control", "no-store");
      return responseEnvelope(request, {
        active,
        catalogUrl: `/api/v1/spaces/${encodeURIComponent(active.spaceId)}/active-templates`,
        compiledUrl: `/api/v1/spaces/${encodeURIComponent(active.spaceId)}/active-templates/${encodeURIComponent(active.id)}/files/compiled`,
        previewUrl:
          active.previewMode === "pdf"
            ? `/api/v1/spaces/${encodeURIComponent(active.spaceId)}/active-templates/${encodeURIComponent(active.id)}/files/preview`
            : null
      });
    }
  );
}

'''
)
replace_once(
    "apps/api/src/template-preview-activation-routes.ts",
    '''  registerPreviewRequestRoute(
    app,
    registry,
    "/api/v1/spaces/:spaceId/template-multi-test-versions/:versionId/preview",
    "multi"
  );

  app.get<{ Params: PreviewParams }>(''',
    '''  registerPreviewRequestRoute(
    app,
    registry,
    "/api/v1/spaces/:spaceId/template-multi-test-versions/:versionId/preview",
    "multi"
  );
  registerDirectActivationRoute(
    app,
    registry,
    "/api/v1/spaces/:spaceId/template-test-versions/:versionId/activate",
    "single"
  );
  registerDirectActivationRoute(
    app,
    registry,
    "/api/v1/spaces/:spaceId/template-multi-test-versions/:versionId/activate",
    "multi"
  );

  app.get<{ Params: PreviewParams }>('''
)
replace_once(
    "apps/api/src/template-preview-activation-routes.ts",
    '''        previewUrl: `/api/v1/spaces/${encodeURIComponent(active.spaceId)}/active-templates/${encodeURIComponent(active.id)}/files/preview`''',
    '''        previewUrl:
          active.previewMode === "pdf"
            ? `/api/v1/spaces/${encodeURIComponent(active.spaceId)}/active-templates/${encodeURIComponent(active.id)}/files/preview`
            : null'''
)
replace_once(
    "apps/api/src/template-preview-activation-routes.ts",
    '''      const isPreview = request.params.kind === "preview";
      const hash = isPreview ? active.previewSha256 : active.compiledSha256;''',
    '''      const isPreview = request.params.kind === "preview";
      if (isPreview && active.previewMode === "skipped") {
        throw new TemplatePreviewConflictError(
          "Для этой версии PDF не создавался. Шаблон сохранён и готов к работе."
        );
      }
      const hash = isPreview ? active.previewSha256 : active.compiledSha256;'''
)

# UI: direct save is primary; PDF review is optional.
replace_once(
    "apps/api/ui/template-activation.js",
    '''          <p class="eyebrow">Готовность шаблона</p>
          <h2>Просмотрите документ и включите шаблон</h2>
          <p>Система создаст PDF в фоне. После просмотра отдельно подтвердите, что шаблон можно использовать.</p>
        </div>
        <span class="template-file-mark" aria-hidden="true">PDF</span>''',
    '''          <p class="eyebrow">Готовность шаблона</p>
          <h2>Сохраните проверенный шаблон</h2>
          <p>После успешного пробного заполнения шаблон можно использовать сразу. PDF создаётся только по желанию для дополнительной визуальной проверки.</p>
        </div>
        <span class="template-file-mark" aria-hidden="true">✓</span>'''
)
replace_once(
    "apps/api/ui/template-activation.js",
    '''        <p>Операция сохраняется. Можно перейти в другой раздел или закрыть страницу: состояние останется в журнале и будет доступно после возвращения.</p>''',
    '''        <p>Сохранение фиксирует проверенную неизменяемую версию. Необязательное создание PDF выполняется отдельно и сохраняется в журнале операций.</p>'''
)
insert_before(
    "apps/api/ui/template-activation.js",
    "async function activateTemplateVersion(requestId) {",
    '''async function renderActivationSuccess(body) {
  const holder = document.querySelector("#templateActivationStatus");
  if (!holder) return;
  const active = body.data.active;
  holder.innerHTML = `
    <div class="activation-state is-success">
      <span aria-hidden="true">✅</span>
      <div>
        <strong>Версия ${active.versionNumber} сохранена</strong>
        <p>Шаблон «${activationEscape(active.title)}» появился в каталоге выбранного пространства: ${activationEscape(activationVersionKindLabel(active))}.</p>
        <div class="activation-inline-actions">
          ${body.data.previewUrl ? `<a class="secondary-button" href="${activationEscape(body.data.previewUrl)}">Скачать PDF</a>` : ""}
          <a class="primary-button" href="${activationEscape(body.data.compiledUrl)}">Скачать активный шаблон</a>
        </div>
        <small>${active.previewMode === "skipped" ? "PDF не создавался: использована успешно проверенная пробная версия. " : "PDF сохранён вместе с версией. "}Идентификатор операции: <code>${activationEscape(body.correlationId)}</code>.</small>
      </div>
    </div>`;
  globalThis.docomatorTemplateWizard?.complete(4, { activeId: active.id });
  await loadActiveTemplateCatalog();
}

async function activateTemplateVersionDirect() {
  if (activationBusy) return;
  const version = selectedActivationVersion();
  const spaceId = currentActivationSpaceId();
  const holder = document.querySelector("#templateActivationStatus");
  const button = document.querySelector("#templateActivateDirect");
  if (!version || !spaceId || !holder) return;
  clearActivationPolling();
  clearActivationReload();
  activationBusy = true;
  if (button) button.disabled = true;
  const previous = holder.innerHTML;
  holder.innerHTML = `
    <div class="activation-state is-pending" role="status">
      <span aria-hidden="true">⏳</span>
      <div><strong>Сохраняем проверенную версию</strong><p>Фиксируем неизменяемый манифест и добавляем шаблон в рабочий каталог. PDF не создаётся.</p></div>
    </div>`;
  try {
    const collection =
      version.versionKind === "multi"
        ? "template-multi-test-versions"
        : "template-test-versions";
    const body = await activationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(spaceId)}/${collection}/${encodeURIComponent(version.id)}/activate`,
      { method: "POST" }
    );
    await renderActivationSuccess(body);
  } catch (error) {
    holder.innerHTML = `${previous}<div class="activation-state is-error"><span aria-hidden="true">⚠️</span><div><strong>Шаблон не сохранён</strong><p>${activationEscape(error?.message || "Повторите действие.")}</p>${error?.operationId ? `<small>Идентификатор операции: <code>${activationEscape(error.operationId)}</code>.</small>` : ""}</div></div>`;
  } finally {
    activationBusy = false;
    if (button) button.disabled = false;
  }
}

'''
)
replace_once(
    "apps/api/ui/template-activation.js",
    '''    const active = body.data.active;
    holder.innerHTML = `
      <div class="activation-state is-success">
        <span aria-hidden="true">✅</span>
        <div>
          <strong>Версия ${active.versionNumber} активирована</strong>
          <p>Шаблон «${activationEscape(active.title)}» появился в каталоге выбранного пространства: ${activationEscape(activationVersionKindLabel(active))}.</p>
          <div class="activation-inline-actions">
            <a class="secondary-button" href="${activationEscape(body.data.previewUrl)}">Скачать PDF</a>
            <a class="primary-button" href="${activationEscape(body.data.compiledUrl)}">Скачать активный шаблон</a>
          </div>
          <small>Идентификатор операции: <code>${activationEscape(body.correlationId)}</code>.</small>
        </div>
      </div>`;
    globalThis.docomatorTemplateWizard?.complete(4, {
      activeId: active.id
    });
    await loadActiveTemplateCatalog();''',
    '''    await renderActivationSuccess(body);'''
)
replace_once(
    "apps/api/ui/template-activation.js",
    '''        <div class="activation-actions">
          <button class="primary-button" id="templatePreviewSubmit" type="submit">Создать предварительный просмотр</button>
          <p>LibreOffice работает в фоновом задании с отдельным временным профилем.</p>
        </div>''',
    '''        <div class="activation-actions">
          <button class="primary-button" id="templateActivateDirect" type="submit">Сохранить шаблон</button>
          <button class="secondary-button" id="templatePreviewSubmit" type="button">Создать PDF для визуальной проверки</button>
          <p>PDF необязателен. Он нужен только если требуется отдельно проверить расположение элементов глазами.</p>
        </div>'''
)
replace_once(
    "apps/api/ui/template-activation.js",
    '''        <div class="activation-state"><span aria-hidden="true">👁️</span><div><strong>Выберите проверенную версию</strong><p>После создания PDF здесь появится просмотр и кнопка активации.</p></div></div>''',
    '''        <div class="activation-state"><span aria-hidden="true">✓</span><div><strong>Выберите проверенную версию</strong><p>Её можно сохранить сразу. Необязательный PDF создаётся отдельной кнопкой.</p></div></div>'''
)
replace_once(
    "apps/api/ui/template-activation.js",
    '''    content
      .querySelector("#templateActivationForm")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        void requestTemplatePreview();
      });''',
    '''    content
      .querySelector("#templateActivationForm")
      ?.addEventListener("submit", (event) => {
        event.preventDefault();
        void activateTemplateVersionDirect();
      });
    content
      .querySelector("#templatePreviewSubmit")
      ?.addEventListener("click", () => void requestTemplatePreview());'''
)
replace_once(
    "apps/api/ui/template-activation.js",
    '''  const button = document.querySelector("#templatePreviewSubmit");
  if (!draft || !versionSelect || !hint || !button) return;
  versionSelect.disabled = true;
  button.disabled = true;''',
    '''  const previewButton = document.querySelector("#templatePreviewSubmit");
  const directButton = document.querySelector("#templateActivateDirect");
  if (!draft || !versionSelect || !hint || !previewButton || !directButton) return;
  versionSelect.disabled = true;
  previewButton.disabled = true;
  directButton.disabled = true;'''
)
replace_once(
    "apps/api/ui/template-activation.js",
    '''    versionSelect.disabled = false;
    button.disabled = false;''',
    '''    versionSelect.disabled = false;
    previewButton.disabled = false;
    directButton.disabled = false;'''
)
replace_once(
    "apps/api/ui/template-activation.js",
    '''              <a href="/api/v1/spaces/${encodeURIComponent(spaceId)}/active-templates/${encodeURIComponent(template.id)}/files/preview">PDF</a>
              <a href="/api/v1/spaces/${encodeURIComponent(spaceId)}/active-templates/${encodeURIComponent(template.id)}/files/compiled">Шаблон</a>''',
    '''              ${template.previewMode === "pdf" ? `<a href="/api/v1/spaces/${encodeURIComponent(spaceId)}/active-templates/${encodeURIComponent(template.id)}/files/preview">PDF</a>` : '<span class="activation-preview-omitted">PDF не создавался</span>'}
              <a href="/api/v1/spaces/${encodeURIComponent(spaceId)}/active-templates/${encodeURIComponent(template.id)}/files/compiled">Шаблон</a>'''
)

# E2E mock and main flow use direct save; optional PDF endpoints remain covered separately.
replace_once(
    "tests/e2e/fixtures/docomator-api.mjs",
    '''    } else if (/\/template-(?:multi-)?test-versions\/[^/]+\/preview$/.test(path) && method === "POST") {''',
    '''    } else if (/\/template-(?:multi-)?test-versions\/[^/]+\/activate$/.test(path) && method === "POST") {
      const draft = space.drafts[0];
      const active = activeTemplateFixture(
        draft?.format || state.format,
        draft?.title || "Личная карточка сотрудника"
      );
      active.previewMode = "skipped";
      active.manifest = { ...(active.manifest || {}), previewMode: "skipped" };
      space.activeTemplates = [active];
      data = {
        active,
        previewUrl: null,
        compiledUrl: "/api/v1/e2e/compiled"
      };
    } else if (/\/template-(?:multi-)?test-versions\/[^/]+\/preview$/.test(path) && method === "POST") {'''
)
replace_once(
    "tests/e2e/template-and-generation.spec.mjs",
    '''async function previewAndActivate(page) {
  await expect(page.locator("#templatePreviewSubmit")).toBeEnabled({
    timeout: 12_000
  });
  await page.locator("#templatePreviewSubmit").click();
  await expect(page.locator("#templateActivationStatus")).toContainText(
    "Предварительный просмотр готов"
  );
  await page.locator("#templateActivationConfirmed").check();
  await page.locator("#templateActivateButton").click();
  await expect(page.locator("#templateActivationStatus")).toContainText(
    "активирована"
  );
  await expect(page.locator("#activeTemplateCatalog")).toContainText("Активен");
  await expect(page.locator("#activeTemplateCatalog")).toContainText(
    "Личная карточка"
  );
}''',
    '''async function saveTestedTemplate(page) {
  await expect(page.locator("#templateActivateDirect")).toBeEnabled({
    timeout: 12_000
  });
  await expect(page.locator("#templatePreviewSubmit")).toBeVisible();
  await page.locator("#templateActivateDirect").click();
  await expect(page.locator("#templateActivationStatus")).toContainText(
    "сохранена"
  );
  await expect(page.locator("#templateActivationStatus")).toContainText(
    "PDF не создавался"
  );
  await expect(page.locator("#activeTemplateCatalog")).toContainText("Активен");
  await expect(page.locator("#activeTemplateCatalog")).toContainText(
    "Личная карточка"
  );
}'''
)
replace_once(
    "tests/e2e/template-and-generation.spec.mjs",
    '''    await previewAndActivate(page);''',
    '''    await saveTestedTemplate(page);'''
)

# API regression for direct activation without PDF.
insert_before(
    "apps/api/src/template-preview-activation-routes.test.ts",
    '''test("API retries a failed preview and hides requests from another space", async () => {''',
    '''test("API saves a tested template without generating PDF", async () => {
  const setup = await setupApp();
  try {
    const response = await setup.app.inject({
      method: "POST",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/template-test-versions/${setup.tested.id}/activate`,
      headers: {
        "x-actor-id": "editor-1",
        "x-correlation-id": "corr-direct-activate-api"
      }
    });
    assert.equal(response.statusCode, 201, response.body);
    const body = response.json();
    assert.equal(body.data.active.previewMode, "skipped");
    assert.equal(body.data.active.manifest.previewMode, "skipped");
    assert.equal(body.data.previewUrl, null);
    assert.equal(body.data.active.title, "Официальное письмо");

    const compiled = await setup.app.inject({
      method: "GET",
      url: body.data.compiledUrl
    });
    assert.equal(compiled.statusCode, 200, compiled.body);
    assert.equal(compiled.rawPayload.toString(), "compiled-template");

    const preview = await setup.app.inject({
      method: "GET",
      url: `/api/v1/spaces/${DEFAULT_SPACE_ID}/active-templates/${body.data.active.id}/files/preview`
    });
    assert.equal(preview.statusCode, 409, preview.body);
    assert.match(preview.json().error.message, /PDF не создавался/ui);
  } finally {
    await setup.cleanup();
  }
});

'''
)

# Storage regression: direct activation is auditable and does not create a visible preview operation.
replace_once(
    "packages/storage/src/template-releases.test.ts",
    '''import { MultiFieldTestVersionRegistry } from "./multi-field-test-versions.js";''',
    '''import { MultiFieldTestVersionRegistry } from "./multi-field-test-versions.js";
import { OperationCenterRegistry } from "./operation-center.js";'''
)
insert_before(
    "packages/storage/src/template-releases.test.ts",
    '''test("XLSX _AI_META bindings use manifest v5 while legacy bindings stay on v4", async () => {''',
    '''test("tested version activates directly while PDF remains optional", async () => {
  const setup = await setupFixture();
  try {
    const active = setup.releases.activateVersionWithoutPreview(
      {
        spaceId: DEFAULT_SPACE_ID,
        versionId: setup.multi.id,
        versionKind: "multi"
      },
      context("corr-direct-activate", 3)
    );
    assert.equal(active.previewMode, "skipped");
    assert.equal(
      (active.manifest as { previewMode: string }).previewMode,
      "skipped"
    );
    assert.equal(active.compiledSha256, setup.multi.compiledSha256);
    assert.equal(setup.releases.listActiveTemplates(DEFAULT_SPACE_ID).length, 1);

    const previewRow = setup.fixture.store.execute((database) =>
      database
        .prepare(`
          SELECT p.state, p.converter_json, w.state AS worker_state
          FROM template_release_previews p
          JOIN worker_jobs w ON w.id = p.worker_job_id
          WHERE p.id = ?
        `)
        .get(active.previewRequestId)
    ) as { state: string; converter_json: string; worker_state: string };
    assert.equal(previewRow.state, "ready");
    assert.equal(previewRow.worker_state, "completed");
    assert.match(previewRow.converter_json, /"mode":"skipped"/u);

    const operations = new OperationCenterRegistry(setup.fixture.store).list(
      DEFAULT_SPACE_ID
    );
    assert.equal(
      operations.some((operation) => operation.kind === "template_preview"),
      false
    );
  } finally {
    setup.fixture.cleanup();
  }
});

'''
)

# Documentation wording.
replace_once(
    "docs/TEMPLATE_ACTIVATION.md",
    '''После пробного заполнения оператор обязан создать PDF, просмотреть его и только затем активировать версию.''',
    '''После успешного пробного заполнения оператор может сразу сохранить проверенную версию. PDF создаётся отдельно и только тогда, когда нужна дополнительная визуальная проверка расположения элементов.'''
)

print("optional template preview patches applied")
