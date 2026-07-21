#!/usr/bin/env bash
set -Eeuo pipefail
export PATH="/usr/sbin:/usr/bin:/sbin:/bin"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

BUNDLE_ROOT="$SCRIPT_DIR"
CONFIG_FILE="/etc/docomator/docomator.env"
BASE_URL="http://127.0.0.1:8080/"
OUTPUT_DIRECTORY=""
PILOT_LAUNCHER="/opt/docomator/current/app/scripts/runtime/pilot-check.sh"
REQUIRE_NETWORK=0
REQUIRE_SMTP=0

usage() {
  cat <<'USAGE'
Использование: target-acceptance.sh --output КАТАЛОГ [параметры]

Выполняет единый fail-closed прогон проверенного offline bundle на целевой
Debian/Astra Linux: проверка комплекта, root smoke, core/LibreOffice gate,
контрольная резервная копия, release-bound пилотный акт и Playwright/axe.
Команда запускается обычным пользователем; привилегированные шаги вызываются
через sudo. Каталог результатов должен быть новым.

Параметры:
  --output КАТАЛОГ        новый каталог целевых свидетельств
  --bundle-root КАТАЛОГ   распакованный автономный комплект
  --config ФАЙЛ           настройки установленного Docomator
  --base-url URL          локальный адрес Docomator
  --pilot-launcher ФАЙЛ   установленный pilot-check.sh
  --require-network       сделать сетевую папку обязательной
  --require-smtp          сделать SMTP обязательным
  -h, --help              показать справку
USAGE
}

need_value() {
  local option="$1"
  local count="$2"
  ((count >= 2)) || die "После $option необходимо указать значение."
}

while (($# > 0)); do
  case "$1" in
    --output)
      need_value "$1" "$#"
      OUTPUT_DIRECTORY="$2"
      shift 2
      ;;
    --bundle-root)
      need_value "$1" "$#"
      BUNDLE_ROOT="$2"
      shift 2
      ;;
    --config)
      need_value "$1" "$#"
      CONFIG_FILE="$2"
      shift 2
      ;;
    --base-url)
      need_value "$1" "$#"
      BASE_URL="$2"
      shift 2
      ;;
    --pilot-launcher)
      need_value "$1" "$#"
      PILOT_LAUNCHER="$2"
      shift 2
      ;;
    --require-network)
      REQUIRE_NETWORK=1
      shift
      ;;
    --require-smtp)
      REQUIRE_SMTP=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "Неизвестный параметр: $1"
      ;;
  esac
done

[[ "${EUID:-$(id -u)}" -ne 0 ]] || \
  die "Целевую приёмку необходимо запускать обычным пользователем, не root."
[[ -n "$OUTPUT_DIRECTORY" ]] || die "Укажите новый каталог через --output."
require_command sudo
require_command find
require_command realpath
require_command sha256sum
require_command sort
require_command tee

BUNDLE_ROOT="$(absolute_path "$BUNDLE_ROOT")"
CONFIG_FILE="$(realpath "$CONFIG_FILE")"
PILOT_LAUNCHER="$(realpath "$PILOT_LAUNCHER")"
[[ -f "$CONFIG_FILE" && ! -L "$CONFIG_FILE" ]] || die "Не найден обычный файл настроек: $CONFIG_FILE"
[[ -f "$PILOT_LAUNCHER" && ! -L "$PILOT_LAUNCHER" ]] || \
  die "Не найден установленный pilot-check.sh: $PILOT_LAUNCHER"

OUTPUT_DIRECTORY="$(realpath -m "$OUTPUT_DIRECTORY")"
OUTPUT_PARENT="$(dirname "$OUTPUT_DIRECTORY")"
install -d -m 0700 "$OUTPUT_PARENT"
[[ "$(realpath "$OUTPUT_PARENT")" == "$OUTPUT_PARENT" ]] || \
  die "Путь результатов не должен содержать символические ссылки."
PARENT_OWNER="$(stat -c '%u' "$OUTPUT_PARENT")"
PARENT_MODE="$(stat -c '%a' "$OUTPUT_PARENT")"
[[ "$PARENT_OWNER" == "$(id -u)" ]] || \
  die "Родительский каталог результатов должен принадлежать текущему пользователю."
(( (8#$PARENT_MODE & 8#022) == 0 )) || \
  die "Родительский каталог результатов доступен для записи группе или остальным."
[[ ! -e "$OUTPUT_DIRECTORY" ]] || die "Каталог результатов уже существует: $OUTPUT_DIRECTORY"
install -d -m 0700 "$OUTPUT_DIRECTORY" "$OUTPUT_DIRECTORY/logs"

run_logged() {
  local log_file="$1"
  shift
  "$@" > >(tee "$log_file") 2> >(tee -a "$log_file" >&2)
}

require_trusted_bundle "$BUNDLE_ROOT"
run_logged "$OUTPUT_DIRECTORY/logs/01-verify-bundle.log" \
  "$BUNDLE_ROOT/verify-bundle.sh" "$BUNDLE_ROOT"
verify_target_os_package_profile "$BUNDLE_ROOT/payload/os-packages"

run_logged "$OUTPUT_DIRECTORY/logs/02-root-smoke.log" \
  sudo "$BUNDLE_ROOT/smoke-test.sh" "$BUNDLE_ROOT"
run_logged "$OUTPUT_DIRECTORY/logs/03-target-release-gate.log" \
  "$BUNDLE_ROOT/target-release-gate.sh" \
    --bundle-root "$BUNDLE_ROOT" \
    --config "$CONFIG_FILE"

install -d -m 0700 "$OUTPUT_DIRECTORY/pilot"
pilot_arguments=(
  --config "$CONFIG_FILE"
  --url "$BASE_URL"
  --output "$OUTPUT_DIRECTORY/pilot"
  --run-backup
  --json-only
)
if ((REQUIRE_NETWORK == 1)); then
  pilot_arguments+=(--require-network)
fi
if ((REQUIRE_SMTP == 1)); then
  pilot_arguments+=(--require-smtp)
fi
run_logged "$OUTPUT_DIRECTORY/logs/04-pilot-check.log" \
  sudo bash "$PILOT_LAUNCHER" "${pilot_arguments[@]}"
sudo chown -R "$(id -u):$(id -g)" "$OUTPUT_DIRECTORY/pilot"
sudo chmod -R u=rwX,go= "$OUTPUT_DIRECTORY/pilot"

run_logged "$OUTPUT_DIRECTORY/logs/05-ux-acceptance.log" \
  "$BUNDLE_ROOT/ux-acceptance-gate.sh" \
    --base-url "$BASE_URL" \
    --output "$OUTPUT_DIRECTORY/ux"

mapfile -d '' PILOT_JSON_FILES < <(
  find "$OUTPUT_DIRECTORY/pilot" -maxdepth 1 -type f -name 'pilot-*.json' -print0
)
mapfile -d '' PILOT_MARKDOWN_FILES < <(
  find "$OUTPUT_DIRECTORY/pilot" -maxdepth 1 -type f -name 'pilot-*.md' -print0
)
((${#PILOT_JSON_FILES[@]} == 1)) || die "Пилотный прогон должен создать ровно один JSON-акт."
((${#PILOT_MARKDOWN_FILES[@]} == 1)) || die "Пилотный прогон должен создать ровно один Markdown-акт."
for required in run-metadata.json playwright-report.json axe-report.json; do
  [[ -f "$OUTPUT_DIRECTORY/ux/$required" && ! -L "$OUTPUT_DIRECTORY/ux/$required" ]] || \
    die "UX-gate не создал обязательный файл: $required"
done

BUNDLED_NODE="$BUNDLE_ROOT/payload/runtime/node/bin/node"
"$BUNDLED_NODE" - \
  "$OUTPUT_DIRECTORY" \
  "$BUNDLE_ROOT" \
  "${PILOT_JSON_FILES[0]}" \
  "${PILOT_MARKDOWN_FILES[0]}" \
  "$BASE_URL" \
  "$REQUIRE_NETWORK" \
  "$REQUIRE_SMTP" <<'NODE'
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const [
  outputDirectory,
  bundleRoot,
  pilotJsonPath,
  pilotMarkdownPath,
  baseURL,
  requireNetworkSource,
  requireSmtpSource
] = process.argv.slice(2);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const parseEnv = (source) => Object.fromEntries(
  source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const separator = line.indexOf("=");
      return [line.slice(0, separator), line.slice(separator + 1)];
    })
);

const [releaseSource, manifestSource, sourceOsSource, pilotSource, uxSource] =
  await Promise.all([
    fs.readFile(path.join(bundleRoot, "release.json"), "utf8"),
    fs.readFile(path.join(bundleRoot, "manifest.sha256")),
    fs.readFile(path.join(bundleRoot, "payload/os-packages/source-os.env"), "utf8"),
    fs.readFile(pilotJsonPath, "utf8"),
    fs.readFile(path.join(outputDirectory, "ux/run-metadata.json"), "utf8")
  ]);
const release = JSON.parse(releaseSource);
const pilot = JSON.parse(pilotSource);
const ux = JSON.parse(uxSource);
const sourceOs = parseEnv(sourceOsSource);
const bundleManifestSha256 = sha256(manifestSource);
const releaseMetadataSha256 = sha256(releaseSource);

if (
  pilot.status !== "passed" ||
  pilot.summary?.requiredErrors !== 0 ||
  pilot.release?.version !== release.version ||
  pilot.release?.gitCommit !== release.gitCommit ||
  pilot.release?.releaseMetadataSha256 !== releaseMetadataSha256
) {
  throw new Error("Пилотный акт не подтверждает тот же установленный релиз.");
}
if (
  ux.releaseVersion !== release.version ||
  ux.commitSha !== release.gitCommit ||
  ux.bundleManifestSha256 !== bundleManifestSha256 ||
  ux.releaseMetadataSha256 !== releaseMetadataSha256
) {
  throw new Error("UX-свидетельства не связаны с проверяемым bundle.");
}

const relative = (value) => path.relative(outputDirectory, value).split(path.sep).join("/");
const result = {
  version: 1,
  kind: "docomator.target-acceptance",
  generatedAt: new Date().toISOString(),
  releaseVersion: release.version,
  commitSha: release.gitCommit,
  bundleManifestSha256,
  releaseMetadataSha256,
  target: {
    osId: sourceOs.OS_ID ?? null,
    versionId: sourceOs.OS_VERSION_ID ?? null,
    architecture: sourceOs.DEB_ARCHITECTURE ?? null
  },
  baseURL,
  requirements: {
    network: requireNetworkSource === "1",
    smtp: requireSmtpSource === "1"
  },
  artifacts: {
    pilotJson: relative(pilotJsonPath),
    pilotMarkdown: relative(pilotMarkdownPath),
    uxRunMetadata: "ux/run-metadata.json",
    playwrightReport: "ux/playwright-report.json",
    axeReport: "ux/axe-report.json",
    verifyBundleLog: "logs/01-verify-bundle.log",
    rootSmokeLog: "logs/02-root-smoke.log",
    targetReleaseGateLog: "logs/03-target-release-gate.log",
    pilotLog: "logs/04-pilot-check.log",
    uxLog: "logs/05-ux-acceptance.log"
  }
};
await fs.writeFile(
  path.join(outputDirectory, "target-acceptance.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  { encoding: "utf8", flag: "wx", mode: 0o600 }
);
NODE

(
  cd "$OUTPUT_DIRECTORY"
  find . -type f ! -path './manifest.sha256' -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 sha256sum > manifest.sha256
)

info "Целевая приёмка завершена без блокирующих ошибок."
printf 'Свидетельства: %s\n' "$OUTPUT_DIRECTORY"
printf 'Сводный акт: %s\n' "$OUTPUT_DIRECTORY/target-acceptance.json"
printf 'Manifest: %s\n' "$OUTPUT_DIRECTORY/manifest.sha256"
