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
      "Разделы помогают организовать участников, группы, шаблоны и результаты. Открытая рабочая область позволяет явно переключаться между разделами, но их данные не смешиваются.";
  }
}

const overviewHero = document.querySelector('[data-view="overview"] .hero-copy');
if (overviewHero) {
  const heading = overviewHero.querySelector("h2");
  const description = overviewHero.querySelector("p");
  if (heading) heading.textContent = "Подготовьте данные и создайте документы";
  if (description) {
    description.textContent =
      "Текущий раздел объединяет участников, шаблоны, расписания и готовые документы. При переключении раздела Оформлятор показывает только его данные.";
  }
}

const storedMetric = document
  .querySelector("#sharedDocumentAvailableCount")
  ?.closest(".metric-card")
  ?.querySelector("span:last-child");
if (storedMetric) storedMetric.textContent = "в этом разделе";

const automationNavigation = document.querySelector(
  '[data-view-target="automations"] span:nth-child(2)'
);
if (automationNavigation) automationNavigation.textContent = "Расписания";
