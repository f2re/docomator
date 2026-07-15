for (const button of document.querySelectorAll('[data-view-target="documents"]')) {
  button.addEventListener("click", () => {
    const eyebrow = document.querySelector("#viewEyebrow");
    const title = document.querySelector("#viewTitle");
    const description = document.querySelector("#viewDescription");
    if (eyebrow) eyebrow.textContent = "Общее корпоративное хранилище";
    if (title) title.textContent = "Документы";
    if (description) {
      description.textContent =
        "Новые ручные и автоматические результаты, доступные всем пользователям системы.";
    }
  });
}
