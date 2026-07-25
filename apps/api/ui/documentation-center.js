{
  const documentationCatalog = globalThis.docomatorDocumentationCatalog;
  const documentationViewName = "documentation";
  const documentationLastKey = "docomator.documentation.last-document.v1";
  let documentationReady = false;
  let documentationSelectedId = "";
  let documentationSearchQuery = "";

  function documentationEscape(value) {
    return String(value ?? "").replace(
      /[&<>'"]/gu,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;"
        })[character]
    );
  }

  function documentationNormalize(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .toLocaleLowerCase("ru-RU")
      .replace(/ё/gu, "е")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/\s+/gu, " ");
  }

  function documentationSlug(value) {
    return documentationNormalize(value).replace(/\s+/gu, "-") || "section";
  }

  function documentationDocuments() {
    return Array.isArray(documentationCatalog?.documents)
      ? documentationCatalog.documents
      : [];
  }

  function documentationDocumentById(id) {
    return documentationDocuments().find((document) => document.id === id) || null;
  }

  function documentationNormalizePath(value) {
    const segments = [];
    for (const segment of String(value || "").replace(/\\/gu, "/").split("/")) {
      if (!segment || segment === ".") continue;
      if (segment === "..") segments.pop();
      else segments.push(segment);
    }
    return segments.join("/");
  }

  function documentationPathMap() {
    return new Map(
      documentationDocuments().map((document) => [
        documentationNormalizePath(document.path).toLocaleLowerCase("en-US"),
        document
      ])
    );
  }

  function documentationResolveLink(currentDocument, rawHref) {
    const href = String(rawHref || "").trim();
    if (!href) return null;
    if (href.startsWith("#")) {
      return { document: currentDocument, anchor: href.slice(1) };
    }
    const [pathPart, anchor = ""] = href.split("#", 2);
    if (!/\.md$/iu.test(pathPart)) return null;
    const currentDirectory = currentDocument.path.includes("/")
      ? currentDocument.path.slice(0, currentDocument.path.lastIndexOf("/") + 1)
      : "";
    const normalized = documentationNormalizePath(
      pathPart.startsWith("/") ? pathPart.slice(1) : `${currentDirectory}${pathPart}`
    ).toLocaleLowerCase("en-US");
    const document = documentationPathMap().get(normalized);
    return document ? { document, anchor } : null;
  }

  function documentationSafeExternalLink(rawHref) {
    const href = String(rawHref || "").trim();
    try {
      const url = new URL(href, globalThis.location?.href || "http://localhost/");
      return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
    } catch {
      return null;
    }
  }

  function documentationInline(rawText, currentDocument) {
    const tokens = [];
    const token = (html) => {
      const marker = `DOCOMATORINLINE${tokens.length}TOKEN`;
      tokens.push(html);
      return marker;
    };
    let value = String(rawText ?? "");
    value = value.replace(/`([^`\n]+)`/gu, (_match, code) =>
      token(`<code>${documentationEscape(code)}</code>`)
    );
    value = value.replace(/!\[([^\]]*)\]\(([^)]+)\)/gu, (_match, alt, href) => {
      const external = documentationSafeExternalLink(href);
      const label = documentationEscape(alt || "Изображение");
      return token(
        external
          ? `<a class="documentation-image-link" href="${documentationEscape(external)}" target="_blank" rel="noopener noreferrer">Изображение: ${label}</a>`
          : `<span class="documentation-image-placeholder">Изображение: ${label}</span>`
      );
    });
    value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/gu, (_match, label, href) => {
      const internal = documentationResolveLink(currentDocument, href);
      if (internal) {
        const hash = documentationHash(internal.document.id, internal.anchor);
        return token(
          `<a href="${documentationEscape(hash)}" data-documentation-link="${documentationEscape(internal.document.id)}" data-documentation-anchor="${documentationEscape(internal.anchor)}">${documentationEscape(label)}</a>`
        );
      }
      const external = documentationSafeExternalLink(href);
      if (external) {
        return token(
          `<a href="${documentationEscape(external)}" target="_blank" rel="noopener noreferrer">${documentationEscape(label)}</a>`
        );
      }
      return token(`<span>${documentationEscape(label)}</span>`);
    });
    value = documentationEscape(value)
      .replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>")
      .replace(/__([^_]+)__/gu, "<strong>$1</strong>")
      .replace(/~~([^~]+)~~/gu, "<del>$1</del>")
      .replace(/(^|[^*])\*([^*\n]+)\*/gu, "$1<em>$2</em>")
      .replace(/(^|[^_])_([^_\n]+)_/gu, "$1<em>$2</em>");
    tokens.forEach((html, index) => {
      value = value.replace(`DOCOMATORINLINE${index}TOKEN`, html);
    });
    return value;
  }

  function documentationTableCells(line) {
    return line
      .trim()
      .replace(/^\||\|$/gu, "")
      .split(/(?<!\\)\|/gu)
      .map((cell) => cell.replace(/\\\|/gu, "|").trim());
  }

  function documentationIsTableSeparator(line) {
    const cells = documentationTableCells(line);
    return (
      cells.length > 0 &&
      cells.every((cell) => /^:?-{3,}:?$/u.test(cell.replace(/\s+/gu, "")))
    );
  }

  function documentationIsBlockStart(lines, index) {
    const line = lines[index] ?? "";
    const next = lines[index + 1] ?? "";
    return (
      line.trim() === "" ||
      /^#{1,4}\s+/u.test(line) ||
      /^```/u.test(line.trim()) ||
      /^\s*(?:[-*+]\s+|\d+[.)]\s+)/u.test(line) ||
      /^\s*>\s?/u.test(line) ||
      /^\s*(?:---+|___+|\*\*\*+)\s*$/u.test(line) ||
      (line.includes("|") && documentationIsTableSeparator(next))
    );
  }

  function documentationRenderMarkdown(document) {
    const lines = String(document.markdown || "").replace(/\r\n?/gu, "\n").split("\n");
    const result = [];
    const headingCounts = new Map();
    let index = 0;
    while (index < lines.length) {
      const line = lines[index] ?? "";
      const trimmed = line.trim();
      if (trimmed === "") {
        index += 1;
        continue;
      }

      const fence = /^```\s*([^\s`]*)\s*$/u.exec(trimmed);
      if (fence) {
        const language = fence[1] || "text";
        const code = [];
        index += 1;
        while (index < lines.length && !/^```\s*$/u.test((lines[index] ?? "").trim())) {
          code.push(lines[index] ?? "");
          index += 1;
        }
        if (index < lines.length) index += 1;
        result.push(
          `<div class="documentation-code"><div class="documentation-code-heading"><span>${documentationEscape(language)}</span><button type="button" data-documentation-copy-code>Копировать</button></div><pre><code>${documentationEscape(code.join("\n"))}</code></pre></div>`
        );
        continue;
      }

      const heading = /^(#{1,4})\s+(.+?)\s*#*\s*$/u.exec(line);
      if (heading) {
        const level = heading[1].length;
        const rawTitle = heading[2] ?? "";
        const base = documentationSlug(rawTitle.replace(/[*_`~]/gu, ""));
        const count = (headingCounts.get(base) ?? 0) + 1;
        headingCounts.set(base, count);
        const anchor = count === 1 ? base : `${base}-${count}`;
        result.push(
          `<h${level} id="${documentationEscape(anchor)}"><a class="documentation-heading-anchor" href="${documentationEscape(documentationHash(document.id, anchor))}" aria-label="Ссылка на раздел">#</a>${documentationInline(rawTitle, document)}</h${level}>`
        );
        index += 1;
        continue;
      }

      if (/^\s*(?:---+|___+|\*\*\*+)\s*$/u.test(line)) {
        result.push("<hr />");
        index += 1;
        continue;
      }

      if (line.includes("|") && documentationIsTableSeparator(lines[index + 1] ?? "")) {
        const headers = documentationTableCells(line);
        const body = [];
        index += 2;
        while (index < lines.length && (lines[index] ?? "").includes("|") && (lines[index] ?? "").trim() !== "") {
          body.push(documentationTableCells(lines[index] ?? ""));
          index += 1;
        }
        result.push(
          `<div class="documentation-table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${documentationInline(cell, document)}</th>`).join("")}</tr></thead><tbody>${body.map((row) => `<tr>${headers.map((_header, cellIndex) => `<td>${documentationInline(row[cellIndex] || "", document)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
        );
        continue;
      }

      const unordered = /^\s*[-*+]\s+(.+)$/u.exec(line);
      const ordered = /^\s*\d+[.)]\s+(.+)$/u.exec(line);
      if (unordered || ordered) {
        const orderedList = Boolean(ordered);
        const items = [];
        while (index < lines.length) {
          const current = lines[index] ?? "";
          const match = orderedList
            ? /^\s*\d+[.)]\s+(.+)$/u.exec(current)
            : /^\s*[-*+]\s+(.+)$/u.exec(current);
          if (!match) break;
          let item = match[1] ?? "";
          const check = /^\[([ xX])\]\s+(.+)$/u.exec(item);
          if (check) {
            item = `<span class="documentation-task ${check[1]?.trim() ? "is-complete" : ""}" aria-hidden="true">${check[1]?.trim() ? "✓" : ""}</span>${documentationInline(check[2] || "", document)}`;
          } else {
            item = documentationInline(item, document);
          }
          items.push(`<li>${item}</li>`);
          index += 1;
        }
        result.push(`<${orderedList ? "ol" : "ul"}>${items.join("")}</${orderedList ? "ol" : "ul"}>`);
        continue;
      }

      if (/^\s*>\s?/u.test(line)) {
        const quote = [];
        while (index < lines.length && /^\s*>\s?/u.test(lines[index] ?? "")) {
          quote.push((lines[index] ?? "").replace(/^\s*>\s?/u, ""));
          index += 1;
        }
        result.push(`<blockquote>${documentationInline(quote.join(" "), document)}</blockquote>`);
        continue;
      }

      const paragraph = [trimmed];
      index += 1;
      while (index < lines.length && !documentationIsBlockStart(lines, index)) {
        paragraph.push((lines[index] ?? "").trim());
        index += 1;
      }
      result.push(`<p>${documentationInline(paragraph.join(" "), document)}</p>`);
    }
    return result.join("\n");
  }

  function documentationHash(documentId, anchor = "") {
    const base = `#documentation/${encodeURIComponent(documentId)}`;
    return anchor ? `${base}/${encodeURIComponent(anchor)}` : base;
  }

  function documentationParseHash() {
    const match = /^#documentation\/([^/]+)(?:\/(.+))?$/u.exec(globalThis.location?.hash || "");
    if (!match) return null;
    try {
      return {
        id: decodeURIComponent(match[1] || ""),
        anchor: match[2] ? decodeURIComponent(match[2]) : ""
      };
    } catch {
      return null;
    }
  }

  function documentationPreferredDocument() {
    const quick = documentationDocuments().find((document) => document.path === "docs/QUICK_START.md");
    if (quick) return quick;
    const guide = documentationDocuments().find((document) => document.path === "docs/USER_GUIDE.md");
    if (guide) return guide;
    try {
      const last = localStorage.getItem(documentationLastKey) || "";
      const stored = documentationDocumentById(last);
      if (stored) return stored;
    } catch {
      // Локальное сохранение последнего документа необязательно.
    }
    return documentationDocuments()[0] || null;
  }

  function documentationCategoryOrder() {
    return Array.isArray(documentationCatalog?.categoryOrder)
      ? documentationCatalog.categoryOrder
      : [];
  }

  function documentationSearchMatches(document, query) {
    const terms = documentationNormalize(query).split(" ").filter(Boolean);
    if (terms.length === 0) return true;
    const haystack = documentationNormalize(
      `${document.title} ${document.description} ${document.path} ${document.searchText}`
    );
    return terms.every((term) => haystack.includes(term));
  }

  function documentationNavigationHtml() {
    const matches = documentationDocuments().filter((document) =>
      documentationSearchMatches(document, documentationSearchQuery)
    );
    if (matches.length === 0) {
      return `<div class="documentation-empty"><strong>Ничего не найдено</strong><p>Измените запрос или откройте содержание целиком.</p></div>`;
    }
    const categories = new Map();
    for (const document of matches) {
      const list = categories.get(document.category) || [];
      list.push(document);
      categories.set(document.category, list);
    }
    const order = [
      ...documentationCategoryOrder(),
      ...[...categories.keys()].filter((category) => !documentationCategoryOrder().includes(category))
    ];
    return order
      .filter((category) => categories.has(category))
      .map((category) => {
        const documents = categories.get(category) || [];
        const open = documentationSearchQuery || documents.some((document) => document.id === documentationSelectedId);
        return `<details class="documentation-category"${open ? " open" : ""}><summary><span>${documentationEscape(category)}</span><em>${documents.length}</em></summary><div>${documents.map((document) => `<button type="button" class="documentation-document-link${document.id === documentationSelectedId ? " is-active" : ""}" data-documentation-open="${documentationEscape(document.id)}"><strong>${documentationEscape(document.title)}</strong><small>${documentationEscape(document.description)}</small></button>`).join("")}</div></details>`;
      })
      .join("");
  }

  function documentationRenderNavigation() {
    const holder = document.querySelector("#documentationNavigation");
    const counter = document.querySelector("#documentationSearchCount");
    if (!holder) return;
    holder.innerHTML = documentationNavigationHtml();
    const count = documentationDocuments().filter((document) =>
      documentationSearchMatches(document, documentationSearchQuery)
    ).length;
    if (counter) {
      counter.textContent = documentationSearchQuery
        ? `Найдено документов: ${count}`
        : `Документов: ${documentationDocuments().length}`;
    }
  }

  function documentationSearchResultsHtml() {
    const matches = documentationDocuments().filter((document) =>
      documentationSearchMatches(document, documentationSearchQuery)
    );
    return `<section class="documentation-search-results"><div class="documentation-article-heading"><div><p class="eyebrow">Поиск</p><h1>Результаты по запросу «${documentationEscape(documentationSearchQuery)}»</h1><p>Ищем по названиям, заголовкам и полному тексту всех документов.</p></div></div>${matches.length > 0 ? `<div class="documentation-result-grid">${matches.map((document) => `<button type="button" data-documentation-open="${documentationEscape(document.id)}"><span>${documentationEscape(document.category)}</span><strong>${documentationEscape(document.title)}</strong><p>${documentationEscape(document.description)}</p><small>${documentationEscape(document.path)}</small></button>`).join("")}</div>` : `<div class="documentation-empty"><strong>Совпадений нет</strong><p>Попробуйте менее точное слово или проверьте написание.</p></div>`}</section>`;
  }

  function documentationTocHtml(document) {
    const headings = Array.isArray(document.headings)
      ? document.headings.filter((heading) => heading.level >= 2 && heading.level <= 4)
      : [];
    if (headings.length === 0) return "";
    return `<aside class="documentation-toc"><strong>На этой странице</strong><nav>${headings.map((heading) => `<a class="level-${heading.level}" href="${documentationEscape(documentationHash(document.id, heading.anchor))}" data-documentation-anchor-jump="${documentationEscape(heading.anchor)}">${documentationEscape(heading.text)}</a>`).join("")}</nav></aside>`;
  }

  function documentationArticleHtml(document) {
    return `<article class="documentation-article" data-documentation-document="${documentationEscape(document.id)}"><div class="documentation-article-toolbar"><div><span>${documentationEscape(document.category)}</span><code>${documentationEscape(document.path)}</code></div><div><button type="button" id="documentationCopyLink">Копировать ссылку</button><button type="button" id="documentationBackToIndex">Все документы</button></div></div><div class="documentation-article-layout"><div class="documentation-markdown">${documentationRenderMarkdown(document)}</div>${documentationTocHtml(document)}</div><footer><span>Контрольная сумма каталога</span><code>${documentationEscape(String(documentationCatalog?.sourceSha256 || "").slice(0, 16))}</code></footer></article>`;
  }

  function documentationLandingHtml() {
    const preferredPaths = [
      "docs/QUICK_START.md",
      "docs/USER_GUIDE.md",
      "docs/IMPORT_AND_WORD_ROSTERS.md",
      "docs/FLOW_CATALOG.md",
      "docs/OPERATIONS.md",
      "docs/OFFLINE_DEPLOYMENT.md"
    ];
    const documents = preferredPaths
      .map((pathValue) => documentationDocuments().find((document) => document.path === pathValue))
      .filter(Boolean);
    return `<section class="documentation-home"><div class="documentation-article-heading"><div><p class="eyebrow">Справка Docomator</p><h1>Инструкции, процессы и устройство системы</h1><p>Документация встроена в автономный интерфейс. Начните с быстрого старта или найдите нужную операцию.</p></div><span aria-hidden="true">?</span></div><div class="documentation-home-stats"><div><strong>${documentationDocuments().length}</strong><span>документов</span></div><div><strong>${new Set(documentationDocuments().map((document) => document.category)).size}</strong><span>разделов</span></div><div><strong>F1</strong><span>открыть справку</span></div></div><div class="documentation-result-grid">${documents.map((document) => `<button type="button" data-documentation-open="${documentationEscape(document.id)}"><span>${documentationEscape(document.category)}</span><strong>${documentationEscape(document.title)}</strong><p>${documentationEscape(document.description)}</p><small>${documentationEscape(document.path)}</small></button>`).join("")}</div><section class="documentation-home-note"><strong>Не нашли нужный сценарий?</strong><p>Введите название операции, поле, сообщение об ошибке или термин в строку поиска. Поиск работает по полному тексту.</p></section></section>`;
  }

  function documentationRenderContent(document = null, anchor = "") {
    const holder = documentQuery("#documentationContent");
    if (!holder) return;
    if (documentationSearchQuery) {
      holder.innerHTML = documentationSearchResultsHtml();
      holder.scrollTop = 0;
      return;
    }
    if (!document) {
      holder.innerHTML = documentationLandingHtml();
      holder.scrollTop = 0;
      return;
    }
    holder.innerHTML = documentationArticleHtml(document);
    holder.scrollTop = 0;
    if (anchor) {
      requestAnimationFrame(() => {
        const target = holder.querySelector(`#${CSS.escape(anchor)}`);
        target?.scrollIntoView({ block: "start" });
      });
    }
  }

  function documentQuery(selector) {
    return globalThis.document?.querySelector(selector) || null;
  }

  function documentationSelectDocument(documentId, anchor = "", updateHash = true) {
    const selected = documentationDocumentById(documentId);
    if (!selected) return false;
    documentationSelectedId = selected.id;
    documentationSearchQuery = "";
    const search = documentQuery("#documentationSearch");
    if (search) search.value = "";
    try {
      localStorage.setItem(documentationLastKey, selected.id);
    } catch {
      // Сохранение последнего документа необязательно.
    }
    documentationRenderNavigation();
    documentationRenderContent(selected, anchor);
    if (updateHash && globalThis.location) {
      history.replaceState(null, "", documentationHash(selected.id, anchor));
    }
    return true;
  }

  function documentationShowIndex(updateHash = true) {
    documentationSelectedId = "";
    documentationSearchQuery = "";
    const search = documentQuery("#documentationSearch");
    if (search) search.value = "";
    documentationRenderNavigation();
    documentationRenderContent();
    if (updateHash && globalThis.location) history.replaceState(null, "", "#documentation");
  }

  function documentationSetVisible(visible) {
    const view = documentQuery('[data-view="documentation"]');
    if (!view) return;
    if (visible) {
      globalThis.docomatorSelectView?.(documentationViewName);
      globalThis.document?.querySelectorAll("[data-view]").forEach((candidate) => {
        const active = candidate === view;
        candidate.hidden = !active;
        candidate.classList.toggle("is-active", active);
      });
      globalThis.document?.querySelectorAll("[data-view-target]").forEach((button) => {
        const active = button.dataset.viewTarget === documentationViewName;
        button.classList.toggle("is-active", active);
        if (active) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      });
      view.hidden = false;
    } else {
      view.hidden = true;
    }
  }

  function documentationContextTarget() {
    const guide = documentationDocuments().find((document) => document.path === "docs/USER_GUIDE.md");
    if (!guide) return documentationPreferredDocument();
    const current = [...(globalThis.document?.querySelectorAll("[data-view]") || [])].find(
      (view) => !view.hidden && view.dataset.view !== documentationViewName
    )?.dataset.view;
    const mapping = {
      employees: "rabota-s-razdelami-dannyh",
      templates: "podgotovka-shablona-docx-ili-xlsx",
      generation: "formirovanie-otdelnyh-dokumentov",
      documents: "formirovanie-otdelnyh-dokumentov",
      schedules: "raspisaniya-i-avtomaticheskie-zapuski",
      results: "rezultaty-i-hranenie"
    };
    return { document: guide, anchor: mapping[current] || "" };
  }

  function documentationOpen(documentId = "", anchor = "") {
    documentationSetVisible(true);
    const parsed = documentId ? { id: documentId, anchor } : documentationParseHash();
    if (parsed?.id && documentationSelectDocument(parsed.id, parsed.anchor, false)) return;
    const contextual = documentationContextTarget();
    if (contextual?.document) {
      documentationSelectDocument(contextual.document.id, contextual.anchor || "", true);
    } else {
      documentationShowIndex(true);
    }
    documentQuery("#documentationSearch")?.focus();
  }

  function documentationCreateNavigationButton() {
    if (documentQuery("#documentationNavButton")) return;
    const reference =
      documentQuery('[data-view-target="employees"]') ||
      documentQuery('[data-view-target="templates"]') ||
      documentQuery("[data-view-target]");
    const parent = reference?.parentElement;
    if (!parent) return;
    const button = globalThis.document.createElement("button");
    button.id = "documentationNavButton";
    button.type = "button";
    button.className = `${reference.className || ""} documentation-nav-button`.trim();
    button.dataset.viewTarget = documentationViewName;
    button.innerHTML = '<span class="documentation-nav-icon" aria-hidden="true">?</span><span>Справка</span><kbd>F1</kbd>';
    parent.append(button);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      documentationOpen();
    });
  }

  function documentationCreateView() {
    if (documentQuery('[data-view="documentation"]')) return;
    const reference = documentQuery('[data-view="employees"]') || documentQuery("[data-view]");
    const parent = reference?.parentElement || documentQuery("main");
    if (!parent) return;
    const view = globalThis.document.createElement("section");
    view.dataset.view = documentationViewName;
    view.className = "documentation-view";
    view.hidden = true;
    view.innerHTML = `<header class="documentation-header"><div><p class="eyebrow">Встроенная документация</p><h1>Справка</h1><p>Все руководства проекта доступны локально и без подключения к интернету.</p></div><label class="documentation-search"><span>Поиск по документации</span><div><span aria-hidden="true">⌕</span><input id="documentationSearch" type="search" autocomplete="off" placeholder="Например: импорт паспорта, строка Word, расписание" /><button id="documentationClearSearch" type="button" aria-label="Очистить поиск">×</button></div><small id="documentationSearchCount"></small></label></header><div class="documentation-shell"><aside class="documentation-sidebar"><div class="documentation-sidebar-heading"><strong>Содержание</strong><button type="button" id="documentationHome">Начало</button></div><nav id="documentationNavigation" aria-label="Документы"></nav></aside><main id="documentationContent" class="documentation-content" tabindex="-1"></main></div>`;
    parent.append(view);
  }

  async function documentationCopy(value, button, successText = "Скопировано") {
    try {
      await navigator.clipboard.writeText(value);
      const previous = button.textContent;
      button.textContent = successText;
      setTimeout(() => {
        if (button.isConnected) button.textContent = previous;
      }, 1500);
    } catch {
      button.textContent = "Не удалось скопировать";
    }
  }

  function documentationBindEvents() {
    const view = documentQuery('[data-view="documentation"]');
    if (!view || view.dataset.documentationBound === "true") return;
    view.dataset.documentationBound = "true";
    view.addEventListener("click", (event) => {
      const open = event.target.closest("[data-documentation-open]");
      if (open) {
        documentationSelectDocument(open.dataset.documentationOpen || "");
        return;
      }
      const internal = event.target.closest("[data-documentation-link]");
      if (internal) {
        event.preventDefault();
        documentationSelectDocument(
          internal.dataset.documentationLink || "",
          internal.dataset.documentationAnchor || ""
        );
        return;
      }
      const jump = event.target.closest("[data-documentation-anchor-jump]");
      if (jump) {
        event.preventDefault();
        const anchor = jump.dataset.documentationAnchorJump || "";
        const document = documentationDocumentById(documentationSelectedId);
        if (document) documentationSelectDocument(document.id, anchor);
        return;
      }
      const copyCode = event.target.closest("[data-documentation-copy-code]");
      if (copyCode) {
        const code = copyCode.closest(".documentation-code")?.querySelector("code")?.textContent || "";
        void documentationCopy(code, copyCode);
        return;
      }
      if (event.target.closest("#documentationHome, #documentationBackToIndex")) {
        documentationShowIndex();
        return;
      }
      const copyLink = event.target.closest("#documentationCopyLink");
      if (copyLink) {
        void documentationCopy(globalThis.location?.href || "", copyLink, "Ссылка скопирована");
      }
    });
    const search = documentQuery("#documentationSearch");
    search?.addEventListener("input", () => {
      documentationSearchQuery = search.value.trim();
      documentationRenderNavigation();
      documentationRenderContent(documentationSelectedId ? documentationDocumentById(documentationSelectedId) : null);
    });
    documentQuery("#documentationClearSearch")?.addEventListener("click", () => {
      documentationSearchQuery = "";
      if (search) search.value = "";
      documentationRenderNavigation();
      documentationRenderContent(documentationSelectedId ? documentationDocumentById(documentationSelectedId) : null);
      search?.focus();
    });
  }

  function documentationBootstrap() {
    if (documentationReady || !documentationCatalog || documentationDocuments().length === 0) return;
    documentationCreateNavigationButton();
    documentationCreateView();
    if (!documentQuery('[data-view="documentation"]')) return;
    documentationReady = true;
    documentationBindEvents();
    documentationRenderNavigation();
    documentationRenderContent();

    globalThis.document.addEventListener(
      "click",
      (event) => {
        const target = event.target.closest("[data-view-target]")?.dataset.viewTarget;
        if (target && target !== documentationViewName) documentationSetVisible(false);
      },
      true
    );
    globalThis.document.addEventListener("keydown", (event) => {
      if (event.key === "F1") {
        event.preventDefault();
        documentationOpen();
      }
      if (
        event.key === "/" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(globalThis.document.activeElement?.tagName || "") &&
        !documentQuery('[data-view="documentation"]')?.hidden
      ) {
        event.preventDefault();
        documentQuery("#documentationSearch")?.focus();
      }
    });
    globalThis.addEventListener("hashchange", () => {
      const parsed = documentationParseHash();
      if (!parsed) return;
      documentationSetVisible(true);
      documentationSelectDocument(parsed.id, parsed.anchor, false);
    });
    const parsed = documentationParseHash();
    if (parsed) {
      documentationSetVisible(true);
      documentationSelectDocument(parsed.id, parsed.anchor, false);
    }
    globalThis.docomatorOpenDocumentation = documentationOpen;
  }

  if (globalThis.document?.readyState === "loading") {
    globalThis.document.addEventListener("DOMContentLoaded", documentationBootstrap, { once: true });
  } else {
    documentationBootstrap();
  }
}
