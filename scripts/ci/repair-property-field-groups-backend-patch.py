from pathlib import Path

path = Path(__file__).with_name("apply-property-field-groups-backend.py")
value = path.read_text(encoding="utf-8")
marker = 'print("property field groups backend patches applied")\n'
addition = """replace_once(
    "packages/storage/src/employees.ts",
    '''  private resolveOrCreateDefinition(
    input: {
      label: string;
      valueType: PropertyValueType;
      unit: string | null;
    },''',
    '''  private resolveOrCreateDefinition(
    input: {
      label: string;
      valueType: PropertyValueType;
      unit: string | null;
      uiGroup: PropertyUiGroup;
    },'''
)

"""
if addition not in value:
    if value.count(marker) != 1:
        raise RuntimeError("Не найден финальный маркер серверного патча")
    value = value.replace(marker, addition + marker, 1)
path.write_text(value, encoding="utf-8")
print("repaired employee definition input patch")
