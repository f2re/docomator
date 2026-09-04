# Политика безопасности

Статус выпуска: `candidate`

Канал выпуска: `pilot`

Текущая версия: `0.7.0`.

Это предварительный выпуск. До завершения целевой приёмки, восстановления резервной копии и проверки реальных документов Оформлятор нельзя использовать для штатной обработки персональных или ограниченных данных; допускается только контролируемый пилот на обезличенных данных.

## Граница доверия

Оформлятор работает в общем доверенном корпоративном контуре. Действующий [ADR-0011](docs/adr/0011-shared-access-code-gate.md) задаёт один общий **4-значный код доступа** без имени пользователя, учётной записи, ролей, ACL и персональных кабинетов. Код не идентифицирует сотрудника: все клиенты с открытой сессией имеют одинаковые прикладные возможности.

Код доступа — только дополнительный барьер от случайного открытия рабочей области. Фактическая security boundary — доверенная сеть, firewall/reverse proxy, bind address, HTTPS, системный пользователь, права каталогов и systemd sandbox. Публиковать основную рабочую область в Интернет или недоверенную сеть, полагаясь только на четыре цифры, запрещено.

Узкое исключение [ADR-0010](docs/adr/0010-public-stateless-document-formatting.md): `/gost` и его stateless API могут работать без workspace session. Этот контур не получает `spaceId`, не читает и не пишет SQLite/object store, не использует LLM/LibreOffice/внешнюю сеть и не сохраняет пользовательский документ. Расширять публичный allowlist на сохраняемые данные без отдельного ADR запрещено.

При развёртывании обязательно:

- не публиковать основную рабочую область напрямую в Интернет;
- использовать HTTPS на reverse proxy для удалённых рабочих мест;
- ограничить сетевую доступность firewall/reverse proxy и согласованным trusted segment;
- оставить новую установку закрытой до явного задания четырёх цифр;
- хранить только salted parameterized scrypt hash кода и отдельный случайный session secret;
- хранить `/etc/docomator/docomator.env`, базу, object store и backup с минимально необходимыми системными правами;
- не считать `x-actor-id` подтверждением личности — это только непроверенная audit label;
- предоставлять SQLite admin/export только рабочим местам, которым уже разрешён полный доступ к общим данным.

Встроенный сервер не использует HTTP Basic Authentication и не выдаёт `WWW-Authenticate`. Если браузер показывает нативное окно «имя пользователя / пароль», challenge создаёт внешний reverse proxy или иной инфраструктурный слой, а не Оформлятор.

## Код доступа и сессия

Канонический config key — `DOCOMATOR_ACCESS_CODE_HASH`. Открытые четыре цифры не сохраняются и не журналируются. Проверка использует scrypt и constant-time comparison производного ключа. Успешный ввод создаёт подписанную `HttpOnly`, `SameSite=Strict` cookie с ограниченным TTL; при HTTPS добавляется `Secure`. Изменяющий запрос с чужим `Origin` отклоняется. Повторные неверные попытки ограничиваются локальным backoff.

Канонический экран — `/access`. Исторический адрес `/login` не содержит формы логина/пароля и существует только как redirect-only compatibility path на `/access`; `next=/login` и `next=/access` нормализуются во избежание циклических переходов. При действующей session прямой переход на `/access` возвращает пользователя в рабочую область без повторного запроса кода.

Смена или сброс кода выполняются локально:

```bash
sudo /opt/docomator/current/set-access-code.sh
sudo /opt/docomator/current/reset-access-code.sh
# или
sudo /opt/docomator/current/first-run.sh --reset-code
```

Recovery не требует старого кода, не меняет документы/пространства/шаблоны и ротирует session secret, поэтому ранее выданные сессии перестают действовать.

Применённая миграция `0031_shared_access_password.sql` неизменяема. Её исторические table/column names скрыты внутри adapter. `DOCOMATOR_ACCESS_PASSWORD_HASH`, `set-password.sh` и `reset-password.sh` допустимы только в локализованном upgrade/rollback compatibility layer; новая конфигурация и текущий UI/API их не используют.

Пространства остаются жёсткой границей пользовательских данных. Общая trusted-workspace session позволяет явно переключиться в другой раздел, но не превращает его данные в глобальный read/list context. В `0.6.8` list/read/download/view/delete результатов документов требуют явный `spaceId`; результат другого раздела не раскрывается и не изменяется через текущий раздел. Access-code gate и публичный `/gost` не должны ослаблять `spaceId` validation, database constraints/triggers и отрицательные тесты с двумя пространствами.

Добавление пользователей, персональной идентификации, ролей, ACL, MFA или внешнего IAM требует отдельного ADR и новой threat model.

## Недоверенные Office-документы и Visual Template Studio

DOCX/XLSX считаются недоверенным входом. Визуальная разметка не исполняет HTML, макросы, OLE, ActiveX, внешние relationship target или код из документа. Read-only Visual IR вычисляется из проверенного immutable source и никогда не сериализуется обратно в Office.

Обязательные ограничения:

- allowlist Office XML/media parts;
- запрет `DOCTYPE`/`ENTITY` и неподдерживаемых XML declarations;
- лимиты compressed/expanded/actual streamed bytes и числа entries;
- внешние relationships не загружаются;
- browser projection показывает только разрешённые локальные raster media в установленных пределах;
- значения Office styling нормализуются и ограничиваются allowlist/range;
- binding остаётся серверно проверяемой координатой, а не DOM selector/HTML fragment;
- visual-layout scoped по `spaceId + draft`, read-only и `Cache-Control: private, no-store`;
- ошибка rich projection не меняет данные и приводит к безопасному fallback.

## Приоритетные классы риска

- обход access-code gate к сохраняемым данным;
- ошибочное расширение публичного `/gost` на persisted data;
- brute force 4-значного кода при отсутствии внешнего trusted perimeter;
- утечка code hash/session secret/cookie или session fixation;
- cross-space read/write/link/import/render/result/delivery;
- path traversal, ZIP bomb, XML amplification, macros/ActiveX/OLE/external relationships;
- prompt injection из документа, приводящий к shell/SQL/path/OOXML/external side effect;
- CSV/XLSX formula injection при экспорте;
- повторный render/delivery после worker restart или неопределённого внешнего ответа;
- запись в пустой local mountpoint при исчезнувшем CIFS/NFS mount;
- утечка SMTP-реквизитов, резервных копий, экспортов или restricted data;
- изменение применённой миграции, activated template или immutable result;
- чрезмерные права GitHub Actions или оставшийся временный workflow с write permission.

## Безопасная разработка

- LLM не получает shell, SQL, произвольные пути, SMTP, filesystem mutations или прямое изменение OOXML;
- публичный formatter не получает LLM, space context и внешние действия;
- Visual Template Studio не превращается в renderer;
- code/hash/session/cookie, SMTP secrets и реальные restricted values не логируются и не добавляются в fixtures;
- paths/names строит сервер; raw user text не становится filesystem path;
- spreadsheet export neutralizes formula-like values;
- target install/update/verify/rollback работают без сети;
- dependencies фиксируются lockfile и проверяются в bundle;
- applied migrations immutable; legacy data исправляются новой migration;
- каждый внешний side effect имеет correlation ID и idempotency key;
- security-sensitive defect получает negative regression test;
- write-enabled GitHub workflow допускается только по явному allowlist CI-policy: одноразовые workflows удаляются до финального PR; постоянный release publisher разрешён только после успешного push-CI default branch, с exact verified SHA, pinned actions и минимальными `actions: read` + `contents: write`;
- изменение security boundary требует ADR, требований, rollback notes и полной повторной acceptance.

## Сообщение об уязвимости

Не публикуйте секреты, персональные данные, рабочие документы и backup в открытом issue/PR. Используйте приватный канал владельца репозитория или GitHub private vulnerability reporting, если он включён. Укажите exact version/commit, условия воспроизведения, последствия и минимальный безопасный пример.
