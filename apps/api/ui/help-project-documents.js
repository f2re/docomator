{
  let projectDocuments = [];
  let projectDocumentsLoaded = false;
  let projectDocumentsBusy = false;
  let projectDocumentsQuery = "";
  let projectDocumentsCategory = "all";
  let projectDocumentCurrent = null;

  function projectDocsEscape(value) {
    return String(value ?? "").replace(/[&<>'"]/gu, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    })[character]);
  }

  async function projectDocsFetch(url) {
    const response = await fetch(url, {
      headers: { accept: "application/json" }
    });
    const body = await response.json();
    if (!response.ok) {
      const error = new Error(
        body?.error?.message || `Сервер вернул код ${response.status}.`
      );
      error.correlationId =
        body?.correlationId || response.headers.get("x-correlation-id") || "";
      throw error;
    }
    return body;
  }

  function projectDocsFormatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return "";
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} КБ`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
  }

  function projectDocsCategories() {
    return [...new Set(projectDocuments.map((document) => document.category))]
      .sort((left, right) => left.localeCompare(right, "ru-RU"));
  }

  function projectDocsFiltered() {
    const query = projectDocumentsQuery.trim().toLocaleLowerCase("ru-RU");
    return projectDocuments.filter((document) => {
      if (
        projectDocumentsCategory !== "all" &&
        document.category !== projectDocumentsCategory
      ) {
        return false;
      }
      if (!query) return true;
      return `${document.title} ${document.path} ${document.category}`
        .toLocaleLowerCase("ru-RU")
        .includes(query);
    });
  }

  function projectDocsInline(value, currentPath = "") {
    let escaped = projectDocsEscape(value);
    escaped = escaped.replace(/`([^`]+)`/gu, "<code>$1</code>");
    escaped = escaped.replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>");
    escaped = escaped.replace(/__([^_]+)__/gu, "<strong>$1</strong>");
    escaped = escaped.replace(/\*([^*]+)\*/gu, "<em>$1</em>");
    escaped = escaped.replace(
      /\[([^\]]+)\]\(([^)]+)\)/gu,
      (_match, label, target) => {
        const decodedTarget = String(target)
          .replace(/&amp;/gu, "&")
          .replace(/&lt;/gu, "<")
          .replace(/&gt;/gu, ">");
        if (/\.md(?:#.*)?$/iu.test(decodedTarget) && !/^[a-z]+:/iu.test(decodedTarget)) {
          const baseDirectory = currentPath.includes("/")
            ? currentPath.slice(0, currentPath.lastIndexOf("/") + 1)
            : "";
          const rawPath = decodedTarget.split("#", 1)[0] || "";
          const normalized = `${baseDirectory}${rawPath}`
            .split("/")
            .reduce((parts, segment) => {
              if (segment === "..") parts.pop();
              else if (segment && segment !== ".") parts.push(segment);
              return parts;
            }, [])
            .join("/");
          return `<button class="help-project-inline-link" type="button" data-help-project-path="${projectDocsEscape(normalized)}">${label}</button>`;
        }
        return `<span class="help-project-external-reference">${label} <code>${projectDocsEscape(decodedTarget)}</code></span>`;
      }
    );
    return escaped;
  }

  function projectDocsMarkdown(markdown, currentPath) {
    const lines = String(markdown || "").replace(/\r\n?/gu, "\n").split("\n");
    const output = [];
    let paragraph = [];
    let listKind = null;
    let codeFence = null;
    let codeLines = [];

    const flushParagraph = () => {
      if (paragraph.length === 0) return;
      output.push(`<p>${projectDocsInline(paragraph.join(" "), currentPath)}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      if (!listKind) return;
      output.push(`</${listKind}>`);
      listKind = null;
    };
    const openList = (kind) => {
      if (listKind === kind) return;
      closeList();
      output.push(`<${kind}>`);
      listKind = kind;
    };

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      const fence = /^```\s*([^\s]*)\s*$/u.exec(line);
      if (codeFence !== null) {
        if (fence) {
          output.push(
            `<pre><code${codeFence ? ` data-language="${projectDocsEscape(codeFence)}"` : ""}>${projectDocsEscape(codeLines.join("\n"))}</code></pre>`
          );
          codeFence = null;
          codeLines = [];
        } else {
          codeLines.push(line);
        }
        continue;
      }
      if (fence) {
        flushParagraph();
        closeList();
        codeFence = fence[1] || "";
        continue;
      }
      if (line.trim() === "") {
        flushParagraph();
        closeList();
        continue;
      }

      const nextLine = lines[index + 1] ?? "";
      if (
        line.includes("|") &&
        /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/u.test(nextLine)
      ) {
        flushParagraph();
        closeList();
        const headers = line
          .replace(/^\s*\||\|\s*$/gu, "")
          .split("|")
          .map((cell) => cell.trim());
        const rows = [];
        index += 2;
        while (index < lines.length && (lines[index] ?? "").includes("|")) {
          rows.push(
            (lines[index] ?? "")
              .replace(/^\s*\||\|\s*$/gu, "")
              .split("|")
              .map((cell) => cell.trim())
          );
          index += 1;
        }
        index -= 1;
        output.push(
          `<div class="help-project-table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${projectDocsInline(cell, currentPath)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((_header, cellIndex) => `<td>${projectDocsInline(row[cellIndex] || "", currentPath)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
        );
        continue;
      }

      const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
      if (heading) {
        flushParagraph();
        closeList();
        const level = Math.min(6, Math.max(2, heading[1]?.length || 2));
        output.push(`<h${level}>${projectDocsInline(heading[2] || "", currentPath)}</h${level}>`);
        continue;
      }
      const quote = /^>\s?(.*)$/u.exec(line);
      if (quote) {
        flushParagraph();
        closeList();
        output.push(`<blockquote>${projectDocsInline(quote[1] || "", currentPath)}</blockquote>`);
        continue;
      }
      const unordered = /^\s*[-*+]\s+(.+)$/u.exec(line);
      if (unordered) {
        flushParagraph();
        openList("ul");
        output.push(`<li>${projectDocsInline(unordered[1] || "", currentPath)}</li>`);
        continue;
      }
      const ordered = /^\s*\d+[.)]\s+(.+)$/u.exec(line);
      if (ordered) {
        flushParagraph();
        openList("ol");
        output.push(`<li>${projectDocsInline(ordered[1] || "", currentPath)}</li>`);
        continue;
      }
      const rule = /^\s*(?:---+|___+|\*\*\*+)\s*$/u.test(line);
      if (rule) {
        flushParagraph();
        closeList();
        output.push("<hr />");
        continue;
      }
      paragraph.push(line.trim());
    }

    flushParagraph();
    closeList();
    if (codeFence !== null) {
      output.push(`<pre><code>${projectDocsEscape(codeLines.join("\n"))}</code></pre>`);
    }
    return output.join("\n");
  }

  function projectDocsEnsureEntry() {
    const indexPane = document.querySelector("#helpCenterIndexPane");
    if (!indexPane || document.querySelector("#helpProjectDocumentsEntry")) return;
    const section = document.createElement("section");
    section.id = "helpProjectDocumentsEntry";
    section.className = "help-project-entry";
    section.innerHTML = `
      <div>
        <p class="eyebrow">Полный архив</p>
        <h3>Все документы проекта</h3>
        <p>Нормативные требования, архитектура, эксплуатация, планы, руководства и принятые решения доступны в установленной версии.</p>
      </div>
      <button class="secondary-button" type="button" data-help-project-open>Открыть документы</button>`;
    const articleList = indexPane.querySelector("#helpCenterArticleList");
    indexPane.insertBefore(section, articleList || null);
  }

  function projectDocsBrowserMarkup() {
    return `
      <div class="help-center-article-toolbar">
        <button class="secondary-button" type="button" data-help-project-close><span aria-hidden="true">‹</span> К руководству</button>
      </div>
      <section class="help-project-browser">
        <header><p class="eyebrow">Документация установленной версии</p><h2 tabindex="-1" id="helpProjectHeading">Все документы проекта</h2><p>Содержимое читается из локального каталога <code>docs/</code>. Внешнее соединение не используется.</p></header>
        <div class="help-project-tools">
          <label class="search-field" for="helpProjectSearch"><span aria-hidden="true">⌕</span><input id="helpProjectSearch" type="search" placeholder="Найти документ или тему" autocomplete="off" /></label>
          <label><span>Категория</span><select id="helpProjectCategory"><option value="all">Все категории</option></select></label>
        </div>
        <div id="helpProjectStatus" class="help-project-status" role="status" aria-live="polite"></div>
        <div id="helpProjectList" class="help-project-list"></div>
        <div id="helpProjectDocument" class="help-project-document" hidden></div>
      </section>`;
  }

  async function projectDocsLoadManifest() {
    if (projectDocumentsLoaded || projectDocumentsBusy) return;
    projectDocumentsBusy = true;
    const status = document.querySelector("#helpProjectStatus");
    if (status) {
      status.className = "help-project-status is-loading";
      status.textContent = "Получаем локальный каталог документации…";
    }
    try {
      const body = await projectDocsFetch("/api/v1/help/documents");
      projectDocuments = Array.isArray(body.data) ? body.data : [];
      projectDocumentsLoaded = true;
      const category = document.querySelector("#helpProjectCategory");
      if (category) {
        category.innerHTML = [
          '<option value="all">Все категории</option>',
          ...projectDocsCategories().map(
            (name) => `<option value="${projectDocsEscape(name)}">${projectDocsEscape(name)}</option>`
          )
        ].join("");
      }
      if (status) {
        status.className = "help-project-status is-success";
        status.textContent = `Доступно документов: ${projectDocuments.length}.`;
      }
      projectDocsRenderList();
    } catch (error) {
      if (status) {
        status.className = "help-project-status is-error";
        status.innerHTML = `<strong>Документацию получить не удалось</strong><span>${projectDocsEscape(error?.message || "Повторите действие.")}</span>${error?.correlationId ? `<small>Идентификатор операции: <code>${projectDocsEscape(error.correlationId)}</code></small>` : ""}<button class="secondary-button" type="button" data-help-project-retry>Повторить</button>`;
      }
    } finally {
      projectDocumentsBusy = false;
    }
  }

  function projectDocsRenderList() {
    const list = document.querySelector("#helpProjectList");
    const documentHolder = document.querySelector("#helpProjectDocument");
    if (!list || !documentHolder) return;
    documentHolder.hidden = true;
    list.hidden = false;
    const documents = projectDocsFiltered();
    if (documents.length === 0) {
      list.innerHTML = '<div class="empty-state compact-empty"><div><span class="empty-emoji" aria-hidden="true">⌕</span><h3>Документы не найдены</h3><p>Измените запрос или выберите все категории.</p></div></div>';
      return;
    }
    list.innerHTML = documents.map((document) => `
      <button class="help-project-row" type="button" data-help-project-document="${projectDocsEscape(document.id)}">
        <span class="help-project-file-mark" aria-hidden="true">M↓</span>
        <span><strong>${projectDocsEscape(document.title)}</strong><small>${projectDocsEscape(document.category)} · ${projectDocsEscape(document.path)} · ${projectDocsEscape(projectDocsFormatBytes(document.sizeBytes))}</small></span>
        <span aria-hidden="true">›</span>
      </button>`).join("");
  }

  async function projectDocsOpenDocument(documentId) {
    const summary = projectDocuments.find((document) => document.id === documentId);
    const list = document.querySelector("#helpProjectList");
    const holder = document.querySelector("#helpProjectDocument");
    const status = document.querySelector("#helpProjectStatus");
    if (!summary || !list || !holder) return;
    projectDocumentCurrent = summary.id;
    list.hidden = true;
    holder.hidden = false;
    holder.innerHTML = '<div class="help-project-loading"><span class="state-mark" aria-hidden="true"></span><span>Читаем документ…</span></div>';
    try {
      const body = await projectDocsFetch(
        `/api/v1/help/documents/${encodeURIComponent(summary.id)}`
      );
      const document = body.data;
      holder.innerHTML = `
        <div class="help-project-document-toolbar">
          <button class="secondary-button" type="button" data-help-project-list><span aria-hidden="true">‹</span> К списку документов</button>
          <span>${projectDocsEscape(document.path)}</span>
        </div>
        <article class="help-project-markdown">
          ${projectDocsMarkdown(document.content, document.path)}
        </article>`;
      holder.querySelector("h2, h3")?.setAttribute("tabindex", "-1");
      holder.querySelector("h2, h3")?.focus();
      if (status) {
        status.className = "help-project-status is-success";
        status.textContent = `Открыт документ «${document.title}».`;
      }
    } catch (error) {
      holder.innerHTML = `<div class="help-project-read-error"><strong>Документ не открыт</strong><p>${projectDocsEscape(error?.message || "Повторите действие.")}</p>${error?.correlationId ? `<small>Идентификатор операции: <code>${projectDocsEscape(error.correlationId)}</code></small>` : ""}<button class="secondary-button" type="button" data-help-project-document="${projectDocsEscape(summary.id)}">Повторить</button></div>`;
    }
  }

  function projectDocsOpenByPath(relativePath) {
    const normalized = String(relativePath || "").replace(/^\.\//u, "");
    const document = projectDocuments.find(
      (candidate) => candidate.path === normalized
    );
    if (document) void projectDocsOpenDocument(document.id);
  }

  function projectDocsOpenBrowser() {
    projectDocsEnsureEntry();
    const indexPane = document.querySelector("#helpCenterIndexPane");
    const articlePane = document.querySelector("#helpCenterArticlePane");
    if (!indexPane || !articlePane) return;
    indexPane.hidden = true;
    articlePane.hidden = false;
    articlePane.innerHTML = projectDocsBrowserMarkup();
    const search = articlePane.querySelector("#helpProjectSearch");
    if (search) search.value = projectDocumentsQuery;
    void projectDocsLoadManifest().then(() => {
      if (projectDocumentCurrent) void projectDocsOpenDocument(projectDocumentCurrent);
      else projectDocsRenderList();
    });
    articlePane.querySelector("#helpProjectHeading")?.focus();
  }

  function projectDocsCloseBrowser() {
    projectDocumentCurrent = null;
    const indexPane = document.querySelector("#helpCenterIndexPane");
    const articlePane = document.querySelector("#helpCenterArticlePane");
    if (!indexPane || !articlePane) return;
    indexPane.hidden = false;
    articlePane.hidden = true;
    projectDocsEnsureEntry();
    document.querySelector("[data-help-project-open]")?.focus();
  }

  function projectDocsAttachEvents() {
    document.addEventListener("click", (event) => {
      if (event.target.closest("[data-help-project-open]")) {
        projectDocsOpenBrowser();
        return;
      }
      if (event.target.closest("[data-help-project-close]")) {
        projectDocsCloseBrowser();
        return;
      }
      if (event.target.closest("[data-help-project-list]")) {
        projectDocumentCurrent = null;
        projectDocsRenderList();
        document.querySelector("#helpProjectSearch")?.focus();
        return;
      }
      const documentButton = event.target.closest("[data-help-project-document]");
      if (documentButton) {
        void projectDocsOpenDocument(documentButton.dataset.helpProjectDocument);
        return;
      }
      const inline = event.target.closest("[data-help-project-path]");
      if (inline) {
        projectDocsOpenByPath(inline.dataset.helpProjectPath);
        return;
      }
      if (event.target.closest("[data-help-project-retry]")) {
        projectDocumentsLoaded = false;
        void projectDocsLoadManifest();
      }
    });
    document.addEventListener("input", (event) => {
      if (!event.target.matches("#helpProjectSearch")) return;
      projectDocumentsQuery = event.target.value;
      projectDocsRenderList();
    });
    document.addEventListener("change", (event) => {
      if (!event.target.matches("#helpProjectCategory")) return;
      projectDocumentsCategory = event.target.value || "all";
      projectDocsRenderList();
    });
    window.addEventListener("docomator:help-opened", projectDocsEnsureEntry);
  }

  projectDocsEnsureEntry();
  projectDocsAttachEvents();
}
