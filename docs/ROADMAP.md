# Roadmap завершения Оформлятора

Текущая версия: `0.6.2`.

Статус: `candidate / pilot`.

## Реализованный продуктовый контур

Кодовая часть основного пользовательского сценария завершена: пространства и данные, CSV/XLSX-импорт с preview/исправлением, библиотека шаблонов, детерминированные DOCX/XLSX bindings и renderer, публикации/доставка, backup/update/rollback, offline tooling, общий password gate и публичный stateless `/gost`.

В `0.6.2` мастер шаблона получил форматированное read-only представление сохранённого DOCX/XLSX. Оно показывает доступные Office-стили, таблицы/merge, колонтитулы и поддерживаемые raster-изображения, но не заменяет renderer и не сериализует браузерный DOM обратно в Office. Привязка поля остаётся существующей серверно проверяемой координатой.

## Что осталось до stable

Оставшаяся работа — не расширение функций, а внешняя release acceptance для одного точного candidate commit:

1. чистая offline-установка и полный target act Debian x86-64;
2. чистая offline-установка и полный target act Astra Linux 1.7 x86-64;
3. реальный LibreOffice и корпус минимум 20 DOCX + 20 XLSX, включая formatter/visual projection;
4. нагрузка 10/100/1000, restart/retry, SMTP/network-share partial failure;
5. отдельный backup/restore и update/rollback без потери данных;
6. ручная P5/accessibility-приёмка двумя новыми пользователями;
7. пустой `blockers.json` и успешный release-evidence gate;
8. защита `main`/ruleset с обязательными проверками GitHub.

До выполнения этих пунктов статус остаётся `candidate / pilot`. Наличие кода, CI или synthetic fixtures не заменяет целевые акты.
