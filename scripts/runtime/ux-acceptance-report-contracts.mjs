import {
  CANONICAL_UI_STATES,
  CANONICAL_UI_VIEWS,
  canonicalStateTestTitle,
  canonicalViewAxeTitle
} from "./ux-ui-inventory.mjs";

const PROJECTS = Object.freeze([
  "chromium-320",
  "chromium-768",
  "chromium-1440"
]);
const LEGACY_AXE_DIALOG_LABEL = "Добавление сотрудника и поля";
const LEGACY_AXE_DIALOG_TITLE =
  "диалог сотрудника не содержит машинно-выявляемых нарушений WCAG";
const VIEW_AXE_TITLES = new Map(
  CANONICAL_UI_VIEWS.map(({ label }) => [label, canonicalViewAxeTitle(label)])
);
const CRITICAL_STATE_AXE_TITLES = new Map(
  CANONICAL_UI_STATES.filter(({ runner, checks }) =>
    runner === "critical-state" && checks.includes("axe")
  ).map(({ label }) => [label, canonicalStateTestTitle(label)])
);
const BASELINE_AXE_LABELS = Object.freeze([
  "Главная",
  "Сотрудники",
  "Шаблоны",
  "Создать документы",
  "Результаты",
  LEGACY_AXE_DIALOG_LABEL
]);
const ACCEPTED_AXE_LABELS = new Set([
  ...VIEW_AXE_TITLES.keys(),
  LEGACY_AXE_DIALOG_LABEL,
  ...CRITICAL_STATE_AXE_TITLES.keys()
]);
const BASELINE_TEST_TITLES = Object.freeze([
  canonicalViewAxeTitle("Главная"),
  canonicalViewAxeTitle("Сотрудники"),
  canonicalViewAxeTitle("Шаблоны"),
  canonicalViewAxeTitle("Создать документы"),
  canonicalViewAxeTitle("Результаты"),
  LEGACY_AXE_DIALOG_TITLE,
  "импортирует список сотрудников без технических ключей",
  "пользователь добавляет сотрудника и понятное общее поле",
  "inventory охватывает все пользовательские view текущей оболочки",
  "все канонические экраны работают без горизонтального переполнения",
  "видимые элементы управления сохраняют зону не меньше 44 на 44",
  "светлая и тёмная темы применяются из локальной настройки",
  "текст при масштабе 200% не создаёт горизонтальное переполнение",
  "клавиатурный фокус видим и ссылка пропуска переводит к содержимому",
  "режим уменьшения движения отключает длительные переходы",
  "центр восстанавливает операции после перезагрузки и изолирует пространства",
  "ошибка чтения операций сохраняет понятный повтор и идентификатор",
  "полный мастер DOCX: документ → поля → проверка → готово",
  "полный мастер XLSX: документ → поля → проверка → готово",
  "мастер сохраняет ограниченные настройки числового форматтера",
  "мастер сохраняет повторяемую строку DOCX только по явному выбору",
  "мастер XLSX выбирает повторяемый диапазон по понятным местам строки",
  "ошибка сервера сохраняет пробное значение и показывает идентификатор операции",
  "после перезагрузки мастер продолжает с сохранённого исходника без повторного выбора файла",
  "мастер отклоняет черновик, который не принадлежит сохранённому исходнику",
  "активный шаблон переживает перезагрузку и не смешивается при смене раздела",
  "выпуск создаёт N личных карточек и показывает их в результатах",
  "repeat-шаблон выбирает один сводный документ и блокирует персональный режим",
  "сохраняет явные снимки светлой и тёмной темы"
]);
const CRITICAL_STATE_TITLES = Object.freeze(
  CANONICAL_UI_STATES.filter(({ runner }) => runner === "critical-state").map(
    ({ label }) => canonicalStateTestTitle(label)
  )
);
const TEST_TITLES = Object.freeze([
  ...BASELINE_TEST_TITLES,
  ...CRITICAL_STATE_TITLES
]);
const AXE_PROJECTS = new Map([
  ["chromium-320", { theme: "light", width: 320 }],
  ["chromium-1440", { theme: "dark", width: 1440 }]
]);
const WCAG_TAGS = Object.freeze([
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa"
]);
const REPORT_IDS = new Set(["playwright-json-report", "axe-json-report"]);
const RULE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,127}$/u;
const CANONICAL_VIEW_AXE_TITLE_SET = new Set(VIEW_AXE_TITLES.values());

export const UX_E2E_EVIDENCE_CONTRACT_VERSION = 3;

export class UxAutomationReportError extends Error {}

function object(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value, maximum = 2_000) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= maximum
  );
}

function sameSet(actual, expected) {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((item) => actual.includes(item))
  );
}

function validateEvidenceBinding(binding, expected) {
  if (
    !object(binding) ||
    !sameSet(Object.keys(binding), [
      "commitSha",
      "bundleManifestSha256",
      "releaseMetadataSha256",
      "browserVersion"
    ]) ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(binding.commitSha ?? "") ||
    !/^[a-f0-9]{64}$/u.test(binding.bundleManifestSha256 ?? "") ||
    !/^[a-f0-9]{64}$/u.test(binding.releaseMetadataSha256 ?? "") ||
    !text(binding.browserVersion, 200)
  ) {
    throw new UxAutomationReportError(
      "Автоматический отчёт не связан с проверенным выпуском и Chromium."
    );
  }
  if (
    !object(expected) ||
    binding.commitSha !== expected.commitSha ||
    binding.browserVersion !== expected.browserVersion ||
    binding.bundleManifestSha256 !== expected.bundleManifestSha256 ||
    binding.releaseMetadataSha256 !== expected.releaseMetadataSha256
  ) {
    throw new UxAutomationReportError(
      "Автоматический отчёт создан для другого выпуска или Chromium."
    );
  }
  return binding;
}

function utcTimestamp(value) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = new Date(parsed).toISOString();
  return normalized === value && parsed <= Date.now() + 5 * 60_000
    ? normalized
    : null;
}

function allowedSkip(project, title) {
  if (
    project === "chromium-768" &&
    (CANONICAL_VIEW_AXE_TITLE_SET.has(title) || title === LEGACY_AXE_DIALOG_TITLE)
  ) {
    return true;
  }
  return (
    project === "chromium-1440" &&
    title === "текст при масштабе 200% не создаёт горизонтальное переполнение"
  );
}

function expectedRequiredStatus(project, title) {
  if (project === "chromium-768" && TEST_TITLES.slice(0, 6).includes(title)) {
    return "skipped";
  }
  if (
    project === "chromium-1440" &&
    title === "текст при масштабе 200% не создаёт горизонтальное переполнение"
  ) {
    return "skipped";
  }
  return "passed";
}

function validatePlaywrightReport(report, expectedBinding) {
  const projects = Array.isArray(report?.config?.projects)
    ? report.config.projects.map((project) => project?.name)
    : [];
  if (
    !sameSet(projects, PROJECTS) ||
    report?.config?.metadata?.docomatorEvidenceContractVersion !==
      UX_E2E_EVIDENCE_CONTRACT_VERSION
  ) {
    throw new UxAutomationReportError(
      "Playwright-отчёт не соответствует версии обязательной E2E-матрицы."
    );
  }
  const binding = validateEvidenceBinding(
    {
      commitSha: report.config.metadata.docomatorCommitSha,
      bundleManifestSha256:
        report.config.metadata.docomatorBundleManifestSha256,
      releaseMetadataSha256:
        report.config.metadata.docomatorReleaseMetadataSha256,
      browserVersion: report.config.metadata.docomatorBrowserVersion
    },
    expectedBinding
  );
  if (
    !object(report.stats) ||
    !Number.isInteger(report.stats.expected) ||
    !Number.isInteger(report.stats.skipped) ||
    report.stats.unexpected !== 0 ||
    report.stats.flaky !== 0 ||
    !Array.isArray(report.errors) ||
    report.errors.length !== 0
  ) {
    throw new UxAutomationReportError(
      "Playwright-отчёт содержит падения или нестабильные сценарии."
    );
  }

  const executions = [];
  const visitSuites = (suites) => {
    if (!Array.isArray(suites)) return;
    for (const suite of suites) {
      if (!object(suite)) continue;
      if (Array.isArray(suite.specs)) {
        for (const spec of suite.specs) {
          if (!object(spec) || !text(spec.title) || !Array.isArray(spec.tests)) continue;
          for (const execution of spec.tests) {
            const result = Array.isArray(execution?.results)
              ? execution.results.at(-1)
              : undefined;
            executions.push({
              coordinate: `${execution?.projectName}\u0000${spec.title}`,
              project: execution?.projectName,
              title: spec.title,
              status: result?.status,
              errors: result?.errors
            });
          }
        }
      }
      visitSuites(suite.suites);
    }
  };
  visitSuites(report.suites);

  const byCoordinate = new Map(
    executions.map((execution) => [execution.coordinate, execution])
  );
  if (byCoordinate.size !== executions.length) {
    throw new UxAutomationReportError(
      "Playwright-отчёт содержит повторное выполнение одной координаты."
    );
  }
  for (const execution of executions) {
    if (
      !PROJECTS.includes(execution.project) ||
      !text(execution.title) ||
      !["passed", "skipped"].includes(execution.status) ||
      !Array.isArray(execution.errors) ||
      execution.errors.length !== 0 ||
      (execution.status === "skipped" &&
        !allowedSkip(execution.project, execution.title))
    ) {
      throw new UxAutomationReportError(
        `Playwright-координата «${execution.project ?? "?"} / ${execution.title ?? "?"}» имеет недопустимый результат.`
      );
    }
  }

  for (const project of PROJECTS) {
    for (const title of TEST_TITLES) {
      const execution = byCoordinate.get(`${project}\u0000${title}`);
      if (
        execution === undefined ||
        execution.status !== expectedRequiredStatus(project, title)
      ) {
        throw new UxAutomationReportError(
          `Playwright-отчёт не содержит обязательное состояние «${project} / ${title}».`
        );
      }
    }
  }

  const passed = executions.filter(({ status }) => status === "passed").length;
  const skipped = executions.filter(({ status }) => status === "skipped").length;
  if (report.stats.expected !== passed || report.stats.skipped !== skipped) {
    throw new UxAutomationReportError(
      "Сводные счётчики Playwright не совпадают с подробными выполнениями."
    );
  }

  const startedAt = utcTimestamp(report.stats.startTime);
  if (
    startedAt === null ||
    typeof report.stats.duration !== "number" ||
    !Number.isFinite(report.stats.duration) ||
    report.stats.duration < 0
  ) {
    throw new UxAutomationReportError(
      "Playwright-отчёт содержит недопустимое время выполнения."
    );
  }
  const completedMilliseconds = Date.parse(startedAt) + Math.ceil(report.stats.duration);
  const completedAt =
    Number.isFinite(completedMilliseconds) &&
    Math.abs(completedMilliseconds) <= 8_640_000_000_000_000
      ? utcTimestamp(new Date(completedMilliseconds).toISOString())
      : null;
  if (completedAt === null) {
    throw new UxAutomationReportError(
      "Playwright-отчёт содержит недопустимое время завершения."
    );
  }
  return { binding, completedAt, reviewRequirements: [] };
}

export function uxAutomationReviewKey(review) {
  return `${review.project}\u0000${review.label}\u0000${review.ruleId}`;
}

function expectedAxeTitle(label) {
  if (label === LEGACY_AXE_DIALOG_LABEL) return LEGACY_AXE_DIALOG_TITLE;
  return VIEW_AXE_TITLES.get(label) ?? CRITICAL_STATE_AXE_TITLES.get(label) ?? null;
}

function validateAxeReport(report, expectedBinding) {
  if (
    !object(report) ||
    report.version !== 1 ||
    report.kind !== "docomator.axe-report" ||
    report.contractVersion !== UX_E2E_EVIDENCE_CONTRACT_VERSION ||
    report.runStatus !== "passed" ||
    !object(report.summary) ||
    !Array.isArray(report.results)
  ) {
    throw new UxAutomationReportError(
      "Axe-отчёт не подтверждает успешную обязательную матрицу."
    );
  }
  const binding = validateEvidenceBinding(report.binding, expectedBinding);
  const coordinates = report.results.map(
    (record) => `${record?.project}\u0000${record?.label}`
  );
  if (new Set(coordinates).size !== coordinates.length) {
    throw new UxAutomationReportError("Axe-отчёт содержит повторную координату.");
  }
  for (const [project] of AXE_PROJECTS) {
    for (const label of BASELINE_AXE_LABELS) {
      if (!coordinates.includes(`${project}\u0000${label}`)) {
        throw new UxAutomationReportError(
          `Axe-отчёт не содержит обязательную проверку «${project} / ${label}».`
        );
      }
    }
  }

  const reviewRequirements = [];
  let violationCount = 0;
  let incompleteCount = 0;
  for (const record of report.results) {
    const expected = AXE_PROJECTS.get(record.project);
    const title = expectedAxeTitle(record.label);
    if (
      expected === undefined ||
      !ACCEPTED_AXE_LABELS.has(record.label) ||
      title === null ||
      record.version !== 1 ||
      record.kind !== "docomator.axe-result" ||
      record.contractVersion !== UX_E2E_EVIDENCE_CONTRACT_VERSION ||
      record.testStatus !== "passed" ||
      record.title !== title ||
      record.theme !== expected.theme ||
      !object(record.viewport) ||
      record.viewport.width !== expected.width ||
      !Number.isInteger(record.viewport.height) ||
      record.viewport.height < 1 ||
      !Array.isArray(record.wcagTags) ||
      !sameSet(record.wcagTags, WCAG_TAGS) ||
      !object(record.axe) ||
      !Array.isArray(record.axe.violations) ||
      !Array.isArray(record.axe.incomplete) ||
      !Array.isArray(record.axe.passes) ||
      !Array.isArray(record.axe.inapplicable) ||
      record.axe?.toolOptions?.runOnly?.type !== "tag" ||
      !Array.isArray(record.axe.toolOptions.runOnly.values) ||
      !sameSet(record.axe.toolOptions.runOnly.values, WCAG_TAGS)
    ) {
      throw new UxAutomationReportError(
        `Axe-проверка «${text(record?.label) ? record.label : "неизвестная"}» не прошла строгую проверку.`
      );
    }
    violationCount += record.axe.violations.length;
    incompleteCount += record.axe.incomplete.length;
    if (record.axe.violations.length !== 0) {
      throw new UxAutomationReportError(
        `Axe-проверка «${record.label}» содержит нарушение доступности.`
      );
    }
    const ruleIds = record.axe.incomplete.map((finding) => finding?.id);
    if (
      new Set(ruleIds).size !== ruleIds.length ||
      record.axe.incomplete.some(
        (finding) =>
          !object(finding) ||
          !RULE_ID_PATTERN.test(finding.id ?? "") ||
          !Array.isArray(finding.nodes) ||
          finding.nodes.length === 0
      )
    ) {
      throw new UxAutomationReportError(
        `Axe-проверка «${record.label}» содержит неподдерживаемый unresolved-результат.`
      );
    }
    reviewRequirements.push(
      ...ruleIds.map((ruleId) => ({ project: record.project, label: record.label, ruleId }))
    );
  }
  if (
    report.summary.checks !== report.results.length ||
    report.summary.violations !== violationCount ||
    report.summary.incomplete !== incompleteCount
  ) {
    throw new UxAutomationReportError(
      "Сводные счётчики axe не совпадают с подробными результатами."
    );
  }
  const generatedAt = utcTimestamp(report.generatedAt);
  if (generatedAt === null) {
    throw new UxAutomationReportError(
      "Axe-отчёт содержит недопустимое время формирования."
    );
  }
  return {
    binding,
    completedAt: generatedAt,
    reviewRequirements: reviewRequirements.sort((left, right) => {
      const leftKey = uxAutomationReviewKey(left);
      const rightKey = uxAutomationReviewKey(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    })
  };
}

export function validateUxAutomationReport(evidenceId, report, expectedBinding) {
  if (!REPORT_IDS.has(evidenceId)) {
    throw new UxAutomationReportError(
      "Неизвестный вид автоматического UX-свидетельства."
    );
  }
  return evidenceId === "playwright-json-report"
    ? validatePlaywrightReport(report, expectedBinding)
    : validateAxeReport(report, expectedBinding);
}

export const UX_E2E_TEST_TITLES = TEST_TITLES;
export const UX_E2E_PROJECTS = PROJECTS;
