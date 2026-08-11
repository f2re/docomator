#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UI = ROOT / "apps/api/ui"
DOCS = ROOT / "docs"


def write(path: Path, content: str) -> None:
    path.write_text(content.rstrip() + "\n", encoding="utf-8")


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one replacement, found {count}: {old[:80]!r}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def strip_prefix_to(path: Path, marker: str, header: str) -> None:
    text = path.read_text(encoding="utf-8")
    position = text.find(marker)
    if position <= 0:
        raise SystemExit(f"{path}: marker not found: {marker!r}")
    path.write_text(header.rstrip() + "\n\n" + text[position:], encoding="utf-8")


brand_tokens = r'''/*
 * Канонические визуальные токены «Оформлятора».
 * Нормативное описание: docs/BRANDING.md.
 * Компонентные CSS-файлы используют эти переменные и не объявляют собственную палитру темы.
 */

:root {
  color-scheme: light dark;

  --font: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans", "Liberation Sans", "DejaVu Sans", sans-serif;
  --font-data: ui-monospace, "Cascadia Mono", "Liberation Mono", "DejaVu Sans Mono", monospace;

  --background: #f3f1eb;
  --sidebar-surface: #ebe9e2;
  --glass: var(--sidebar-surface);
  --surface: #fffefa;
  --surface-2: #eeece5;
  --surface-hover: #e7e5de;
  --surface-raised: #fffefa;
  --text: #20262b;
  --muted: #59636b;
  --hint: #646d74;
  --border: rgba(32, 38, 43, 0.13);
  --border-strong: rgba(32, 38, 43, 0.24);

  --accent: #176b78;
  --accent-strong: #105763;
  --accent-fill: #176b78;
  --accent-fill-hover: #105763;
  --accent-soft: rgba(23, 107, 120, 0.12);
  --focus-ring: rgba(23, 107, 120, 0.32);

  --success: #1f6b4f;
  --success-soft: rgba(31, 107, 79, 0.12);
  --warning: #8a5a00;
  --warning-soft: rgba(138, 90, 0, 0.13);
  --danger: #a33b3f;
  --danger-soft: rgba(163, 59, 63, 0.12);
  --purple: #665b75;
  --purple-soft: rgba(102, 91, 117, 0.12);

  --shadow: 0 1px 2px rgba(32, 38, 43, 0.05);
  --shadow-soft: 0 8px 24px rgba(32, 38, 43, 0.07);
  --shadow-large: 0 20px 54px rgba(21, 25, 28, 0.22);

  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;

  --radius-control: 7px;
  --radius-panel: 10px;
  --radius-dialog: 14px;
  --radius: var(--radius-panel);

  --touch-target: 44px;
  --content-reading: 72ch;
  --content-max: 1500px;
  --sidebar: 248px;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --background: #151817;
    --sidebar-surface: #191d1b;
    --surface: #1e2220;
    --surface-2: #272c29;
    --surface-hover: #303632;
    --surface-raised: #222724;
    --text: #f3f2ed;
    --muted: #bdc4bf;
    --hint: #9ca59f;
    --border: rgba(243, 242, 237, 0.11);
    --border-strong: rgba(243, 242, 237, 0.22);
    --accent: #79c6d1;
    --accent-strong: #9adbe3;
    --accent-fill: #1f7184;
    --accent-fill-hover: #286174;
    --accent-soft: rgba(121, 198, 209, 0.14);
    --focus-ring: rgba(121, 198, 209, 0.34);
    --success: #70cf9e;
    --success-soft: rgba(112, 207, 158, 0.14);
    --warning: #e4b660;
    --warning-soft: rgba(228, 182, 96, 0.14);
    --danger: #ef8a8e;
    --danger-soft: rgba(239, 138, 142, 0.14);
    --purple: #c0b4cf;
    --purple-soft: rgba(192, 180, 207, 0.14);
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
    --shadow-soft: 0 10px 28px rgba(0, 0, 0, 0.25);
    --shadow-large: 0 24px 66px rgba(0, 0, 0, 0.48);
  }
}

:root[data-theme="dark"] {
  --background: #151817;
  --sidebar-surface: #191d1b;
  --surface: #1e2220;
  --surface-2: #272c29;
  --surface-hover: #303632;
  --surface-raised: #222724;
  --text: #f3f2ed;
  --muted: #bdc4bf;
  --hint: #9ca59f;
  --border: rgba(243, 242, 237, 0.11);
  --border-strong: rgba(243, 242, 237, 0.22);
  --accent: #79c6d1;
  --accent-strong: #9adbe3;
  --accent-fill: #1f7184;
  --accent-fill-hover: #286174;
  --accent-soft: rgba(121, 198, 209, 0.14);
  --focus-ring: rgba(121, 198, 209, 0.34);
  --success: #70cf9e;
  --success-soft: rgba(112, 207, 158, 0.14);
  --warning: #e4b660;
  --warning-soft: rgba(228, 182, 96, 0.14);
  --danger: #ef8a8e;
  --danger-soft: rgba(239, 138, 142, 0.14);
  --purple: #c0b4cf;
  --purple-soft: rgba(192, 180, 207, 0.14);
  --shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
  --shadow-soft: 0 10px 28px rgba(0, 0, 0, 0.25);
  --shadow-large: 0 24px 66px rgba(0, 0, 0, 0.48);
}
'''
write(UI / "brand-tokens.css", brand_tokens)

# Убираем три конкурирующих объявления темы. Компонентные правила остаются на месте.
strip_prefix_to(
    UI / "styles.css",
    "* { box-sizing: border-box; }",
    "/* Базовые компоненты UI. Палитра, типографика, геометрия и spacing задаются в brand-tokens.css. */",
)
strip_prefix_to(
    UI / "interface-hierarchy.css",
    "body {",
    "/* Семантическая иерархия компонентов. Канонические визуальные токены находятся в brand-tokens.css. */",
)
strip_prefix_to(
    UI / "interface-stability.css",
    "html {",
    """/*
 * Арт-направление «Оформлятора»: «Документный рабочий стол».
 * Операционная поверхность без маркетингового hero, стекла и карточного шума.
 * Визуальные токены вынесены в brand-tokens.css; здесь остаются только компонентные правила.
 */""",
)

replace_once(
    ROOT / "apps/api/src/ui-routes.ts",
    '      "interface-stability.css",\n      "template-row-flow.css"',
    '      "interface-stability.css",\n      "template-row-flow.css",\n      "brand-tokens.css"',
)

index = UI / "index.html"
replace_once(index, 'content="#f4f5f7" media="(prefers-color-scheme: light)"', 'content="#f3f1eb" media="(prefers-color-scheme: light)"')
replace_once(index, 'content="#111318" media="(prefers-color-scheme: dark)"', 'content="#151817" media="(prefers-color-scheme: dark)"')
replace_once(index, '          <span aria-hidden="true">❓</span>', '          <span aria-hidden="true">?</span>')
replace_once(
    index,
    '          <div class="hero-visual" aria-hidden="true"><div class="live-sheet"><span></span><span></span><span></span><span></span><span></span></div></div>\n',
    '',
)

favicon = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Оформлятор">
  <path d="M14 7h26l10 10v40H14z" fill="#fffefa" stroke="#176b78" stroke-width="3" stroke-linejoin="round"/>
  <path d="M40 7v11h10" fill="#dcebed" stroke="#176b78" stroke-width="3" stroke-linejoin="round"/>
  <path d="M22 28h20M22 36h20" fill="none" stroke="#20262b" stroke-width="3" stroke-linecap="round"/>
  <path d="M22 45h12" fill="none" stroke="#176b78" stroke-width="3" stroke-linecap="round"/>
</svg>'''
write(UI / "favicon.svg", favicon)

# Экран входа является отдельной публичной поверхностью и зеркалит бренд-токены без внешних assets.
password_gate = ROOT / "apps/api/src/password-gate.ts"
text = password_gate.read_text(encoding="utf-8")
old_meta = '<meta name="color-scheme" content="light dark"><title>Вход — Оформлятор</title><style>\n'
new_meta = '<meta name="color-scheme" content="light dark"><meta name="theme-color" content="#f3f1eb" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#151817" media="(prefers-color-scheme: dark)"><title>Вход — Оформлятор</title><style>\n'
if text.count(old_meta) != 1:
    raise SystemExit("password-gate: login meta marker not found exactly once")
text = text.replace(old_meta, new_meta, 1)
start = text.find(':root{font-family:Inter')
end = text.find('</style><script', start)
if start < 0 or end < 0:
    raise SystemExit("password-gate: legacy login CSS marker not found")
login_css = r''':root{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans","Liberation Sans","DejaVu Sans",sans-serif;color-scheme:light dark;--bg:#f3f1eb;--surface:#fffefa;--surface-2:#eeece5;--text:#20262b;--muted:#59636b;--border:rgba(32,38,43,.18);--border-strong:rgba(32,38,43,.30);--accent:#176b78;--accent-strong:#105763;--danger:#a33b3f;--focus:rgba(23,107,120,.32)}*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--text)}.card{width:min(420px,100%);background:var(--surface);border:1px solid var(--border);border-left:4px solid var(--accent);border-radius:14px;padding:28px;box-shadow:0 8px 24px rgba(32,38,43,.07)}h1{margin:0 0 8px;font-size:28px;line-height:1.15;letter-spacing:-.02em}p{margin:0 0 22px;color:var(--muted);line-height:1.5}label{display:block;font-weight:650;margin-bottom:8px}input{width:100%;min-height:46px;padding:10px 12px;border:1px solid var(--border-strong);border-radius:7px;background:var(--surface);color:var(--text);font:inherit}button{width:100%;min-height:46px;margin-top:14px;border:1px solid var(--accent);border-radius:7px;background:var(--accent);color:#fff;font:inherit;font-weight:700;cursor:pointer}button:hover{background:var(--accent-strong);border-color:var(--accent-strong)}input:focus-visible,button:focus-visible{outline:3px solid var(--accent-strong);outline-offset:2px}button:disabled{opacity:.55;cursor:default}.error{margin-top:14px;color:var(--danger);font-size:14px;line-height:1.45}.brand{margin-bottom:18px;color:var(--muted);font-size:13px;font-weight:650}@media(prefers-color-scheme:dark){:root{--bg:#151817;--surface:#1e2220;--surface-2:#272c29;--text:#f3f2ed;--muted:#bdc4bf;--border:rgba(243,242,237,.14);--border-strong:rgba(243,242,237,.28);--accent:#1f7184;--accent-strong:#286174;--danger:#ef8a8e;--focus:rgba(121,198,209,.34)}.card{box-shadow:0 10px 28px rgba(0,0,0,.25)}}'''
text = text[:start] + login_css + text[end:]
text = text.replace('"Пароль Оформлятор ещё не настроен на сервере."', '"Пароль «Оформлятора» ещё не настроен на сервере."')
password_gate.write_text(text, encoding="utf-8")

branding = '''# Бренд-система «Оформлятора»

Статус: **нормативный визуальный договор продукта**  
Дата актуализации: **2026-08-11**  
Выбранное направление: **«Документный рабочий стол»**.

Пользовательское название продукта — **«Оформлятор»**. Визуальная система должна делать сложную работу с данными и документами спокойной, точной и предсказуемой. Она не должна выглядеть как маркетинговый сайт, панель базы данных или копия конкретной операционной системы.

История выбора из трёх разработанных направлений зафиксирована в [BRAND_DESIGN_STUDY.md](BRAND_DESIGN_STUDY.md). В runtime используется только выбранная система: переключателя «дизайн A/B/C» нет.

## 1. Характер продукта

Четыре свойства определяют любое визуальное решение:

1. **Документность** — бумажная логика, реестровые строки, ясные уровни и физически понятная структура.
2. **Спокойствие** — нейтральный фон, один акцент, минимум декоративных сигналов и анимации.
3. **Точность** — табличные цифры, устойчивые размеры, видимое состояние, однозначные действия.
4. **Автономность** — никаких CDN, remote fonts, сетевых иллюстраций или зависимости внешнего бренда.

Фирменный образ — **рабочий документ с бирюзовыми чернилами**, а не «магия ИИ». ИИ остаётся необязательным помощником и не определяет оформление интерфейса.

## 2. Знак и название

Основной знак — простой лист документа с загнутым углом и структурными строками. Он строится локальным SVG без градиента, фотографии и внешнего ресурса.

Правила:

- в интерфейсе используется слово **«Оформлятор»** без англоязычного дубля;
- знак может использоваться отдельно только там, где название уже очевидно: favicon, компактная навигация;
- знак не вращается, не пульсирует и не превращается в индикатор загрузки;
- декоративные маскоты, псевдо-3D и «AI sparkles» не используются;
- под названием в оболочке допустима короткая служебная подпись **«Локальный контур»**.

## 3. Каноническая палитра

Цвет несёт роль, а не украшение. Точные значения живут в `apps/api/ui/brand-tokens.css`; эта таблица является их нормативным описанием.

### Светлая тема

| Роль | Значение | Применение |
|---|---|---|
| рабочий фон | `#F3F1EB` | общий canvas |
| боковая поверхность | `#EBE9E2` | навигация и служебные зоны |
| основная поверхность | `#FFFEFA` | формы, рабочие панели, карточки |
| вторичная поверхность | `#EEECE5` | нейтральные области, группы |
| hover | `#E7E5DE` | наведение без дополнительной тени |
| основной текст | `#20262B` | заголовки и содержание |
| вторичный текст | `#59636B` | пояснения |
| подсказка | `#646D74` | третичный текст при достаточном контрасте |
| чернила / accent | `#176B78` | текущее действие, этап, связь |
| сильный accent | `#105763` | hover/focus и более сильный акцент |
| успех | `#1F6B4F` | завершено и сохранено |
| предупреждение | `#8A5A00` | требуется внимание |
| ошибка | `#A33B3F` | проблема и блокирующее состояние |
| справочный | `#665B75` | вторичная справочная семантика |

### Тёмная тема

| Роль | Значение |
|---|---|
| рабочий фон | `#151817` |
| боковая поверхность | `#191D1B` |
| основная поверхность | `#1E2220` |
| вторичная поверхность | `#272C29` |
| hover | `#303632` |
| основной текст | `#F3F2ED` |
| вторичный текст | `#BDC4BF` |
| подсказка | `#9CA59F` |
| accent | `#79C6D1` |
| заливка основной кнопки | `#1F7184` |
| успех | `#70CF9E` |
| предупреждение | `#E4B660` |
| ошибка | `#EF8A8E` |
| справочный | `#C0B4CF` |

Акцентный цвет не используется как единственный носитель смысла. Состояние всегда имеет текст, форму/маркер и доступное имя.

## 4. Типографика

Внешние шрифты запрещены.

Основной стек:

```text
system-ui · -apple-system · BlinkMacSystemFont · Segoe UI
Noto Sans · Liberation Sans · DejaVu Sans · sans-serif
```

Данные, время, числа и технические значения:

```text
ui-monospace · Cascadia Mono · Liberation Mono · DejaVu Sans Mono · monospace
```

Норматив:

- базовый размер: `16 px`, межстрочный интервал около `1.45–1.52`;
- H1 на широком экране: примерно `25–31 px`, на узком — около `24 px`;
- H2: примерно `20–24 px`;
- основной рабочий текст: `14–16 px`;
- служебный текст не уменьшается ниже `11 px` и остаётся контрастным;
- числа и время используют tabular numerals;
- декоративный uppercase, сверхжирные marketing headings и длинные letter-spacing не используются;
- читаемый текстовый блок ограничивается примерно `72ch`, если это не таблица/реестр.

## 5. Отступы и плотность

Базовая шкала: **`4 · 8 · 12 · 16 · 24 · 32 · 48 px`**.

| Токен | Значение | Типовое применение |
|---|---:|---|
| `space-1` | 4 px | связь подписи и значения |
| `space-2` | 8 px | внутренний компактный gap |
| `space-3` | 12 px | строки и компактные controls |
| `space-4` | 16 px | стандартный внутренний отступ |
| `space-6` | 24 px | секции и узкий page gutter |
| `space-8` | 32 px | крупная группа |
| `space-12` | 48 px | разделение самостоятельных блоков |

Не допускается случайная сетка из `13/17/21/29 px`, если значение не вызвано реальным размером элемента. Вертикальная плотность должна позволять работать с длинными списками без ощущения «админской таблицы из 2005 года» и без огромных пустых карточек.

## 6. Геометрия и поверхности

Три радиуса:

- control — `7 px`;
- panel — `10 px`;
- dialog — `14 px`.

Полный круг разрешён для точки состояния, аватара или действительно круглой icon-button. Универсальные `18–32 px` скругления и pill-форма обычных кнопок запрещены.

Три уровня поверхности:

1. **canvas** — фон приложения;
2. **work surface** — формы, списки, карточки и рабочие секции;
3. **raised** — dialog, popover, floating menu.

Тень не является способом отделить каждую карточку. Обычные панели используют тонкую границу. Тени зарезервированы для поднятого слоя: `0 8px 24px` в светлой теме и более плотный тёмный эквивалент.

## 7. Основной паттерн — маршрут документа

Основной путь продукта всегда читается как:

```text
1. Данные → 2. Шаблон → 3. Выпуск → 4. Результат
```

Главная страница показывает текущую задачу и этот маршрут, а не marketing hero. Этапы используют фактическое backend-состояние. Завершённый этап имеет зелёный маркер, текущий — акцент «чернил», будущий — нейтральный вид, проблема — красный/янтарный акцент с текстом действия.

## 8. Кнопки, формы и списки

- На экране одна доминирующая заливная кнопка, продолжающая основной процесс.
- Вторичные действия — border/neutral surface; опасное действие не конкурирует с основным.
- Минимальная интерактивная зона — **44 × 44 CSS px**.
- Input/select/textarea используют control radius и явную рамку; focus-visible всегда заметен.
- Нетривиальное поле получает короткую вторичную подсказку, а не абзац документации.
- Таблицы и большие списки выглядят как реестр: строки и разделители важнее отдельных карточек.
- Горизонтальный scroll допускается только внутри явно табличного компонента; вся страница на `320 px` не прокручивается по горизонтали.
- Ошибка показывает место, проблемное значение и конкретное исправление; введённые данные сохраняются.

## 9. Иконки и графика

Предпочтение: простые локальные line-SVG или устойчивые монохромные символы. Emoji не является частью фирменного набора и не используется как единственная иконка действия. Цветные emoji могут отображаться по-разному на целевых Linux-системах, поэтому критическая навигация от них не зависит.

Декоративные иллюстрации, градиентные blobs, стекло, backdrop blur и фоновые изображения не используются в рабочем UI.

## 10. Motion

- обычный hover/focus transition: примерно `120–160 ms`;
- движение не используется для удержания внимания;
- загрузка не имитирует процент, если реального прогресса нет;
- при `prefers-reduced-motion: reduce` переходы и анимации отключаются либо сводятся к мгновенному изменению состояния.

## 11. Адаптивность и доступность

Обязательные контрольные ширины: **320 / 768 / 1440 px**.

- breakpoint перехода от боковой к нижней навигации — около `820 px`;
- 200% text zoom не создаёт page-level horizontal overflow;
- keyboard route, visible focus и возврат фокуса после dialog обязательны;
- light/dark/system используют одинаковую семантику состояний;
- контраст текста и интерактивных границ — не ниже применимых требований WCAG AA;
- `prefers-reduced-motion` соблюдается;
- длинные русские подписи и значения не перекрывают controls.

## 12. Тон текста

Текст — короткий и операционный.

Каждая ошибка отвечает:

1. что произошло;
2. сохранены ли данные;
3. что делать дальше.

Не показываются UUID, внутренние пути, сырые SQLite/OOXML ошибки и англоязычные enum без необходимости. Термины «раздел данных», «шаблон», «выпуск», «результат» используются последовательно. Диагностика находится на втором уровне интерфейса.

## 13. Запрещённые визуальные приёмы

Не добавлять без отдельного обоснования:

- marketing hero и отдельную декоративную иллюстрацию главной;
- сине-фиолетовые gradient backgrounds;
- glassmorphism/backdrop blur;
- большие универсальные скругления;
- несколько одинаково ярких primary actions;
- цвет без текстового значения;
- remote fonts/CDN/images;
- анимацию ради анимации;
- технические идентификаторы в основном пользовательском потоке;
- дизайн, который хорошо выглядит только на 1440 px и ломается при 320 px или 200% zoom.

## 14. Реализация и контроль дрейфа

Канонические визуальные значения находятся в `apps/api/ui/brand-tokens.css`. Компонентные стили в `styles.css`, `interface-hierarchy.css`, `interface-stability.css` и feature CSS используют эти переменные и не определяют отдельную тему.

`npm run check:branding` проверяет название, обязательные brand surfaces, палитру, scale отступов, радиусы, favicon, theme-color и отсутствие возврата старых конкурирующих `:root`-палитр. Полный browser CI дополнительно проверяет адаптивность и реальные пользовательские сценарии.

Изменение доминирующей палитры, spacing scale, геометрии или характера бренда требует одновременного изменения этого документа, `brand-tokens.css` и regression checks. Добавлять ещё один «финальный override CSS» вместо изменения канонических токенов запрещено.

## 15. Технические идентификаторы совместимости

Исторический технический namespace `docomator` сохраняется без переименования. К нему относятся:

- репозиторий `f2re/docomator`;
- npm-пакеты `@docomator/*` и имя корневого пакета `docomator`;
- переменные окружения `DOCOMATOR_*`;
- systemd-службы и служебные имена `docomator-*`;
- пути `/opt/docomator`, `/etc/docomator` и служебные каталоги;
- имена автономных архивов `docomator-<version>-...`;
- cookie `docomator_session`;
- внутренние OOXML-префиксы и маркеры `_DOCOMATOR_*`.

Это машинные контракты установки, обновления, восстановления, API/пакетов и совместимости созданных документов, а не отображаемый бренд. Их переименование требует отдельной миграционной итерации.
'''
write(DOCS / "BRANDING.md", branding)

study = '''# Исследование визуальных направлений «Оформлятора»

Дата: **2026-08-11**  
Результат: выбран вариант **A — «Документный рабочий стол»**.

Этот документ фиксирует три разработанных направления и причину выбора. Это не набор пользовательских тем: в runtime остаётся одна согласованная система.

## Критерии

Каждый вариант оценивался по шкале 1–5: соответствие предметной области, читаемость длинных русских данных, плотность рабочего интерфейса, светлая/тёмная тема, доступность, отсутствие маркетингового шума и стоимость безопасного внедрения в существующий UI.

## A. «Документный рабочий стол» — выбран

Образ: тёплая рабочая поверхность, листы и реестры, бирюзовые чернила, тонкие границы.

Палитра: `#F3F1EB / #FFFEFA / #20262B / #176B78`; состояния — `#1F6B4F / #8A5A00 / #A33B3F`.

Геометрия: `7 / 10 / 14 px`; spacing: `4 / 8 / 12 / 16 / 24 / 32 / 48 px`.

Сильные стороны:

- напрямую связан с документами и реестрами;
- спокойный и не похож на developer/admin console;
- хорошо переносит длинные списки и табличные данные;
- не требует иллюстраций, внешних шрифтов и эффектов;
- уже близок к фактическому лучшему слою существующего UI, поэтому риск регрессии минимален.

Оценка: **34/35**.

## B. «Строгий реестр»

Образ: нейтральная корпоративная система, холодный серый canvas, белые таблицы, приглушённый slate-blue accent.

Палитра: `#F4F5F6 / #FFFFFF / #20242A / #315E77`; состояния более десатурированные. Геометрия `6 / 8 / 12 px`.

Сильные стороны: высокая плотность, строгие таблицы, минимальная декоративность.

Недостатки: слишком близок к административной системе/учётной панели; слабее выражает документную природу продукта; на длительной работе холодная палитра визуально жёстче.

Оценка: **28/35**.

## C. «Технический чертёж»

Образ: инженерная рабочая поверхность, холодный светлый фон, indigo + cyan, более выраженная сетка и координатная логика.

Палитра: `#F1F5F7 / #FBFCFD / #1E2933 / #3B5C8A / #3D8E9D`; геометрия `4 / 8 / 12 px`.

Сильные стороны: хорошо подчёркивает точность, структуру и техническую надёжность.

Недостатки: усиливает ощущение инженерного инструмента и диагностики, а не понятного приложения для оператора; сетка и холодные цвета создают лишний визуальный слой; слабее соответствует требованию «не панель БД».

Оценка: **24/35**.

## Решение

Выбран **«Документный рабочий стол»**. Он лучше всего совмещает предметную метафору, рабочую плотность, простоту русского интерфейса и автономность. Внедряется не как новый декоративный слой, а как консолидация существующих стилей вокруг одного token source.

Отклонённые варианты остаются только историей решения. Новые экраны не должны смешивать их палитры или геометрию с выбранной системой.
'''
write(DOCS / "BRAND_DESIGN_STUDY.md", study)

# Документация: один визуальный источник, без конкурирующих нормативных описаний.
replace_once(
    DOCS / "README.md",
    "| [BRANDING.md](BRANDING.md) | пользовательское название продукта и неизменяемые технические идентификаторы совместимости |",
    "| [BRANDING.md](BRANDING.md) | нормативная бренд-система: знак, палитра, типографика, spacing, геометрия, состояния и правила UI |\n| [BRAND_DESIGN_STUDY.md](BRAND_DESIGN_STUDY.md) | три исследованных визуальных направления и обоснование выбранного варианта |",
)

hierarchy = DOCS / "INTERFACE_HIERARCHY.md"
replace_once(hierarchy, "# Визуальная иерархия и арт-направление Оформлятор", "# Визуальная иерархия «Оформлятора»")
replace_once(hierarchy, "Дата актуализации: **2026-07-30**.", "Дата актуализации: **2026-08-11**.")
replace_once(
    hierarchy,
    "Связанные документы: [техническое задание на интерфейс](UX_UI_SPECIFICATION.md), [план упрощения](UX_SIMPLIFICATION_PLAN.md), [дорожная карта](ROADMAP.md), [аудит интерфейса](INTERFACE_AUDIT_2026-07-30.md).",
    "Связанные документы: [бренд-система](BRANDING.md), [техническое задание на интерфейс](UX_UI_SPECIFICATION.md), [план упрощения](UX_SIMPLIFICATION_PLAN.md), [дорожная карта](ROADMAP.md), [аудит интерфейса](INTERFACE_AUDIT_2026-07-30.md).",
)
replace_once(
    hierarchy,
    "## 2. Арт-направление «Документный рабочий стол»\n\nВизуальная система выводится из предметной области:",
    "## 2. Арт-направление «Документный рабочий стол»\n\nТочная палитра, spacing scale, радиусы, типографика, знак и запреты определены в [BRANDING.md](BRANDING.md). Этот документ фиксирует композицию и поведение интерфейса, а не дублирует token source.\n\nВизуальная система выводится из предметной области:",
)

ux = DOCS / "UX_UI_SPECIFICATION.md"
replace_once(ux, "Последнее обновление: **2026-07-15**", "Последнее обновление: **2026-08-11**")
replace_once(
    ux,
    "Связанные документы: [требования](REQUIREMENTS.md), [основное ТЗ](TECHNICAL_SPECIFICATION.md), [архитектура](ARCHITECTURE.md), [пространства и аудитории](SPACES_AND_AUDIENCES.md).",
    "Связанные документы: [требования](REQUIREMENTS.md), [бренд-система](BRANDING.md), [визуальная иерархия](INTERFACE_HIERARCHY.md), [основное ТЗ](TECHNICAL_SPECIFICATION.md), [архитектура](ARCHITECTURE.md), [пространства и аудитории](SPACES_AND_AUDIENCES.md).",
)
replace_once(
    ux,
    "Практическая система уровней поверхностей, смысловых цветов, отступов и четырёх этапов основного процесса зафиксирована в [концепции визуальной иерархии](INTERFACE_HIERARCHY.md).",
    "Канонические знак, палитра, типографика, spacing, радиусы и визуальные запреты зафиксированы в [бренд-системе](BRANDING.md). Композиция экранов и четыре этапа основного процесса закреплены в [визуальной иерархии](INTERFACE_HIERARCHY.md).",
)
replace_once(
    ux,
    "- карточки с мягкими границами и умеренными тенями;",
    "- рабочие поверхности с тонкими границами; тени только у действительно поднятых слоёв;",
)

replace_once(
    DOCS / "ARCHITECTURE.md",
    "- использует единую систему design tokens и state components;",
    "- использует единый визуальный token source `apps/api/ui/brand-tokens.css`; нормативные значения закреплены в `docs/BRANDING.md`;",
)

replace_once(
    DOCS / "ROADMAP.md",
    "- канонический единый UI без параллельных поколений экранов;",
    "- канонический единый UI без параллельных поколений экранов;\n- бренд-система «Документный рабочий стол» сведена к одному visual token source; старые конкурирующие палитры и декоративный hero удалены;",
)

replace_once(
    UI / "AGENTS.md",
    "Источник требований — `docs/UX_UI_SPECIFICATION.md` и раздел UX в `docs/REQUIREMENTS.md`.",
    "Источник требований — `docs/UX_UI_SPECIFICATION.md`, `docs/BRANDING.md`, `docs/INTERFACE_HIERARCHY.md` и раздел UX в `docs/REQUIREMENTS.md`. Палитра, spacing и геометрия берутся только из `brand-tokens.css`.",
)

notes = DOCS / "RELEASE_NOTES.md"
notes_text = notes.read_text(encoding="utf-8")
needle = "- Версия и статус выпуска не меняются: `0.1.0 / candidate / pilot`.\n"
addition = """- Версия и статус выпуска не меняются: `0.1.0 / candidate / pilot`.
- Разработаны три визуальных направления; выбран «Документный рабочий стол» как наиболее спокойный, предметный и совместимый с длинными реестрами.
- Палитра, типографика, spacing, радиусы и семантические цвета сведены в один `brand-tokens.css`; старые конкурирующие theme-блоки удалены из базового, hierarchy и stability CSS.
- Экран входа, browser theme-color и favicon приведены к той же тёплой бумажно-бирюзовой системе; старый сине-фиолетовый gradient favicon и скрытая hero-иллюстрация удалены.
- `check:branding` теперь контролирует не только название, но и visual token source, ключевые surfaces и отсутствие возврата старых палитр.
"""
if notes_text.count(needle) != 1:
    raise SystemExit("release notes branding marker not found exactly once")
notes.write_text(notes_text.replace(needle, addition, 1), encoding="utf-8")

checker = r'''import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const legacyBrand = "Doco" + "mator";
const expectedBrand = "Оформлятор";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: root })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

async function inspectText(relativePath) {
  const absolutePath = path.join(root, relativePath);
  const buffer = await fs.readFile(absolutePath);
  if (buffer.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return null;
  }
}

function requireFragment(findings, text, relativePath, fragment) {
  if (!text?.includes(fragment)) findings.push(`${relativePath}: отсутствует ${fragment}`);
}

export async function checkBranding() {
  const findings = [];
  for (const relativePath of trackedFiles()) {
    const text = await inspectText(relativePath);
    if (text?.includes(legacyBrand)) findings.push(relativePath);
  }

  const required = [
    "README.md",
    "docs/BRANDING.md",
    "docs/BRAND_DESIGN_STUDY.md",
    "apps/api/ui/index.html",
    "apps/api/ui/help-center.js",
    "apps/api/src/password-gate.ts",
    "apps/api/ui/brand-tokens.css"
  ];
  for (const relativePath of required) {
    const text = await inspectText(relativePath);
    if (!text?.includes(expectedBrand)) {
      findings.push(`${relativePath}: отсутствует пользовательское имя ${expectedBrand}`);
    }
  }

  const tokensPath = "apps/api/ui/brand-tokens.css";
  const tokens = await inspectText(tokensPath);
  const canonicalTokens = [
    "--background: #f3f1eb;",
    "--sidebar-surface: #ebe9e2;",
    "--surface: #fffefa;",
    "--text: #20262b;",
    "--accent: #176b78;",
    "--success: #1f6b4f;",
    "--warning: #8a5a00;",
    "--danger: #a33b3f;",
    "--space-1: 4px;",
    "--space-2: 8px;",
    "--space-3: 12px;",
    "--space-4: 16px;",
    "--space-6: 24px;",
    "--space-8: 32px;",
    "--space-12: 48px;",
    "--radius-control: 7px;",
    "--radius-panel: 10px;",
    "--radius-dialog: 14px;",
    "--touch-target: 44px;"
  ];
  for (const token of canonicalTokens) requireFragment(findings, tokens, tokensPath, token);

  for (const relativePath of [
    "apps/api/ui/styles.css",
    "apps/api/ui/interface-hierarchy.css",
    "apps/api/ui/interface-stability.css"
  ]) {
    const text = await inspectText(relativePath);
    if (/^\s*:root(?:\[|\s*\{)/mu.test(text ?? "")) {
      findings.push(`${relativePath}: найден конкурирующий корневой theme-блок`);
    }
    if (text?.includes("--accent:")) {
      findings.push(`${relativePath}: палитра должна жить только в brand-tokens.css`);
    }
  }

  const routesPath = "apps/api/src/ui-routes.ts";
  const routes = await inspectText(routesPath);
  requireFragment(findings, routes, routesPath, '"brand-tokens.css"');

  const indexPath = "apps/api/ui/index.html";
  const index = await inspectText(indexPath);
  requireFragment(findings, index, indexPath, 'content="#f3f1eb" media="(prefers-color-scheme: light)"');
  requireFragment(findings, index, indexPath, 'content="#151817" media="(prefers-color-scheme: dark)"');
  if (index?.includes('class="hero-visual"')) findings.push(`${indexPath}: декоративная hero-иллюстрация не должна возвращаться`);

  const faviconPath = "apps/api/ui/favicon.svg";
  const favicon = (await inspectText(faviconPath))?.toLowerCase() ?? "";
  if (favicon.includes("lineargradient") || favicon.includes("#6ea8ff") || favicon.includes("#6f6ce8")) {
    findings.push(`${faviconPath}: найден старый gradient/blue brand`);
  }
  if (!favicon.includes("#176b78") || !favicon.includes("#fffefa")) {
    findings.push(`${faviconPath}: знак не использует канонические бумагу и чернила`);
  }

  const loginPath = "apps/api/src/password-gate.ts";
  const login = (await inspectText(loginPath))?.toLowerCase() ?? "";
  for (const fragment of ["#f3f1eb", "#fffefa", "#176b78", "#151817"]) {
    if (!login.includes(fragment)) findings.push(`${loginPath}: login surface не содержит ${fragment}`);
  }
  if (login.includes("font-family:inter")) findings.push(`${loginPath}: login не должен вводить отдельный шрифт Inter`);

  const brandingPath = "docs/BRANDING.md";
  const branding = await inspectText(brandingPath);
  for (const fragment of ["Документный рабочий стол", "4 · 8 · 12 · 16 · 24 · 32 · 48", "44 × 44 CSS px", "brand-tokens.css"]) {
    requireFragment(findings, branding, brandingPath, fragment);
  }

  if (findings.length > 0) {
    throw new Error(`Проверка бренда не пройдена:\n- ${findings.join("\n- ")}`);
  }
}

const invokedPath = process.argv[1] === undefined ? "" : path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  checkBranding().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
'''
write(ROOT / "scripts/ci/check-branding.mjs", checker)

print("Brand system prepared")
