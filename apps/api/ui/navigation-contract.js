{
  const primaryDesktopViews = Object.freeze([
    "overview",
    "employees",
    "templates",
    "generation",
    "documents",
    "automations",
    "settings"
  ]);
  const primaryMobileViews = Object.freeze([
    "overview",
    "employees",
    "generation",
    "documents",
    "settings"
  ]);
  const secondaryViews = Object.freeze({
    entities: Object.freeze({
      label: "Объекты и импорт",
      description: "Дополнительные типы записей и массовая загрузка данных",
      icon: "◇"
    }),
    publications: Object.freeze({
      label: "Публикации",
      description: "Научные статьи, авторы, классификации и отчёты",
      icon: "◫"
    }),
    "gost-formatting": Object.freeze({
      label: "Форматирование по ГОСТ",
      description: "Оформление готовых DOCX по выбранному профилю",
      icon: "§"
    }),
    help: Object.freeze({
      label: "Руководство",
      description: "Рабочие сценарии, подсказки и восстановление после ошибок",
      icon: "?"
    })
  });

  globalThis.docomatorNavigationContract = Object.freeze({
    primaryDesktopViews,
    primaryMobileViews,
    secondaryViews
  });

  if (!document.querySelector('link[data-data-extraction-style]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/ui/data-extraction.css";
    link.dataset.dataExtractionStyle = "";
    document.head.append(link);
  }
  void import("/ui/data-extraction.js").catch((error) => {
    console.error("Не удалось загрузить модуль извлечения данных.", error);
  });
}
