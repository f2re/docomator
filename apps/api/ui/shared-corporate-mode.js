document.querySelectorAll('[data-create="space-access"]').forEach((element) => {
  element.hidden = true;
});

document
  .querySelectorAll('[data-space-tab="access"], [data-space-pane="access"]')
  .forEach((element) => {
    element.hidden = true;
  });

const spacesNavigation = document.querySelector(
  '[data-view-target="spaces"] span:last-child'
);
if (spacesNavigation) spacesNavigation.textContent = "Разделы и участники";

const spacesIntro = document.querySelector(
  '[data-view="spaces"] .section-intro > div'
);
if (spacesIntro) {
  const eyebrow = spacesIntro.querySelector(".eyebrow");
  const heading = spacesIntro.querySelector("h2");
  const description = spacesIntro.querySelector("p:last-child");
  if (eyebrow) eyebrow.textContent = "Организация общих данных";
  if (heading) heading.textContent = "Разделы, участники и группы";
  if (description) {
    description.textContent =
      "Разделы помогают организовать участников, группы и шаблоны. Все пользователи корпоративного сервиса могут работать с любым разделом и общим хранилищем документов.";
  }
}

const overviewHero = document.querySelector('[data-view="overview"] .hero-copy');
if (overviewHero) {
  const heading = overviewHero.querySelector("h2");
  const description = overviewHero.querySelector("p");
  if (heading) heading.textContent = "Организуйте общие данные и готовые документы";
  if (description) {
    description.textContent =
      "Разделы группируют участников, шаблоны и расписания, а все готовые ручные и автоматические документы попадают в единое корпоративное хранилище.";
  }
}

const storedMetric = document
  .querySelector("#sharedDocumentAvailableCount")
  ?.closest(".metric-card")
  ?.querySelector("span:last-child");
if (storedMetric) storedMetric.textContent = "всего хранится";

const automationNavigation = document.querySelector(
  '[data-view-target="automations"] span:nth-child(2)'
);
if (automationNavigation) automationNavigation.textContent = "Расписания";
