for (const button of document.querySelectorAll('[data-view-target="documents"]')) {
  button.addEventListener("click", () => {
    const eyebrow = document.querySelector("#viewEyebrow");
    const title = document.querySelector("#viewTitle");
    const description = document.querySelector("#viewDescription");
    if (eyebrow) eyebrow.textContent = "Ход работы и готовые файлы";
    if (title) title.textContent = "Результаты и операции";
    if (description) {
      description.textContent =
        "Сохраняемые операции выбранного раздела и готовые ручные или автоматические документы.";
    }
  });
}
