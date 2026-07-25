from __future__ import annotations

from pathlib import Path

ROOT = Path.cwd()


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")
    print(f"updated {path}")


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return content.replace(old, new, 1)


# 1. Storage: generation contract and consistent terminal failures.
path = "packages/storage/src/document-generation.ts"
content = read(path)
content = replace_once(
    content,
    'const DOCUMENT_GENERATION_MAX_ATTEMPTS = 5;\n',
    'const DOCUMENT_GENERATION_MAX_ATTEMPTS = 5;\n\n'
    'export const DOCUMENT_GENERATION_CONTRACT_VERSION = 2;\n',
    "generation contract constant",
)
old_fail_job = '''  failJob(
    jobIdValue: string,
    errorValue: JsonValue,
    contextInput: MutationContext
  ): DocumentGenerationJobRecord {
    const jobId = requiredText(jobIdValue, "jobId", 160);
    const error = toJsonValue(errorValue);
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const current = jobRow(connection, jobId);
      if (current === undefined) {
        throw new DocumentGenerationNotFoundError(
          `Document generation job was not found: ${jobId}`
        );
      }
      connection
        .prepare(`
          UPDATE document_generation_jobs
          SET state = 'failed', error_json = ?, completed_at = ?, updated_at = ?
          WHERE id = ? AND state NOT IN ('completed', 'partial')
        `)
        .run(stringifyJson(error), context.now, context.now, jobId);
      const row = jobRow(connection, jobId);
      if (row === undefined) throw new Error(`Failed job was not found: ${jobId}`);
      return mapJob(connection, row);
    });
  }'''
new_fail_job = '''  failJob(
    jobIdValue: string,
    errorValue: JsonValue,
    contextInput: MutationContext
  ): DocumentGenerationJobRecord {
    const jobId = requiredText(jobIdValue, "jobId", 160);
    const error = toJsonValue(errorValue);
    const errorJson = stringifyJson(error);
    const context = contextValue(contextInput);
    return this.store.transaction((connection) => {
      const current = jobRow(connection, jobId);
      if (current === undefined) {
        throw new DocumentGenerationNotFoundError(
          `Document generation job was not found: ${jobId}`
        );
      }
      if (current.state === "completed" || current.state === "partial") {
        return mapJob(connection, current);
      }

      connection
        .prepare(`
          UPDATE document_generation_units
          SET state = 'failed',
              error_json = COALESCE(error_json, ?),
              completed_at = COALESCE(completed_at, ?),
              updated_at = ?
          WHERE job_id = ? AND state IN ('pending', 'running')
        `)
        .run(errorJson, context.now, context.now, jobId);

      const counts = connection
        .prepare(`
          SELECT
            SUM(CASE WHEN state = 'completed' THEN 1 ELSE 0 END) AS generated,
            SUM(CASE WHEN state = 'failed' THEN 1 ELSE 0 END) AS failed
          FROM document_generation_units
          WHERE job_id = ?
        `)
        .get(jobId) as { generated: number | null; failed: number | null };
      const generated = Number(counts.generated ?? 0);
      const failed = Number(counts.failed ?? 0);
      const state: DocumentGenerationState = generated > 0 ? "partial" : "failed";

      connection
        .prepare(`
          UPDATE document_generation_jobs
          SET state = ?, generated_count = ?, failed_count = ?,
              error_json = ?, completed_at = ?, updated_at = ?
          WHERE id = ? AND state NOT IN ('completed', 'partial')
        `)
        .run(
          state,
          generated,
          failed,
          errorJson,
          context.now,
          context.now,
          jobId
        );

      this.outbox.append(
        {
          eventType: "document.generation.finished",
          schemaVersion: 1,
          source: "document-generation-registry",
          occurredAt: context.now,
          payload: {
            id: jobId,
            state,
            generatedCount: generated,
            failedCount: failed,
            archiveSha256: null,
            error
          },
          dedupeKey: `document.generation.finished:${jobId}:${state}`,
          now: context.now
        },
        connection
      );

      const row = jobRow(connection, jobId);
      if (row === undefined) throw new Error(`Failed job was not found: ${jobId}`);
      return mapJob(connection, row);
    });
  }'''
content = replace_once(content, old_fail_job, new_fail_job, "failJob implementation")
write(path, content)

# 2. Worker: preserve useful errors and isolate one employee failure.
path = "apps/worker/src/document-generation-handler.ts"
content = read(path)
content = replace_once(
    content,
    '''  renderScalarValues,
  parseDocxRepeatRowContract,''',
    '''  renderScalarValues,
  parseDocxRepeatRowContract,
  TemplateCompilerError,''',
    "worker TemplateCompilerError import",
)
content = replace_once(
    content,
    '''function errorPayload(message: string, code = "document_generation_failed"): JsonValue {
  return { code, message };
}
''',
    '''function errorPayload(message: string, code = "document_generation_failed"): JsonValue {
  return { code, message };
}

function generationFailure(error: unknown): { code: string; message: string } {
  if (error instanceof TemplateCompilerError) {
    return { code: error.code, message: error.userMessage };
  }
  return {
    code: "document_generation_failed",
    message: error instanceof Error ? error.message : String(error)
  };
}
''',
    "worker failure classifier",
)
content = replace_once(
    content,
    '''          if (unit.state === "completed") continue;
          options.registry.startUnit(unit.id, context);
          const member =''',
    '''          if (unit.state === "completed") continue;
          try {
            options.registry.startUnit(unit.id, context);
            const member =''',
    "individual unit try start",
)
content = replace_once(
    content,
    '''          await options.registry.completeUnit(
            unit.id,
            rendered.output,
            outputName,
            work.template.format,
            context
          );
        }
      }

      const refreshed''',
    '''            await options.registry.completeUnit(
              unit.id,
              rendered.output,
              outputName,
              work.template.format,
              context
            );
          } catch (error) {
            if (error instanceof DocumentGenerationInterruptedError) {
              throw error;
            }
            const failure = generationFailure(error);
            options.registry.failUnit(
              unit.id,
              errorPayload(failure.message, failure.code),
              context
            );
          }
        }
      }

      const refreshed''',
    "individual unit try end",
)
content = replace_once(
    content,
    '''      const message = error instanceof Error ? error.message : String(error);
      try {
        options.registry.failJob(jobId, errorPayload(message), context);
      } catch {
        // The original error is more useful to the worker queue.
      }
      throw new PermanentJobError(message);''',
    '''      const failure = generationFailure(error);
      try {
        options.registry.failJob(
          jobId,
          errorPayload(failure.message, failure.code),
          context
        );
      } catch {
        // The original error is more useful to the worker queue.
      }
      throw new PermanentJobError(failure.message);''',
    "outer generation failure",
)
write(path, content)

# 3. Worker heartbeat advertises the rendering contract.
path = "apps/worker/src/main.ts"
content = read(path)
content = replace_once(
    content,
    '''  DocumentGenerationRegistry,
  DocumentPreflightRegistry,''',
    '''  DocumentGenerationRegistry,
  DOCUMENT_GENERATION_CONTRACT_VERSION,
  DocumentPreflightRegistry,''',
    "worker contract import",
)
content = replace_once(
    content,
    '''        previewEnabled: config.previewEnabled,
        ...extra''',
    '''        previewEnabled: config.previewEnabled,
        documentGenerationContractVersion: DOCUMENT_GENERATION_CONTRACT_VERSION,
        documentGenerationCapabilities: [
          "scalar-docx",
          "scalar-xlsx",
          "person-name-ru",
          "repeat-docx",
          "repeat-xlsx"
        ],
        ...extra''',
    "worker heartbeat contract",
)
write(path, content)

# 4. API blocks a known stale/incompatible worker before creating a doomed job.
path = "apps/api/src/document-generation-routes.ts"
content = read(path)
content = replace_once(
    content,
    '''  ContentAddressedObjectStore,
  DocumentGenerationConflictError,
  DocumentGenerationRegistry,''',
    '''  ContentAddressedObjectStore,
  DOCUMENT_GENERATION_CONTRACT_VERSION,
  DocumentGenerationConflictError,
  DocumentGenerationRegistry,
  RuntimeStatusRegistry,''',
    "generation route imports",
)
content = replace_once(
    content,
    '''function officeMediaType(format: "docx" | "xlsx"): string {
  return format === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}
''',
    '''function officeMediaType(format: "docx" | "xlsx"): string {
  return format === "docx"
    ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function generationWorkerProblem(runtime: RuntimeStatusRegistry): string | null {
  const latest = runtime.latest("worker");
  if (latest === null) return null;
  const details = (
    typeof latest.details === "object" &&
    latest.details !== null &&
    !Array.isArray(latest.details)
      ? latest.details
      : {}
  ) as Record<string, unknown>;
  const heartbeatInterval =
    typeof details.heartbeatIntervalMs === "number"
      ? details.heartbeatIntervalMs
      : 30_000;
  const ageMs = Date.now() - Date.parse(latest.updatedAt);
  if (
    latest.state !== "running" ||
    !Number.isFinite(ageMs) ||
    ageMs > Math.max(120_000, heartbeatInterval * 3)
  ) {
    return "Фоновый обработчик документов остановлен или давно не обновлял состояние. Перезапустите службу docomator-worker и повторите запуск.";
  }
  const contractVersion =
    typeof details.documentGenerationContractVersion === "number"
      ? details.documentGenerationContractVersion
      : null;
  if (contractVersion !== DOCUMENT_GENERATION_CONTRACT_VERSION) {
    return "API и фоновый обработчик запущены из разных версий Docomator. Обновите сборку и перезапустите docomator-api вместе с docomator-worker.";
  }
  return null;
}
''',
    "worker compatibility helper",
)
content = replace_once(
    content,
    '''  const resultRegistry = documentResultRegistryFromGenerationRegistry(registry);
  registerDocumentResultRoutes(''',
    '''  const resultRegistry = documentResultRegistryFromGenerationRegistry(registry);
  const runtimeStatus = runtimeStatusRegistryFromGenerationRegistry(registry);
  registerDocumentResultRoutes(''',
    "runtime registry",
)
content = replace_once(
    content,
    '''    runtimeStatusRegistryFromGenerationRegistry(registry)
  );''',
    '''    runtimeStatus
  );''',
    "reuse runtime registry",
)
content = replace_once(
    content,
    '''    async (request, reply) => {
      const result = registry.createJob(''',
    '''    async (request, reply) => {
      const workerProblem = generationWorkerProblem(runtimeStatus);
      if (workerProblem !== null) {
        throw new DocumentGenerationConflictError(workerProblem);
      }
      const result = registry.createJob(''',
    "generation worker gate",
)
write(path, content)

# 5. Operations readiness reports incompatible worker versions explicitly.
path = "apps/api/src/operations-readiness-routes.ts"
content = read(path)
content = replace_once(
    content,
    '''  ContentAddressedObjectStore,
  RuntimeStatusRegistry,''',
    '''  ContentAddressedObjectStore,
  DOCUMENT_GENERATION_CONTRACT_VERSION,
  RuntimeStatusRegistry,''',
    "readiness contract import",
)
content = replace_once(
    content,
    '''  const ageMs = Date.now() - Date.parse(latest.updatedAt);
  const fresh =
    latest.state === "running" &&
    Number.isFinite(ageMs) &&
    ageMs <= maximumAgeMs;
  return check({
    id: "worker",
    title: "Фоновый обработчик",
    state: fresh ? "ok" : "error",
    required: true,
    summary: fresh
      ? "Worker работает и регулярно обновляет состояние"
      : "Состояние worker просрочено или служба остановлена",
    detail: `Экземпляр: ${latest.instanceId}; последнее обновление: ${latest.updatedAt}.`,
    remediation: fresh
      ? null
      : "Проверьте systemctl status docomator-worker и последние записи journalctl -u docomator-worker.",
    data: {
      instanceId: latest.instanceId,
      version: latest.version,
      runtimeState: latest.state,
      updatedAt: latest.updatedAt,
      ageMs,
      maximumAgeMs,
      details: latest.details
    }
  });''',
    '''  const ageMs = Date.now() - Date.parse(latest.updatedAt);
  const runtimeFresh =
    latest.state === "running" &&
    Number.isFinite(ageMs) &&
    ageMs <= maximumAgeMs;
  const contractVersion =
    typeof details.documentGenerationContractVersion === "number"
      ? details.documentGenerationContractVersion
      : null;
  const contractCompatible =
    contractVersion === DOCUMENT_GENERATION_CONTRACT_VERSION;
  const fresh = runtimeFresh && contractCompatible;
  return check({
    id: "worker",
    title: "Фоновый обработчик",
    state: fresh ? "ok" : "error",
    required: true,
    summary: fresh
      ? "Worker работает и поддерживает текущий формат документов"
      : runtimeFresh
        ? "API и worker запущены из разных версий"
        : "Состояние worker просрочено или служба остановлена",
    detail: `Экземпляр: ${latest.instanceId}; последнее обновление: ${latest.updatedAt}; контракт формирования: ${contractVersion ?? "не указан"}/${DOCUMENT_GENERATION_CONTRACT_VERSION}.`,
    remediation: fresh
      ? null
      : runtimeFresh
        ? "Обновите установленный комплект и одновременно перезапустите docomator-api и docomator-worker."
        : "Проверьте systemctl status docomator-worker и последние записи journalctl -u docomator-worker.",
    data: {
      instanceId: latest.instanceId,
      version: latest.version,
      runtimeState: latest.state,
      updatedAt: latest.updatedAt,
      ageMs,
      maximumAgeMs,
      contractVersion,
      expectedContractVersion: DOCUMENT_GENERATION_CONTRACT_VERSION,
      contractCompatible,
      details: latest.details
    }
  });''',
    "readiness worker check",
)
write(path, content)

# 6. UI shows the actual job-level reason and treats a terminal job as processed.
path = "apps/api/ui/document-generation.js"
content = read(path)
content = replace_once(
    content,
    '''function generationStateEmoji(state) {
  if (state === "completed") return "✅";
  if (state === "partial") return "⚠️";
  if (state === "failed") return "⛔";
  return "⏳";
}
''',
    '''function generationStateEmoji(state) {
  if (state === "completed") return "✅";
  if (state === "partial") return "⚠️";
  if (state === "failed") return "⛔";
  return "⏳";
}

function generationJobError(job) {
  const error = job?.error;
  if (!error || typeof error !== "object" || Array.isArray(error)) return null;
  const message =
    typeof error.message === "string" && error.message.trim()
      ? error.message.trim()
      : "Фоновый обработчик остановил формирование без подробного сообщения.";
  const code =
    typeof error.code === "string" && error.code.trim()
      ? error.code.trim()
      : "document_generation_failed";
  return { message, code };
}
''',
    "generation job error helper",
)
content = replace_once(
    content,
    '''  const progress =
    job.expectedCount > 0
      ? Math.round(((job.generatedCount + job.failedCount) / job.expectedCount) * 100)
      : 0;
  const readyOutputs = job.units.filter(
    (unit) => unit.state === "completed" && unit.outputName
  );
  const failedOutputs = job.units.filter((unit) => unit.state === "failed");
  const finished = ["completed", "partial", "failed"].includes(job.state);''',
    '''  const finished = ["completed", "partial", "failed"].includes(job.state);
  const progress =
    finished
      ? 100
      : job.expectedCount > 0
        ? Math.round(
            ((job.generatedCount + job.failedCount) / job.expectedCount) * 100
          )
        : 0;
  const readyOutputs = job.units.filter(
    (unit) => unit.state === "completed" && unit.outputName
  );
  const failedOutputs = job.units.filter((unit) => unit.state === "failed");
  const jobError = generationJobError(job);''',
    "generation progress and job error",
)
content = replace_once(
    content,
    '''    <div class="generation-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
      <span style="width: ${progress}%"></span>
    </div>
    ${failedOutputs.length > 0 ? `''',
    '''    <div class="generation-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
      <span style="width: ${progress}%"></span>
    </div>
    ${jobError ? `
      <section class="generation-error-list">
        <div>
          <p class="eyebrow">Почему выпуск остановлен</p>
          <h4>${generationEscape(jobError.message)}</h4>
          <p>Исправьте указанную причину и повторите выпуск. Уже созданные файлы, если они есть, сохраняются.</p>
          <details class="intake-technical">
            <summary>Технические сведения</summary>
            <p>Код: <code>${generationEscape(jobError.code)}</code>. Идентификатор операции: <code>${generationEscape(job.correlationId || job.id)}</code>.</p>
          </details>
        </div>
      </section>` : ""}
    ${failedOutputs.length > 0 ? `''',
    "generation error section",
)
write(path, content)

# 7. Retry UI supports historical job-level failures with zero failed counters.
path = "apps/api/ui/document-generation-retry.js"
write(
    path,
    '''let generationRetryBusy = false;

function generationRetryPlan(job) {
  if (!job || !["partial", "failed"].includes(job.state)) return null;
  const failedUnits = Array.isArray(job.units)
    ? job.units.filter((unit) => unit.state === "failed")
    : [];
  if (failedUnits.length > 0) {
    return {
      scope: "failed",
      count: failedUnits.length,
      title: "Можно повторить только проблемные результаты",
      detail: `Будет создано новое задание для ${failedUnits.length} неуспешных строк. Уже готовые документы исходного выпуска останутся без изменений.`,
      button: `Повторить ошибки (${failedUnits.length})`
    };
  }
  if (job.error) {
    const count = Math.max(1, Number(job.expectedCount) || Number(job.memberCount) || 1);
    return {
      scope: "all",
      count,
      title: "Можно повторить весь выпуск",
      detail:
        "Предыдущее задание остановилось до фиксации результатов по сотрудникам. Новый запуск использует тот же сохранённый состав.",
      button: `Повторить выпуск (${count})`
    };
  }
  return null;
}

async function retryFailedGeneration(job, plan) {
  if (generationRetryBusy || generationBusy || !plan) return;
  const holder = document.querySelector("#documentGenerationStatus");
  if (!holder) return;
  generationRetryBusy = true;
  holder.insertAdjacentHTML(
    "afterbegin",
    `<div class="generation-state is-pending" id="generationRetryProgress" role="status"><span aria-hidden="true">⏳</span><div><strong>Создаём повторное задание</strong><p>${plan.scope === "all" ? "Повторяем весь сохранённый выпуск." : "В новый выпуск войдут только проблемные участники."}</p></div></div>`
  );
  try {
    const body = await generationFetchJson(
      `/api/v1/spaces/${encodeURIComponent(job.spaceId)}/document-jobs/${encodeURIComponent(job.id)}/retry-failed`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idempotencyKey: newGenerationKey() })
      }
    );
    const repeated = body.data.job;
    const repeatedScope = body.data.retryScope === "all" ? "Весь выпуск" : "Проблемные результаты";
    holder.innerHTML = `<div class="generation-state is-pending"><span aria-hidden="true">⏳</span><div><strong>Повторное задание создано</strong><p>${repeatedScope}: ${body.data.retriedUnitCount}. Отслеживаем новое задание отдельно от исходного.</p></div></div>`;
    generationAutoOpenJobId = repeated.id;
    await pollGenerationJob(repeated.id);
  } catch (error) {
    document.querySelector("#generationRetryProgress")?.remove();
    holder.insertAdjacentHTML(
      "afterbegin",
      `<div class="generation-state is-error"><span aria-hidden="true">⛔</span><div><strong>Повтор не запущен</strong><p>${generationEscape(error?.message || "Повторите действие.")}</p>${error?.operationId ? `<small>Идентификатор операции: <code>${generationEscape(error.operationId)}</code>.</small>` : ""}</div></div>`
    );
  } finally {
    generationRetryBusy = false;
  }
}

const baseRenderGenerationJobWithRetry = renderGenerationJob;
renderGenerationJob = function renderGenerationJobWithRetry(payload) {
  baseRenderGenerationJobWithRetry(payload);
  const job = payload?.job;
  const holder = document.querySelector("#documentGenerationStatus");
  const plan = generationRetryPlan(job);
  if (!job || !holder || !plan) return;
  const actions = document.createElement("div");
  actions.className = "generation-state is-warning";
  actions.innerHTML = `
    <span aria-hidden="true">↻</span>
    <div>
      <strong>${generationEscape(plan.title)}</strong>
      <p>${generationEscape(plan.detail)}</p>
      <div class="generation-downloads"><button class="primary-button" id="generationRetryFailed" type="button">${generationEscape(plan.button)}</button></div>
    </div>`;
  holder.append(actions);
  actions
    .querySelector("#generationRetryFailed")
    ?.addEventListener("click", () => retryFailedGeneration(job, plan));
};
''',
)

# 8. Retry route supports old job-level failures without failed units.
path = "apps/api/src/document-generation-retry-routes.ts"
content = read(path)
content = replace_once(
    content,
    '''      const failedUnits = original.units.filter((unit) => unit.state === "failed");
      if (failedUnits.length === 0) {
        throw new DocumentGenerationConflictError(
          "Document generation job has no failed outputs to retry"
        );
      }

      const context = mutationContextFromRequest(request);
      let snapshotId = original.snapshotId;
      if (original.targetMode === "one_per_member") {
        const entityIds = failedUnits
          .map((unit) => unit.primaryEntityId)
          .filter((entityId): entityId is string => entityId !== null);
        if (entityIds.length === 0) {
          throw new DocumentGenerationConflictError(
            "Failed document outputs do not reference audience members"
          );
        }
        const retrySnapshot = spaces.createAudienceSnapshot(
          request.params.spaceId,
          {
            source: { kind: "selected", entityIds },
            targetMode: "one_per_member"
          },
          context
        );
        snapshotId = retrySnapshot.snapshot.id;
      }
''',
    '''      const failedUnits = original.units.filter((unit) => unit.state === "failed");
      const retryWholeJob =
        failedUnits.length === 0 &&
        original.error !== null &&
        (original.state === "failed" || original.state === "partial");
      if (failedUnits.length === 0 && !retryWholeJob) {
        throw new DocumentGenerationConflictError(
          "Document generation job has no failed outputs to retry"
        );
      }

      const context = mutationContextFromRequest(request);
      let snapshotId = original.snapshotId;
      if (!retryWholeJob && original.targetMode === "one_per_member") {
        const entityIds = failedUnits
          .map((unit) => unit.primaryEntityId)
          .filter((entityId): entityId is string => entityId !== null);
        if (entityIds.length === 0) {
          throw new DocumentGenerationConflictError(
            "Failed document outputs do not reference audience members"
          );
        }
        const retrySnapshot = spaces.createAudienceSnapshot(
          request.params.spaceId,
          {
            source: { kind: "selected", entityIds },
            targetMode: "one_per_member"
          },
          context
        );
        snapshotId = retrySnapshot.snapshot.id;
      }
''',
    "retry whole job decision",
)
content = replace_once(
    content,
    '''        retriedFromJobId: original.id,
        retriedUnitCount: failedUnits.length,
        statusUrl:''',
    '''        retriedFromJobId: original.id,
        retriedUnitCount: retryWholeJob ? original.expectedCount : failedUnits.length,
        retryScope: retryWholeJob ? "all" : "failed",
        statusUrl:''',
    "retry response scope",
)
write(path, content)

# 9. Worker tests: real individual DOCX path, current formatter, and failure accounting.
path = "apps/worker/src/document-generation-handler.test.ts"
content = read(path)
marker = '\nfunction xlsxRepeatCompiledTemplate(fieldId: string): Buffer {'
scalar_helper = r'''
function scalarCompiledTemplate(fieldId: string): Buffer {
  const fieldIdentifier = `aifield:${fieldId}`;
  const documentXml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:sdt><w:sdtPr><w:tag w:val="${fieldIdentifier}"/><w:id w:val="201"/></w:sdtPr><w:sdtContent><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>ФИО участника</w:t></w:r></w:p></w:sdtContent></w:sdt></w:body></w:document>`;
  return writeOoxmlPackage([
    {
      name: "[Content_Types].xml",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
      )
    },
    {
      name: "_rels/.rels",
      isDirectory: false,
      content: Buffer.from(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
      )
    },
    {
      name: "word/document.xml",
      isDirectory: false,
      content: Buffer.from(documentXml)
    }
  ]);
}
'''
content = replace_once(content, marker, "\n" + scalar_helper.strip() + "\n" + marker, "scalar compiled helper")
content = replace_once(
    content,
    '''  options: { repeat?: boolean; repeatFormat?: "docx" | "xlsx" } = {}''',
    '''  options: {
    repeat?: boolean;
    repeatFormat?: "docx" | "xlsx";
    personName?: boolean;
    invalidFormatter?: boolean;
  } = {}''',
    "fixture options",
)
content = replace_once(
    content,
    '''      valueType: "string",
      required: true,
      elementId:''',
    '''      valueType: "string",
      required: true,
      formatter: options.invalidFormatter
        ? { version: 1, kind: "unsupported" }
        : options.personName
          ? {
              version: 1,
              kind: "person-name.ru",
              sourceOrder: "given-family",
              pattern: "{Фамилия} {И}."
            }
          : { version: 1, kind: "identity" },
      elementId:''',
    "fixture formatter",
)
content = replace_once(
    content,
    '''    : Buffer.from("compiled-template");''',
    '''    : scalarCompiledTemplate(field.id);''',
    "real scalar compiled template",
)
new_tests = r'''
test("one-per-member generation renders the activated personal-name formatter", async () => {
  const setup = await fixture({ personName: true });
  try {
    const personal = setup.spaces.createAudienceSnapshot(
      DEFAULT_SPACE_ID,
      {
        source: { kind: "selected", entityIds: setup.memberIds },
        targetMode: "one_per_member"
      },
      context("corr-personal-snapshot", 19)
    );
    const created = setup.registry.createJob(
      {
        spaceId: DEFAULT_SPACE_ID,
        activeReleaseId: setup.release.id,
        snapshotId: personal.snapshot.id,
        idempotencyKey: "generation-person-name"
      },
      context("corr-personal-generate", 20)
    ).job;
    const currentTime = at(20);
    const result = await processNextJob({
      queue: setup.queue,
      handlers: handlers(setup, "worker-personal", () => currentTime),
      workerId: "worker-personal",
      leaseDurationMs: 60_000,
      retryBaseMs: 100,
      retryMaxMs: 1_000,
      signal: new AbortController().signal,
      now: () => currentTime
    });
    assert.equal(result.status, "completed");
    const job = setup.registry.getJob(DEFAULT_SPACE_ID, created.id);
    assert.equal(job.state, "completed");
    assert.equal(job.generatedCount, 2);
    assert.equal(job.failedCount, 0);
    const outputs: string[] = [];
    for (const unit of job.units) {
      assert.ok(unit.outputSha256);
      const entries = await readOoxmlPackage(
        await setup.objectStore.getBuffer(unit.outputSha256)
      );
      const documentXml = entries.find(
        (entry) => entry.name === "word/document.xml"
      );
      assert.ok(documentXml);
      outputs.push(documentXml.content.toString("utf8"));
    }
    assert.match(outputs[0] ?? "", /Алексеева А\./u);
    assert.match(outputs[1] ?? "", /Борисов Б\./u);
  } finally {
    await setup.cleanup();
  }
});

test("a rendering contract error marks every unfinished unit and explains the job", async () => {
  const setup = await fixture({ invalidFormatter: true });
  try {
    const personal = setup.spaces.createAudienceSnapshot(
      DEFAULT_SPACE_ID,
      {
        source: { kind: "selected", entityIds: setup.memberIds },
        targetMode: "one_per_member"
      },
      context("corr-invalid-snapshot", 19)
    );
    const created = setup.registry.createJob(
      {
        spaceId: DEFAULT_SPACE_ID,
        activeReleaseId: setup.release.id,
        snapshotId: personal.snapshot.id,
        idempotencyKey: "generation-invalid-formatter"
      },
      context("corr-invalid-generate", 20)
    ).job;
    const currentTime = at(20);
    const result = await processNextJob({
      queue: setup.queue,
      handlers: handlers(setup, "worker-invalid", () => currentTime),
      workerId: "worker-invalid",
      leaseDurationMs: 60_000,
      retryBaseMs: 100,
      retryMaxMs: 1_000,
      signal: new AbortController().signal,
      now: () => currentTime
    });
    assert.equal(result.status, "completed");
    const job = setup.registry.getJob(DEFAULT_SPACE_ID, created.id);
    assert.equal(job.state, "failed");
    assert.equal(job.generatedCount, 0);
    assert.equal(job.failedCount, 2);
    assert.equal(job.units.every((unit) => unit.state === "failed"), true);
    assert.match(JSON.stringify(job.units[0]?.error), /invalid_formatter/u);
    assert.match(JSON.stringify(job.error), /не поддерживается/ui);
  } finally {
    await setup.cleanup();
  }
});
'''
content = content.rstrip() + "\n\n" + new_tests.strip() + "\n"
write(path, content)

# 10. Changelog.
path = "docs/CHANGELOG.md"
content = read(path)
heading = "# Журнал изменений Docomator\n"
entry = '''## 2026-07-25 — надёжное формирование и видимые причины ошибок

- Исправлена ситуация, когда выпуск завершался состоянием «Ошибка», но показывал `0` неуспешных файлов и не объяснял причину.
- Ошибка одного сотрудника теперь фиксируется в его строке и не обрывает остальные документы выпуска.
- Для системной ошибки все незавершённые результаты получают согласованное состояние, счётчики и возможность повторного запуска.
- Интерфейс показывает сообщение worker, технический код и идентификатор операции.
- API обнаруживает запущенный worker другой версии до создания заведомо неработающего задания.
- Добавлен регрессионный сценарий индивидуального DOCX с форматированием ФИО.

'''
if entry.strip() not in content:
    content = replace_once(content, heading, heading + "\n" + entry, "changelog heading")
write(path, content)
