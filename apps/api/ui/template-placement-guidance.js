{
  const placementBaseTextRangeControl = structureTextRangeControl;
  structureTextRangeControl = function structureTextRangeControlWithGuidance(element) {
    if (element.kind !== "paragraph" || element.text) {
      return placementBaseTextRangeControl(element);
    }
    const inTable = Boolean(element.tableLocation);
    return `
      <div class="structure-placement-card is-ready placement-guidance-card">
        <input id="documentFieldParagraphMode" type="hidden" value="whole" />
        <span class="placement-guidance-target" aria-hidden="true">${inTable ? "□" : "¶"}</span>
        <div>
          <strong>${inTable ? "Выбрана пустая ячейка таблицы" : "Выбран пустой абзац"}</strong>
          <p>${inTable ? "После сохранения значение выбранного поля будет записано именно в эту ячейку." : "После сохранения весь этот пустой абзац станет местом для значения поля."}</p>
          <small><b>Что делать:</b> выберите поле справа, при необходимости задайте формат ФИО и нажмите «Связать с документом». Выделять текст здесь не требуется, потому что место уже пустое.</small>
        </div>
      </div>`;
  };

  const placementBaseReadyMessage = structureFieldReadyMessage;
  structureFieldReadyMessage = function structureFieldReadyMessageWithGuidance(form) {
    if (selectedStructureElement?.kind === "paragraph" && !selectedStructureElement.text) {
      const definition = structureSelectedDefinition(
        form.querySelector("#documentFieldProperty")?.value || ""
      );
      const fieldLabel =
        definition?.label ||
        form.querySelector("#documentFieldLabel")?.value?.trim() ||
        "выбранное поле";
      return selectedStructureElement.tableLocation
        ? `Готово: значение «${fieldLabel}» будет записано в выбранную пустую ячейку. Нажмите «Связать с документом».`
        : `Готово: пустой абзац станет местом для значения «${fieldLabel}». Нажмите «Связать с документом».`;
    }
    return placementBaseReadyMessage(form);
  };
}
