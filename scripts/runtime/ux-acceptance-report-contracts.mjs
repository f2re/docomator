const PROJECTS = Object.freeze([
  "chromium-320",
  "chromium-768",
  "chromium-1440"
]);
const AXE_LABELS = Object.freeze([
  "Главная",
  "Сотрудники",
  "Шаблоны",
  "Создать документы",
  "Результаты",
  "Добавление сотрудника и поля"
]);
const TEST_TITLES = Object.freeze([
  "экран «Главная» не содержит машинно-выявляемых нарушений WCAG",
  "экран «Сотрудники» не содержит машинно-выявляемых нарушений WCAG",
  "экран «Шаблоны» не содержит машинно-выявляемых нарушений WCAG",
  "экран «Создать документы» не содержит машинно-выявляемых нарушений WCAG",
  "экран «Результаты» не содержит машинно-выявляемых нарушений WCAG",
  "диалог сотрудника не содержит машинно-выявляемых нарушений WCAG",
  "импортирует список сотрудников без технических ключей",
  "пользователь добавляет сотрудника и понятное общее поле",
  "основная навигация работает без горизонтального переполнения",
  "светлая и тёмная темы применяются из локальной настройки",
  "клавиатурный фокус видим и ссылка пропуска переводит к содержимому",
  "режим уменьшения движения отключает длительные переходы",
  "текст при масштабе 200% не создаёт горизонтальное переполнение",
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
const AXE_TITLES = new Map(
  AXE_LABELS.map((label) => [
    label,
    label === "Добавление сотрудника и поля"
      ? TEST_TITLES[5]
      : `экран «${label}» не содержит машинно-выявляемых нарушений WCAG`
  ])
);
const AXE_TITLE_SET = new Set(AXE_TITLES.values());
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

export const UX_E2E_EVIDENCE_CONTRACT_VERSION = 1;

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

function utcTimestamp(value) {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  const normalized = new Date(parsed).toISOString();
  return normalized === value && parsed <= Date.now() + 5 * 60_000
    ? normalized
    : null;
}

function expectedPlaywrightStatus(project, title) {
  if (project === "chromium-768" && AXE_TITLE_SET.has(title)) {
    return "skipped";
  }
  if (project === "chromium-1440" && title === TEST_TITLES[12]) {
    return "skipped";
  }
  return "passed";
}

function expectedPlaywrightExecutions() {
  return PROJECTS.flatMap((project) =>
    TEST_TITLES.map((title) => ({
      coordinate: `${project}\u0000${title}`,
      project,
      title,
      status: expectedPlaywrightStatus(project, title)
    }))
  );
}

function validatePlaywrightReport(report) {
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
          if (!object(spec) || !text(spec.title) || !Array.isArray(spec.tests)) {
            continue;
          }
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
  const expected = expectedPlaywrightExecutions();
  const byCoordinate = new Map(
    executions.map((execution) => [execution.coordinate, execution])
  );
  const expectedCoordinates = expected.map((execution) => execution.coordinate);
  if (
    byCoordinate.size !== executions.length ||
    !sameSet(
      executions.map((execution) => execution.coordinate),
      expectedCoordinates
    ) ||
    expected.some((contract) => {
      const execution = byCoordinate.get(contract.coordinate);
      return (
        execution === undefined ||
        execution.project !== contract.project ||
        execution.title !== contract.title ||
        execution.status !== contract.status ||
        !Array.isArray(execution.errors) ||
        execution.errors.length !== 0
      );
    })
  ) {
    throw new UxAutomationReportError(
      "Playwright-отчёт не содержит точный обязательный inventory из 81 выполнения."
    );
  }
  const passed = expected.filter((execution) => execution.status === "passed").length;
  const skipped = expected.length - passed;
  if (report.stats.expected !== passed || report.stats.skipped !== skipped) {
    throw new UxAutomationReportError(
      "Сводные счётчики Playwright не совпадают с обязательным inventory."
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
  const completedMilliseconds =
    Date.parse(startedAt) + Math.ceil(report.stats.duration);
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
  return {
    completedAt,
    reviewRequirements: []
  };
}

export function uxAutomationReviewKey(review) {
  return `${review.project}\u0000${review.label}\u0000${review.ruleId}`;
}

function validateAxeReport(report) {
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
  const expectedCoordinates = [...AXE_PROJECTS].flatMap(([project]) =>
    AXE_LABELS.map((label) => `${project}\u0000${label}`)
  );
  const coordinates = report.results.map(
    (record) => `${record?.project}\u0000${record?.label}`
  );
  if (!sameSet(coordinates, expectedCoordinates)) {
    throw new UxAutomationReportError(
      "Axe-отчёт не содержит точную матрицу из 12 обязательных проверок."
    );
  }
  const reviewRequirements = [];
  let violationCount = 0;
  let incompleteCount = 0;
  for (const record of report.results) {
    const expected = AXE_PROJECTS.get(record.project);
    if (
      expected === undefined ||
      record.version !== 1 ||
      record.kind !== "docomator.axe-result" ||
      record.contractVersion !== UX_E2E_EVIDENCE_CONTRACT_VERSION ||
      record.testStatus !== "passed" ||
      !text(record.title) ||
      record.title !== AXE_TITLES.get(record.label) ||
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
      ...ruleIds.map((ruleId) => ({
        project: record.project,
        label: record.label,
        ruleId
      }))
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
    completedAt: generatedAt,
    reviewRequirements: reviewRequirements.sort((left, right) => {
      const leftKey = uxAutomationReviewKey(left);
      const rightKey = uxAutomationReviewKey(right);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    })
  };
}

export function validateUxAutomationReport(evidenceId, report) {
  if (!REPORT_IDS.has(evidenceId)) {
    throw new UxAutomationReportError(
      "Неизвестный вид автоматического UX-свидетельства."
    );
  }
  return evidenceId === "playwright-json-report"
    ? validatePlaywrightReport(report)
    : validateAxeReport(report);
}

export const UX_E2E_TEST_TITLES = TEST_TITLES;
export const UX_E2E_PROJECTS = PROJECTS;
