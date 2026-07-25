{
  operatorState.groupMemberIds = new Set();
  operatorState.groupMemberPage = 1;
  operatorState.groupMemberPageSize = 50;
  operatorState.groupMemberFilter = "all";
  operatorState.groupMemberStatus = "active";

  function groupV2Employees() {
    return [...state.data.employees].sort(
      (left, right) =>
        String(left.displayName || "").localeCompare(
          String(right.displayName || ""),
          "ru-RU"
        ) || employeeId(left).localeCompare(employeeId(right), "en")
    );
  }

  function groupV2Query() {
    return (
      document.querySelector("#operatorGroupSearch")?.value
        .trim()
        .toLocaleLowerCase("ru-RU") || ""
    );
  }

  function groupV2FilteredEmployees() {
    const query = groupV2Query();
    return groupV2Employees().filter((employee) => {
      const id = employeeId(employee);
      const selected = operatorState.groupMemberIds.has(id);
      const matchesQuery =
        !query ||
        String(employee.displayName || "")
          .toLocaleLowerCase("ru-RU")
          .includes(query);
      const matchesMembership =
        operatorState.groupMemberFilter === "all" ||
        (operatorState.groupMemberFilter === "selected" && selected) ||
        (operatorState.groupMemberFilter === "unselected" && !selected);
      const matchesStatus =
        operatorState.groupMemberStatus === "all" || employee.status === "active";
      return matchesQuery && matchesMembership && matchesStatus;
    });
  }

  function groupV2UpdateCounts() {
    const selectedCount = operatorState.groupMemberIds.size;
    const filteredCount = groupV2FilteredEmployees().length;
    const total = state.data.employees.length;
    const counter = document.querySelector("#operatorGroupCounter");
    if (counter) {
      counter.innerHTML = `<strong>В группе: ${selectedCount}</strong><span>Найдено: ${filteredCount} · Всего сотрудников: ${total}</span>`;
    }
    const message = document.querySelector("#operatorGroupMessage");
    if (message) {
      message.textContent =
        "Поиск и страницы не снимают уже выбранных людей. Сохраняется весь состав, а не только текущая страница.";
    }
  }

  function groupV2RenderPagination(filtered, pageCount) {
    const page = Math.min(Math.max(1, operatorState.groupMemberPage), pageCount || 1);
    operatorState.groupMemberPage = page;
    return `<div class="operator-group-pagination"><button class="secondary-button compact-button" type="button" data-group-page="previous"${page <= 1 ? " disabled" : ""}>Назад</button><span>Страница ${page} из ${Math.max(1, pageCount)} · показано до ${operatorState.groupMemberPageSize}</span><button class="secondary-button compact-button" type="button" data-group-page="next"${page >= pageCount ? " disabled" : ""}>Далее</button></div>`;
  }

  operatorFilterGroupMembers = function operatorFilterGroupMembersV2() {
    operatorState.groupMemberPage = 1;
    operatorRenderGroupMembers();
  };

  operatorRenderGroupMembers = function operatorRenderGroupMembersV2(selectedIds) {
    if (selectedIds instanceof Set) {
      operatorState.groupMemberIds = new Set(selectedIds);
    }
    const root = document.querySelector("#operatorGroupMembers");
    if (!root) return;
    const filtered = groupV2FilteredEmployees();
    const pageSize = operatorState.groupMemberPageSize;
    const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
    operatorState.groupMemberPage = Math.min(operatorState.groupMemberPage, pageCount);
    const start = (operatorState.groupMemberPage - 1) * pageSize;
    const shown = filtered.slice(start, start + pageSize);
    root.innerHTML = `
      <div class="operator-group-member-list">${shown.length
        ? shown
            .map((employee) => {
              const id = employeeId(employee);
              const selected = operatorState.groupMemberIds.has(id);
              return `<label class="operator-group-member${selected ? " is-selected" : ""}"><input type="checkbox" data-operator-group-member data-status="${escapeHtml(employee.status)}" value="${escapeHtml(id)}"${selected ? " checked" : ""} /><span class="operator-group-member-avatar" aria-hidden="true">${escapeHtml(String(employee.displayName || "С").slice(0, 1).toUpperCase())}</span><span><strong>${escapeHtml(employee.displayName)}</strong><small>${escapeHtml(employeeStatusLabel(employee.status))}</small></span><b aria-hidden="true">✓</b></label>`;
            })
            .join("")
        : '<div class="operator-group-empty"><strong>Сотрудники не найдены</strong><p>Измените поиск или фильтр. Уже выбранный состав не изменён.</p></div>'}</div>
      ${groupV2RenderPagination(filtered, pageCount)}`;
    root.querySelectorAll("[data-operator-group-member]").forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) operatorState.groupMemberIds.add(input.value);
        else operatorState.groupMemberIds.delete(input.value);
        input.closest(".operator-group-member")?.classList.toggle(
          "is-selected",
          input.checked
        );
        if (operatorState.groupMemberFilter !== "all") {
          operatorRenderGroupMembers();
        } else {
          groupV2UpdateCounts();
        }
      });
    });
    root.querySelectorAll("[data-group-page]").forEach((button) => {
      button.addEventListener("click", () => {
        operatorState.groupMemberPage +=
          button.dataset.groupPage === "next" ? 1 : -1;
        operatorRenderGroupMembers();
        root.scrollIntoView({ block: "nearest" });
      });
    });
    groupV2UpdateCounts();
  };

  function groupV2ApplyToFound(action) {
    const found = groupV2FilteredEmployees();
    for (const employee of found) {
      const id = employeeId(employee);
      if (action === "select") operatorState.groupMemberIds.add(id);
      else operatorState.groupMemberIds.delete(id);
    }
    operatorRenderGroupMembers();
  }

  function groupV2FilterGroupList() {
    const query =
      document.querySelector("#operatorGroupListSearch")?.value
        .trim()
        .toLocaleLowerCase("ru-RU") || "";
    const select = document.querySelector("#operatorGroupSelect");
    if (!select) return;
    const current = operatorState.groupEditingId || "";
    select.innerHTML = `<option value="">Новая группа</option>${state.data.groups
      .filter(
        (group) =>
          !query ||
          `${group.name} ${group.description || ""}`
            .toLocaleLowerCase("ru-RU")
            .includes(query)
      )
      .sort(
        (left, right) =>
          Number(left.status === "archived") - Number(right.status === "archived") ||
          left.name.localeCompare(right.name, "ru-RU")
      )
      .map(
        (group) =>
          `<option value="${escapeHtml(group.id)}">${group.status === "archived" ? "Архив · " : ""}${escapeHtml(group.name)} · ${group.memberCount}</option>`
      )
      .join("")}`;
    if ([...select.options].some((option) => option.value === current)) {
      select.value = current;
    }
  }

  operatorRenderGroupSelect = function operatorRenderGroupSelectV2() {
    groupV2FilterGroupList();
  };

  operatorEnsureGroupDialog = function operatorEnsureGroupDialogV2() {
    if (document.querySelector("#operatorGroupDialog")) return;
    const dialog = document.createElement("dialog");
    dialog.id = "operatorGroupDialog";
    dialog.className = "create-dialog operator-group-dialog operator-group-dialog-v2";
    dialog.innerHTML = `<form id="operatorGroupForm" novalidate>
      <header class="dialog-header"><div><p class="eyebrow">Группы сотрудников</p><h2 id="operatorGroupTitle">Новая группа</h2><p>Создавайте и обновляйте большие составы без потери выбранных людей при поиске или переходе между страницами.</p></div><button class="icon-button" id="operatorGroupClose" type="button" aria-label="Закрыть">×</button></header>
      <div class="dialog-body operator-group-dialog-body">
        <section class="operator-group-existing"><label class="field"><span>Найти существующую группу</span><input id="operatorGroupListSearch" type="search" placeholder="Название или описание группы" autocomplete="off" /></label><label class="field"><span>Открыть группу</span><select id="operatorGroupSelect"></select></label><button class="secondary-button" id="operatorGroupNew" type="button">Создать новую</button></section>
        <section class="operator-group-details"><label class="field"><span>Название <i>*</i></span><input id="operatorGroupName" type="text" maxlength="500" required placeholder="Например, Студенты группы М-21" /></label><label class="field"><span>Описание</span><input id="operatorGroupDescription" type="text" maxlength="2000" placeholder="Необязательно" /></label><button class="text-button is-danger" id="operatorGroupArchive" type="button" hidden>Переместить в архив</button></section>
        <section class="operator-group-selection">
          <div class="operator-group-selection-heading"><div><strong>Состав группы</strong><p>Отмечайте людей на любой странице. Выбор сохраняется до нажатия «Сохранить».</p></div><div id="operatorGroupCounter"></div></div>
          <div class="operator-group-member-toolbar">
            <label class="search-field"><span aria-hidden="true">⌕</span><input id="operatorGroupSearch" type="search" placeholder="Найти сотрудника по ФИО" autocomplete="off" /></label>
            <label><span>Показать</span><select id="operatorGroupMembershipFilter"><option value="all">Всех</option><option value="selected">Только в группе</option><option value="unselected">Только не выбранных</option></select></label>
            <label><span>Статус</span><select id="operatorGroupStatusFilter"><option value="active">Только работающих</option><option value="all">Все статусы</option></select></label>
            <label><span>На странице</span><select id="operatorGroupPageSize"><option value="25">25</option><option value="50" selected>50</option><option value="100">100</option></select></label>
          </div>
          <div class="operator-group-bulk-actions"><button class="secondary-button compact-button" id="operatorGroupSelectFound" type="button">Добавить всех найденных</button><button class="secondary-button compact-button" id="operatorGroupRemoveFound" type="button">Убрать всех найденных</button><button class="text-button" id="operatorGroupClear" type="button">Очистить группу</button></div>
          <div id="operatorGroupMembers" class="operator-group-members"></div>
        </section>
        <div class="form-error" id="operatorGroupError" role="alert" hidden></div>
      </div>
      <footer class="dialog-footer"><p class="save-explanation" id="operatorGroupMessage"></p><div><button class="secondary-button" id="operatorGroupCancel" type="button">Отмена</button><button class="primary-button" id="operatorGroupSave" type="submit">Сохранить группу</button></div></footer>
    </form>`;
    document.body.append(dialog);
    const close = () => dialog.close();
    dialog.querySelector("#operatorGroupClose")?.addEventListener("click", close);
    dialog.querySelector("#operatorGroupCancel")?.addEventListener("click", close);
    dialog.querySelector("#operatorGroupNew")?.addEventListener("click", () =>
      void operatorSelectGroup("")
    );
    dialog.querySelector("#operatorGroupSelect")?.addEventListener("change", (event) =>
      void operatorSelectGroup(event.target.value)
    );
    dialog.querySelector("#operatorGroupListSearch")?.addEventListener("input", groupV2FilterGroupList);
    dialog.querySelector("#operatorGroupSearch")?.addEventListener("input", operatorFilterGroupMembers);
    dialog.querySelector("#operatorGroupMembershipFilter")?.addEventListener("change", (event) => {
      operatorState.groupMemberFilter = event.target.value;
      operatorFilterGroupMembers();
    });
    dialog.querySelector("#operatorGroupStatusFilter")?.addEventListener("change", (event) => {
      operatorState.groupMemberStatus = event.target.value;
      operatorFilterGroupMembers();
    });
    dialog.querySelector("#operatorGroupPageSize")?.addEventListener("change", (event) => {
      operatorState.groupMemberPageSize = Number(event.target.value) || 50;
      operatorFilterGroupMembers();
    });
    dialog.querySelector("#operatorGroupSelectFound")?.addEventListener("click", () =>
      groupV2ApplyToFound("select")
    );
    dialog.querySelector("#operatorGroupRemoveFound")?.addEventListener("click", () =>
      groupV2ApplyToFound("remove")
    );
    dialog.querySelector("#operatorGroupClear")?.addEventListener("click", () => {
      operatorState.groupMemberIds.clear();
      operatorRenderGroupMembers();
    });
    dialog.querySelector("#operatorGroupArchive")?.addEventListener("click", async () => {
      const groupId = operatorState.groupEditingId;
      if (!groupId) return;
      if (!confirm("Переместить группу в архив? Она исчезнет из обычного выбора, но история документов сохранится.")) return;
      try {
        await api(spaceEndpoint(`/groups/${encodeURIComponent(groupId)}`), {
          method: "PUT",
          body: JSON.stringify({ status: "archived" })
        });
        dialog.close();
        await loadCurrentSpaceData();
        notify("✓", "Группа перемещена в архив", "История и ранее созданные снимки состава сохранены.");
      } catch (error) {
        const holder = dialog.querySelector("#operatorGroupError");
        holder.hidden = false;
        holder.textContent = error?.message || "Группу не удалось переместить в архив.";
      }
    });
    dialog.querySelector("#operatorGroupForm")?.addEventListener("submit", operatorSaveGroup);
  };

  operatorSelectGroup = async function operatorSelectGroupV2(groupId) {
    operatorState.groupEditingId = groupId || null;
    operatorState.groupMemberIds = new Set();
    operatorState.groupMemberPage = 1;
    const group = state.data.groups.find((candidate) => candidate.id === groupId);
    document.querySelector("#operatorGroupTitle").textContent = groupId
      ? "Изменить группу"
      : "Новая группа";
    document.querySelector("#operatorGroupSave").textContent = groupId
      ? "Сохранить изменения"
      : "Создать группу";
    document.querySelector("#operatorGroupName").value = group?.name || "";
    document.querySelector("#operatorGroupDescription").value = group?.description || "";
    const archive = document.querySelector("#operatorGroupArchive");
    if (archive) {
      archive.hidden = !groupId || group?.status === "archived";
    }
    operatorRenderGroupSelect();
    if (!groupId) {
      operatorRenderGroupMembers(new Set());
      return;
    }
    document.querySelector("#operatorGroupMembers").innerHTML =
      '<div class="employee-inline-loading"><span class="state-mark" aria-hidden="true"></span><span>Получаем полный состав группы…</span></div>';
    try {
      const body = await api(
        spaceEndpoint(`/groups/${encodeURIComponent(groupId)}/members`)
      );
      operatorRenderGroupMembers(
        new Set((body?.data || []).map((member) => member.entityId))
      );
    } catch (error) {
      const holder = document.querySelector("#operatorGroupError");
      holder.hidden = false;
      holder.textContent = error?.message || "Состав группы получить не удалось.";
    }
  };

  operatorOpenGroupManager = async function operatorOpenGroupManagerV2({
    selectAll = false
  } = {}) {
    operatorEnsureGroupDialog();
    if (!state.employee.loaded) await loadEmployees();
    await loadCurrentSpaceData();
    operatorState.groupEditingId = null;
    operatorState.groupMemberIds = new Set(
      selectAll
        ? state.data.employees
            .filter((employee) => employee.status === "active")
            .map(employeeId)
        : []
    );
    operatorState.groupMemberPage = 1;
    operatorState.groupMemberFilter = "all";
    operatorState.groupMemberStatus = "active";
    document.querySelector("#operatorGroupSearch").value = "";
    document.querySelector("#operatorGroupListSearch").value = "";
    document.querySelector("#operatorGroupMembershipFilter").value = "all";
    document.querySelector("#operatorGroupStatusFilter").value = "active";
    document.querySelector("#operatorGroupName").value = "";
    document.querySelector("#operatorGroupDescription").value = "";
    document.querySelector("#operatorGroupArchive").hidden = true;
    document.querySelector("#operatorGroupError").hidden = true;
    operatorRenderGroupSelect();
    operatorRenderGroupMembers();
    const dialog = document.querySelector("#operatorGroupDialog");
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => document.querySelector("#operatorGroupName")?.focus());
  };

  operatorSaveGroup = async function operatorSaveGroupV2(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const name = document.querySelector("#operatorGroupName")?.value.trim() || "";
    const errorHolder = document.querySelector("#operatorGroupError");
    if (!name) {
      errorHolder.hidden = false;
      errorHolder.textContent = "Укажите понятное название группы.";
      return;
    }
    const entityIds = groupV2Employees()
      .map(employeeId)
      .filter((id) => operatorState.groupMemberIds.has(id));
    const button = document.querySelector("#operatorGroupSave");
    button.disabled = true;
    button.textContent = "Сохраняем весь состав…";
    errorHolder.hidden = true;
    try {
      let groupId = operatorState.groupEditingId;
      if (groupId) {
        await api(spaceEndpoint(`/groups/${encodeURIComponent(groupId)}`), {
          method: "PUT",
          body: JSON.stringify({
            name,
            description:
              document.querySelector("#operatorGroupDescription")?.value.trim() || null,
            status: "active"
          })
        });
      } else {
        const body = await api(spaceEndpoint("/groups"), {
          method: "POST",
          body: JSON.stringify({
            name,
            description:
              document.querySelector("#operatorGroupDescription")?.value.trim() || undefined
          })
        });
        groupId = body.data.id;
      }
      await api(spaceEndpoint(`/groups/${encodeURIComponent(groupId)}/members`), {
        method: "PUT",
        body: JSON.stringify({ entityIds })
      });
      document.querySelector("#operatorGroupDialog").close();
      await loadCurrentSpaceData();
      notify(
        "✓",
        "Группа сохранена",
        entityIds.length
          ? `В группе ${entityIds.length} сотрудников. Поиск и страницы не повлияли на состав.`
          : "Создана пустая группа. Добавьте участников перед выпуском документов."
      );
      window.dispatchEvent(
        new CustomEvent("docomator:groups-changed", {
          detail: { spaceId: state.currentSpaceId }
        })
      );
    } catch (cause) {
      const error = cause instanceof ApiError
        ? cause
        : new ApiError("Не удалось сохранить группу.");
      errorHolder.hidden = false;
      errorHolder.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = operatorState.groupEditingId
        ? "Сохранить изменения"
        : "Создать группу";
    }
  };
}
