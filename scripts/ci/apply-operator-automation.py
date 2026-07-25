from pathlib import Path

path = Path("packages/storage/src/operator-assist.ts")
source = path.read_text(encoding="utf-8")
old = '''  type DocumentScheduleDelivery,
  type DocumentScheduleRecord,
  type DocumentScheduleRecurrence
} from "./document-schedules.js";'''
new = '''  type DocumentScheduleDelivery,
  type DocumentScheduleRecord
} from "./document-schedules.js";'''
if old not in source:
    raise SystemExit("Не найден импорт типа периодичности из document-schedules")
source = source.replace(old, new, 1)
old = '''  initialScheduleRunAt,
  normalizeLocalDate,
  normalizeLocalTime,
  normalizeTimeZone
} from "./schedule-time.js";'''
new = '''  initialScheduleRunAt,
  normalizeLocalDate,
  normalizeLocalTime,
  normalizeTimeZone,
  type DocumentScheduleRecurrence
} from "./schedule-time.js";'''
if old not in source:
    raise SystemExit("Не найден импорт schedule-time")
path.write_text(source.replace(old, new, 1), encoding="utf-8")
print("Исправлен источник типа DocumentScheduleRecurrence")
