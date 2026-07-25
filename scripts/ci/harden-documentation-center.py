from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
path = ROOT / "apps/api/ui/documentation-center.js"
value = path.read_text(encoding="utf-8")

value = value.replace(
    '      globalThis.docomatorSelectView?.(documentationViewName);\n',
    '',
)

old_parse = '''  function documentationParseHash() {
    const match = /^#documentation\\/([^/]+)(?:\\/(.+))?$/u.exec(globalThis.location?.hash || "");
    if (!match) return null;'''
new_parse = '''  function documentationParseHash() {
    const hash = globalThis.location?.hash || "";
    if (hash === "#documentation") return { id: "", anchor: "" };
    const match = /^#documentation\\/([^/]+)(?:\\/(.+))?$/u.exec(hash);
    if (!match) return null;'''
if old_parse in value:
    value = value.replace(old_parse, new_parse, 1)
elif new_parse not in value:
    raise RuntimeError("documentationParseHash block was not found")

old_open = '''  function documentationOpen(documentId = "", anchor = "") {
    documentationSetVisible(true);
    const parsed = documentId ? { id: documentId, anchor } : documentationParseHash();
    if (parsed?.id && documentationSelectDocument(parsed.id, parsed.anchor, false)) return;
    const contextual = documentationContextTarget();
    if (contextual?.document) {'''
new_open = '''  function documentationOpen(documentId = "", anchor = "") {
    const parsed = documentId ? { id: documentId, anchor } : documentationParseHash();
    const contextual = parsed?.id ? null : documentationContextTarget();
    documentationSetVisible(true);
    if (parsed?.id && documentationSelectDocument(parsed.id, parsed.anchor, false)) return;
    if (parsed && !parsed.id) {
      documentationShowIndex(false);
      documentQuery("#documentationSearch")?.focus();
      return;
    }
    if (contextual?.document) {'''
if old_open in value:
    value = value.replace(old_open, new_open, 1)
elif new_open not in value:
    raise RuntimeError("documentationOpen block was not found")

old_hash_change = '''      documentationSetVisible(true);
      documentationSelectDocument(parsed.id, parsed.anchor, false);'''
new_hash_change = '''      documentationSetVisible(true);
      if (parsed.id) documentationSelectDocument(parsed.id, parsed.anchor, false);
      else documentationShowIndex(false);'''
if old_hash_change in value:
    value = value.replace(old_hash_change, new_hash_change, 1)
elif new_hash_change not in value:
    raise RuntimeError("hashchange block was not found")

old_bootstrap_hash = '''    if (parsed) {
      documentationSetVisible(true);
      documentationSelectDocument(parsed.id, parsed.anchor, false);
    }'''
new_bootstrap_hash = '''    if (parsed) {
      documentationSetVisible(true);
      if (parsed.id) documentationSelectDocument(parsed.id, parsed.anchor, false);
      else documentationShowIndex(false);
    }'''
if old_bootstrap_hash in value:
    value = value.replace(old_bootstrap_hash, new_bootstrap_hash, 1)
elif new_bootstrap_hash not in value:
    raise RuntimeError("bootstrap hash block was not found")

path.write_text(value, encoding="utf-8")
print("hardened apps/api/ui/documentation-center.js")
