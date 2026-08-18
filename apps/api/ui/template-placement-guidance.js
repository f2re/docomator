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

{
  loadVisualLayout = async function loadVisualLayoutWithSafeFallback(
    report,
    operationId,
    requestVersion
  ) {
    const spaceId = globalThis.docomatorTemplateWizard?.spaceId() || "";
    const draftId = structureDraft?.id || structureWizardArtifacts().draftId || "";
    if (!spaceId || !draftId) return;
    try {
      const response = await structureFetchJson(
        `/api/v1/spaces/${encodeURIComponent(spaceId)}/template-drafts/${encodeURIComponent(draftId)}/visual-layout`
      );
      if (requestVersion !== visualLayoutRequestVersion) return;
      const layout = response.data;
      if (
        layout?.sourceSha256 !== report.sourceSha256 ||
        layout?.format !== report.format
      ) {
        throw new Error(
          "Визуальное представление не соответствует сохранённому исходнику."
        );
      }
      if (report.format === "docx") {
        renderVisualDocxStructure(report, layout, operationId);
      } else {
        renderVisualXlsxStructure(report, layout, operationId);
      }
    } catch (error) {
      if (requestVersion !== visualLayoutRequestVersion) return;
      const result = document.querySelector(
        "#documentStructureResult .structure-report"
      );
      if (!result || result.querySelector("[data-visual-fallback-warning]")) return;
      result.insertAdjacentHTML(
        "afterbegin",
        `<div class="structure-warning" data-visual-fallback-warning><span aria-hidden="true">⚠️</span><p><strong>Подробное оформление сейчас не показано.</strong> ${structureEscape(error?.message || "Локальный анализ оформления недоступен.")} Привязки и данные не изменены; используйте показанное безопасное представление и пробную копию.</p></div>`
      );
    }
  };

  renderStructure = function renderStructureWithSafeRichFallback(
    report,
    operationId
  ) {
    if (report?.format !== "docx" && report?.format !== "xlsx") {
      return renderStructureElementList(report, operationId);
    }
    const requestVersion = ++visualLayoutRequestVersion;
    if (report.format === "docx") {
      renderVisualDocxStructure(
        report,
        { warnings: [], docx: null, xlsx: null },
        operationId
      );
    } else {
      renderStructureElementList(report, operationId);
    }
    void loadVisualLayout(report, operationId, requestVersion);
  };
}
