function updateSpaceIsolationCopy() {
  if (typeof views !== "undefined" && views?.knowledge) {
    views.knowledge[0] = "Поля пространства";
    views.knowledge[1] = "Типы и поля";
    views.knowledge[2] =
      "Типы сущностей общие для системы, а пользовательские поля относятся только к выбранному пространству.";
  }
  if (typeof dialogs !== "undefined" && dialogs?.property) {
    dialogs.property.description =
      "Создайте параметр только для текущего пространства. В других пространствах он не появится.";
  }
  if (typeof help !== "undefined" && Array.isArray(help?.knowledge)) {
    help.knowledge[0] = [
      "Почему поля не видны в другом пространстве?",
      "Пользовательские поля принадлежат выбранному пространству так же, как люди, группы и шаблоны. В другом пространстве можно создать поле с тем же понятным названием — это будет отдельное поле."
    ];
  }
  if (typeof help !== "undefined" && Array.isArray(help?.employees)) {
    const fieldHelp = help.employees.find(
      (item) => item?.[0] === "Поле появится только у одного человека?"
    );
    if (fieldHelp) {
      fieldHelp[1] =
        "Поле станет доступно всем карточкам текущего пространства, но не появится в других пространствах.";
    }
  }
}

function resetPropertyCachesOnSpaceChange() {
  document.addEventListener("docomator:space-changed", () => {
    if (typeof state !== "undefined" && state?.data) {
      state.data.properties = [];
    }
  });
}

updateSpaceIsolationCopy();
resetPropertyCachesOnSpaceChange();
