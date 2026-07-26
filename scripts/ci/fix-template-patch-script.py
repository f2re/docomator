from pathlib import Path

structure_path = Path(__file__).with_name("apply-template-structure-preview-csp.py")
structure = structure_path.read_text(encoding="utf-8")

css_old = '''.generation-progress-bar {
  height: 0.65rem;
  overflow: hidden;
  background: var(--surface-2);
  border-radius: 999px;
}

.generation-progress-bar span {
  display: block;
  width: var(--progress);
  height: 100%;
  background: var(--accent);
  border-radius: inherit;
}'''
css_new = '''.generation-progress-bar {
  height: 0.55rem;
  overflow: hidden;
  border-radius: 999px;
  background: var(--surface-2);
  border: 1px solid var(--border);
}

.generation-progress-bar > span {
  display: block;
  height: 100%;
  width: var(--progress, 0%);
  background: var(--accent);
  transition: width 180ms ease;
}'''
if structure.count(css_old) != 1:
    raise RuntimeError("Не найдено исходное ожидание CSS полосы выпуска.")
structure = structure.replace(css_old, css_new, 1)

heading_old = '''# Предварительный просмотр и активация шаблона'''
heading_new = '''# 👁️ Предварительный просмотр и активация шаблонов'''
if structure.count(heading_old) != 1:
    raise RuntimeError("Не найдено ожидание прежнего заголовка руководства.")
structure = structure.replace(heading_old, heading_new, 1)
structure_path.write_text(structure, encoding="utf-8")

preview_path = Path(__file__).with_name("apply-optional-template-preview.py")
preview = preview_path.read_text(encoding="utf-8")
paragraph_old = '''После пробного заполнения оператор обязан создать PDF, просмотреть его и только затем активировать версию.'''
paragraph_new = '''Предварительный просмотр не является основным способом изменения DOCX/XLSX. Технические привязки и пробные значения создаёт детерминированный компилятор; LibreOffice только формирует проверочную PDF-копию.'''
if preview.count(paragraph_old) != 1:
    raise RuntimeError("Не найдено устаревшее ожидание текста руководства.")
preview = preview.replace(paragraph_old, paragraph_new, 1)
preview_path.write_text(preview, encoding="utf-8")

print("updated patch expectations for CSS and template activation guide")
