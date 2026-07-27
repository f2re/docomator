from pathlib import Path

path = Path(__file__).with_name("apply-field-groups-interface.py")
value = path.read_text(encoding="utf-8")
old = '''''' + '''      $("#employeeFieldConfirmText").textContent = `Поле «${added.label}» станет доступно в каждой карточке. Введённое значение сохранится у текущего сотрудника.`;'''
new = '''''' + '''    $("#employeeFieldConfirmText").textContent = `Поле «${added.label}» станет доступно в каждой карточке. Введённое значение сохранится у текущего сотрудника.`;'''
if value.count(old) != 1:
    raise RuntimeError(f"Ожидалось одно неверное ожидание отступа, найдено {value.count(old)}")
value = value.replace(old, new, 1)
old_new = '''''' + '''      $("#employeeFieldConfirmText").textContent = `Поле «${added.label}» будет создано в разделе «${globalThis.docomatorFieldGroups.label(added.uiGroup)}». Одноимённые поля других разделов останутся отдельными.`;'''
new_new = '''''' + '''    $("#employeeFieldConfirmText").textContent = `Поле «${added.label}» будет создано в разделе «${globalThis.docomatorFieldGroups.label(added.uiGroup)}». Одноимённые поля других разделов останутся отдельными.`;'''
if value.count(old_new) != 1:
    raise RuntimeError(f"Ожидалось одно новое значение с неверным отступом, найдено {value.count(old_new)}")
path.write_text(value.replace(old_new, new_new, 1), encoding="utf-8")
print("repaired confirmation indentation")
