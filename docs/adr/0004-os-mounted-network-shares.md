# ADR-0004: Сетевые папки монтируются операционной системой

- Статус: accepted
- Дата: 2026-07-11

## Контекст

Прямой SMB/NFS client в приложении добавляет credentials, native dependencies и protocol-specific retry semantics.

## Решение

SMB/CIFS и NFS монтируются ОС. Приложение получает allowlisted local roots, проверяет mountinfo и sentinel, затем пишет temp file и выполняет atomic rename.

## Последствия

- credentials и reconnect управляются администраторами ОС;
- один filesystem adapter покрывает SMB и NFS;
- delivery обязан отличать реальный mount от пустой локальной директории;
- mount configuration входит в deployment documentation, а не в application database.
