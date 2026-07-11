# ADR-0002: Детерминированный renderer вместо генерируемого кода

- Статус: accepted
- Дата: 2026-07-11

## Контекст

Небольшая локальная LLM ненадёжно генерирует исполняемый код и может повредить Office-файл. Официальные документы требуют повторяемости и аудита.

## Решение

LLM возвращает только schema-constrained declarations: field candidates, mappings, formatter plans и RichTextBlocks. DOCX/XLSX изменяет versioned backend renderer. `eval`, dynamic `Function`, model-generated SQL и shell запрещены.

## Последствия

- новый тип операции требует зарегистрированного backend implementation;
- активированный template заполняется без LLM;
- результат можно regression-test и reverse-read;
- scope поддерживаемых Office-конструкций должен быть явно ограничен compatibility levels.
