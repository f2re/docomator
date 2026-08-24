## Причина

<!-- Какую первопричину устраняет изменение? -->

## Что изменено

<!-- Минимальный вертикальный срез: domain/API/storage/UI/tests/docs, где применимо. -->

## Инварианты

- [ ] пространства не смешиваются;
- [ ] runtime/offline-контракт не ослаблен;
- [ ] данные после ошибки/обновления не теряются;
- [ ] LLM не получил shell/SQL/path/OOXML execution;
- [ ] применённые миграции не изменялись.

## Версия

- [ ] SemVer bump выполнен, если изменилось поставляемое поведение продукта;
- [ ] либо изменение только CI/tests/docs/release evidence и bump не требуется.

## Проверки

- [ ] regression test для исправленного дефекта/нового контракта;
- [ ] `npm run check`;
- [ ] Chromium user flows + real-stack;
- [ ] offline archive assembly/verification;
- [ ] документация и release notes синхронизированы, если применимо.

## Перед merge

- [ ] head SHA повторно проверен;
- [ ] PR mergeable;
- [ ] review threads закрыты;
- [ ] обязательные jobs зелёные;
- [ ] squash merge.
