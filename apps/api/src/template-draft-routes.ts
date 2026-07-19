import type { FastifyInstance, FastifyRequest } from "fastify";

import { analyzeOoxmlBuffer } from "@docomator/document-intake";
import { defaultScalarFormatter } from "@docomator/template-compiler";
import {
  ContentAddressedObjectStore,
  DocumentQuarantineRegistry,
  type JsonValue,
  TemplateDraftRegistry,
  TemplateDraftValidationError,
  toJsonValue
} from "@docomator/storage";

import {
  correlationId,
  mutationContextFromRequest
} from "./request-context.js";

interface SpaceParams {
  spaceId: string;
}

interface SourceParams extends SpaceParams {
  recordId: string;
}

interface DraftParams extends SpaceParams {
  draftId: string;
}

interface CreateDraftBody {
  title?: string;
}

interface CreateFieldBody {
  key: string;
  label: string;
  valueType:
    | "string"
    | "text"
    | "number"
    | "integer"
    | "boolean"
    | "date"
    | "date-time";
  required?: boolean;
  elementId: string;
  decimalPlaces?: number;
  timeZone?: string;
  repeatRow?: boolean;
  repeatArea?: {
    selection: "used-row" | "range";
    startElementId?: string;
    endElementId?: string;
  };
  textRange?: {
    startOffset: number;
    endOffset: number;
  };
}

interface ListQuery {
  limit?: number;
}

function responseEnvelope<T>(request: FastifyRequest, data: T) {
  return { data, correlationId: correlationId(request) };
}

function isJsonObject(
  value: JsonValue | undefined
): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(
  object: { [key: string]: JsonValue },
  key: string
): string {
  const value = object[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new TemplateDraftValidationError(
      `Stored structure element is missing ${key}`
    );
  }
  return value;
}

function requiredInteger(
  object: { [key: string]: JsonValue },
  key: string
): number {
  const value = object[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TemplateDraftValidationError(
      `Stored structure element is missing ${key}`
    );
  }
  return value;
}

function findElement(
  structure: JsonValue,
  elementId: string
): { [key: string]: JsonValue } {
  if (!isJsonObject(structure)) {
    throw new TemplateDraftValidationError("Stored document structure is invalid");
  }
  const elements = structure.elements;
  if (!Array.isArray(elements)) {
    throw new TemplateDraftValidationError("Stored document structure has no elements");
  }
  for (const candidate of elements) {
    if (
      isJsonObject(candidate) &&
      candidate.id === elementId &&
      (candidate.kind === "paragraph" || candidate.kind === "cell")
    ) {
      return candidate;
    }
  }
  throw new TemplateDraftValidationError(
    `Structure element was not found: ${elementId}`
  );
}

function bindingForElement(
  element: { [key: string]: JsonValue },
  textRange?: { startOffset: number; endOffset: number }
): {
  kind: "paragraph" | "cell";
  binding: JsonValue;
  preview: string;
} {
  const kind = requiredString(element, "kind");
  const elementId = requiredString(element, "id");
  if (kind === "paragraph") {
    const part = requiredString(element, "part");
    const index = requiredInteger(element, "index");
    const text = typeof element.text === "string" ? element.text : "";
    if (textRange === undefined) {
      return {
        kind,
        binding: toJsonValue({
          version: 1,
          kind: "docx.paragraph",
          elementId,
          part,
          index,
          tableLocation: element.tableLocation ?? null
        }),
        preview: text
      };
    }
    if (element.runsTruncated === true) {
      throw new TemplateDraftValidationError(
        "Абзац содержит слишком много текстовых фрагментов для безопасного выделения. Выберите другой абзац."
      );
    }
    const { startOffset, endOffset } = textRange;
    if (
      !Number.isInteger(startOffset) ||
      !Number.isInteger(endOffset) ||
      startOffset < 0 ||
      endOffset <= startOffset ||
      endOffset > text.length ||
      endOffset > 20_000
    ) {
      throw new TemplateDraftValidationError(
        "Границы выбранного текста не совпадают с сохранённым абзацем. Выделите фрагмент заново."
      );
    }
    const selectedText = text.slice(startOffset, endOffset);
    return {
      kind,
      binding: toJsonValue({
        version: 1,
        kind: "docx.text-range",
        elementId,
        part,
        index,
        startOffset,
        endOffset,
        selectedText,
        tableLocation: element.tableLocation ?? null
      }),
      preview: selectedText
    };
  }
  if (kind === "cell") {
    if (textRange !== undefined) {
      throw new TemplateDraftValidationError(
        "Для XLSX выберите целую ячейку без текстового диапазона."
      );
    }
    const sheetName = requiredString(element, "sheetName");
    const sheetPath = requiredString(element, "sheetPath");
    const address = requiredString(element, "address");
    if (element.formula !== null && element.formula !== undefined) {
      throw new TemplateDraftValidationError(
        "Ячейку с формулой нельзя назначить полем. Выберите обычную ячейку в той же строке."
      );
    }
    const value = typeof element.value === "string" ? element.value : "";
    return {
      kind,
      binding: toJsonValue({
        version: 1,
        kind: "xlsx.cell",
        elementId,
        sheetName,
        sheetPath,
        address
      }),
      preview: value
    };
  }
  throw new TemplateDraftValidationError(
    `Unsupported structure element kind: ${kind}`
  );
}

function elementTableRow(
  element: { [key: string]: JsonValue }
): { part: string; tableIndex: number; rowIndex: number } | null {
  if (element.kind !== "paragraph" || !isJsonObject(element.tableLocation)) {
    return null;
  }
  const tableIndex = element.tableLocation.tableIndex;
  const rowIndex = element.tableLocation.rowIndex;
  if (
    typeof tableIndex !== "number" ||
    !Number.isInteger(tableIndex) ||
    tableIndex < 0 ||
    typeof rowIndex !== "number" ||
    !Number.isInteger(rowIndex) ||
    rowIndex < 0
  ) {
    return null;
  }
  return {
    part: requiredString(element, "part"),
    tableIndex,
    rowIndex
  };
}

function repeatBindingForElement(
  element: { [key: string]: JsonValue }
): JsonValue {
  const row = elementTableRow(element);
  if (row === null) {
    throw new TemplateDraftValidationError(
      "Повторять можно только обычную строку таблицы DOCX."
    );
  }
  return toJsonValue({
    version: 1,
    kind: "docx.repeat-row",
    source: "audience.members",
    anchorElementId: requiredString(element, "id"),
    part: row.part,
    tableIndex: row.tableIndex,
    rowIndex: row.rowIndex
  });
}

function repeatRowCoordinate(
  value: JsonValue
): { part: string; tableIndex: number; rowIndex: number } | null {
  if (!isJsonObject(value)) return null;
  const part = value.part;
  const tableIndex = value.tableIndex;
  const rowIndex = value.rowIndex;
  return typeof part === "string" &&
    part.length > 0 &&
    typeof tableIndex === "number" &&
    Number.isInteger(tableIndex) &&
    tableIndex >= 0 &&
    typeof rowIndex === "number" &&
    Number.isInteger(rowIndex) &&
    rowIndex >= 0
    ? { part, tableIndex, rowIndex }
    : null;
}

function fieldRepeatRow(
  binding: JsonValue
): { part: string; tableIndex: number; rowIndex: number } | null {
  if (!isJsonObject(binding) || !isJsonObject(binding.tableLocation)) {
    return null;
  }
  return repeatRowCoordinate({
    part: binding.part ?? null,
    tableIndex: binding.tableLocation.tableIndex ?? null,
    rowIndex: binding.tableLocation.rowIndex ?? null
  });
}

function structureElements(structure: JsonValue): Array<{ [key: string]: JsonValue }> {
  if (!isJsonObject(structure) || !Array.isArray(structure.elements)) {
    throw new TemplateDraftValidationError("Сохранённая структура документа повреждена.");
  }
  return structure.elements.filter(isJsonObject);
}

function xlsxCoordinate(addressValue: JsonValue | undefined): {
  address: string;
  column: number;
  row: number;
} | null {
  if (typeof addressValue !== "string") return null;
  const address = addressValue.toUpperCase();
  const match = /^([A-Z]{1,3})([1-9][0-9]{0,6})$/u.exec(address);
  if (match === null) return null;
  let column = 0;
  for (const character of match[1] ?? "") {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  const row = Number(match[2]);
  return column >= 1 && column <= 16_384 && row >= 1 && row <= 1_048_576
    ? { address, column, row }
    : null;
}

function xlsxRepeatBindingForArea(
  structure: JsonValue,
  selectedElement: { [key: string]: JsonValue },
  area: NonNullable<CreateFieldBody["repeatArea"]>,
  structureTruncated: boolean
): JsonValue {
  if (selectedElement.kind !== "cell") {
    throw new TemplateDraftValidationError(
      "Повторяемый диапазон XLSX можно задать только для поля в ячейке."
    );
  }
  const selected = xlsxCoordinate(selectedElement.address);
  const sheetName = requiredString(selectedElement, "sheetName");
  const sheetPath = requiredString(selectedElement, "sheetPath");
  if (selected === null) {
    throw new TemplateDraftValidationError("Адрес выбранной ячейки XLSX недопустим.");
  }
  let start: { [key: string]: JsonValue };
  let end: { [key: string]: JsonValue };
  if (area.selection === "used-row") {
    if (structureTruncated) {
      throw new TemplateDraftValidationError(
        "Структура XLSX усечена: нельзя надёжно выбрать всю используемую строку. Выберите меньший файл или непрерывный диапазон."
      );
    }
    const row = structureElements(structure)
      .filter(
        (element) =>
          element.kind === "cell" &&
          element.sheetName === sheetName &&
          element.sheetPath === sheetPath &&
          xlsxCoordinate(element.address)?.row === selected.row
      )
      .sort(
        (left, right) =>
          (xlsxCoordinate(left.address)?.column ?? 0) -
          (xlsxCoordinate(right.address)?.column ?? 0)
      );
    const first = row[0];
    const last = row.at(-1);
    if (first === undefined || last === undefined) {
      throw new TemplateDraftValidationError(
        "В сохранённой структуре не найдена используемая строка XLSX."
      );
    }
    start = first;
    end = last;
  } else {
    if (area.startElementId === undefined || area.endElementId === undefined) {
      throw new TemplateDraftValidationError(
        "Для непрерывного диапазона выберите начальную и конечную ячейки."
      );
    }
    start = findElement(structure, area.startElementId);
    end = findElement(structure, area.endElementId);
  }
  const startCoordinate = xlsxCoordinate(start.address);
  const endCoordinate = xlsxCoordinate(end.address);
  if (
    start.kind !== "cell" ||
    end.kind !== "cell" ||
    start.sheetName !== sheetName ||
    end.sheetName !== sheetName ||
    start.sheetPath !== sheetPath ||
    end.sheetPath !== sheetPath ||
    startCoordinate === null ||
    endCoordinate === null ||
    startCoordinate.row !== selected.row ||
    endCoordinate.row !== selected.row ||
    startCoordinate.column > endCoordinate.column ||
    selected.column < startCoordinate.column ||
    selected.column > endCoordinate.column
  ) {
    throw new TemplateDraftValidationError(
      "Повторяемый диапазон XLSX должен быть непрерывным, находиться в одной строке и включать выбранное поле."
    );
  }
  return toJsonValue({
    version: 1,
    kind: "xlsx.repeat-row",
    source: "audience.members",
    selection: area.selection,
    sheetName,
    sheetPath,
    rowNumber: selected.row,
    startAddress: startCoordinate.address,
    endAddress: endCoordinate.address,
    startElementId: requiredString(start, "id"),
    endElementId: requiredString(end, "id")
  });
}

function fieldInsideRepeat(binding: JsonValue, repeatBinding: JsonValue): boolean {
  if (!isJsonObject(repeatBinding) || !isJsonObject(binding)) return false;
  if (repeatBinding.kind === "docx.repeat-row") {
    const fieldRow = fieldRepeatRow(binding);
    const repeatRow = repeatRowCoordinate(repeatBinding);
    return fieldRow !== null && repeatRow !== null && sameRepeatRow(fieldRow, repeatRow);
  }
  if (repeatBinding.kind !== "xlsx.repeat-row" || binding.kind !== "xlsx.cell") {
    return false;
  }
  const field = xlsxCoordinate(binding.address);
  const start = xlsxCoordinate(repeatBinding.startAddress);
  const end = xlsxCoordinate(repeatBinding.endAddress);
  return (
    field !== null &&
    start !== null &&
    end !== null &&
    binding.sheetName === repeatBinding.sheetName &&
    binding.sheetPath === repeatBinding.sheetPath &&
    field.row === repeatBinding.rowNumber &&
    field.column >= start.column &&
    field.column <= end.column
  );
}

function sameRepeatRow(
  left: { part: string; tableIndex: number; rowIndex: number },
  right: { part: string; tableIndex: number; rowIndex: number }
): boolean {
  return (
    left.part === right.part &&
    left.tableIndex === right.tableIndex &&
    left.rowIndex === right.rowIndex
  );
}

const spaceParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["spaceId"],
  properties: {
    spaceId: { type: "string", minLength: 1, maxLength: 160 }
  }
} as const;

export function registerTemplateDraftRoutes(
  app: FastifyInstance,
  quarantineRegistry: DocumentQuarantineRegistry,
  objectStore: ContentAddressedObjectStore,
  draftRegistry: TemplateDraftRegistry
): void {
  app.post<{ Params: SourceParams; Body: CreateDraftBody }>(
    "/api/v1/spaces/:spaceId/document-sources/:recordId/draft",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "recordId"],
          properties: {
            spaceId: { type: "string", minLength: 1, maxLength: 160 },
            recordId: { type: "string", minLength: 1, maxLength: 160 }
          }
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            title: { type: "string", minLength: 1, maxLength: 500 }
          }
        }
      }
    },
    async (request, reply) => {
      const source = quarantineRegistry.getDocument(
        request.params.spaceId,
        request.params.recordId
      );
      const buffer = await objectStore.getBuffer(source.sha256);
      const structure = await analyzeOoxmlBuffer({
        buffer,
        fileName: source.fileName,
        mediaType: source.mediaType,
        maxElements: 2_000
      });
      if (structure.sourceSha256 !== source.sha256) {
        throw new TemplateDraftValidationError(
          "Stored source checksum changed before draft creation"
        );
      }
      const draft = draftRegistry.createOrGetDraft(
        {
          spaceId: source.spaceId,
          sourceRecordId: source.id,
          title: request.body.title?.trim() || source.fileName,
          format: source.format,
          sourceSha256: source.sha256,
          structureVersion: 1,
          structureSha256: structure.structureSha256,
          structure: toJsonValue(structure),
          structureTruncated: structure.truncated
        },
        mutationContextFromRequest(request)
      );
      reply.code(201).header("cache-control", "no-store");
      return responseEnvelope(request, draft);
    }
  );

  app.get<{ Params: SpaceParams; Querystring: ListQuery }>(
    "/api/v1/spaces/:spaceId/template-drafts",
    {
      schema: {
        params: spaceParamsSchema,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 500 }
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        draftRegistry.listDrafts(
          request.params.spaceId,
          request.query.limit ?? 100
        )
      )
  );

  app.get<{ Params: DraftParams }>(
    "/api/v1/spaces/:spaceId/template-drafts/:draftId",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "draftId"],
          properties: {
            spaceId: { type: "string", minLength: 1, maxLength: 160 },
            draftId: { type: "string", minLength: 1, maxLength: 160 }
          }
        }
      }
    },
    async (request) =>
      responseEnvelope(
        request,
        draftRegistry.getDraft(request.params.spaceId, request.params.draftId)
      )
  );

  app.post<{ Params: DraftParams; Body: CreateFieldBody }>(
    "/api/v1/spaces/:spaceId/template-drafts/:draftId/fields",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["spaceId", "draftId"],
          properties: {
            spaceId: { type: "string", minLength: 1, maxLength: 160 },
            draftId: { type: "string", minLength: 1, maxLength: 160 }
          }
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["key", "label", "valueType", "elementId"],
          properties: {
            key: { type: "string", minLength: 1, maxLength: 160 },
            label: { type: "string", minLength: 1, maxLength: 500 },
            valueType: {
              type: "string",
              enum: [
                "string",
                "text",
                "number",
                "integer",
                "boolean",
                "date",
                "date-time"
              ]
            },
            required: { type: "boolean", default: false },
            elementId: { type: "string", minLength: 1, maxLength: 160 },
            decimalPlaces: {
              type: "integer",
              minimum: 0,
              maximum: 6
            },
            timeZone: {
              type: "string",
              minLength: 1,
              maxLength: 100,
              pattern: "^(?:UTC|[A-Za-z_]+(?:/[A-Za-z0-9_+.-]+)+)$"
            },
            repeatRow: { type: "boolean", default: false },
            repeatArea: {
              type: "object",
              additionalProperties: false,
              required: ["selection"],
              properties: {
                selection: {
                  type: "string",
                  enum: ["used-row", "range"]
                },
                startElementId: {
                  type: "string",
                  minLength: 1,
                  maxLength: 160
                },
                endElementId: {
                  type: "string",
                  minLength: 1,
                  maxLength: 160
                }
              }
            },
            textRange: {
              type: "object",
              additionalProperties: false,
              required: ["startOffset", "endOffset"],
              properties: {
                startOffset: {
                  type: "integer",
                  minimum: 0,
                  maximum: 19_999
                },
                endOffset: {
                  type: "integer",
                  minimum: 1,
                  maximum: 20_000
                }
              }
            }
          }
        }
      }
    },
    async (request, reply) => {
      const draft = draftRegistry.getDraft(
        request.params.spaceId,
        request.params.draftId
      );
      const element = findElement(draft.structure, request.body.elementId);
      const binding = bindingForElement(element, request.body.textRange);
      if (
        draft.repeatBinding !== null &&
        !fieldInsideRepeat(binding.binding, draft.repeatBinding)
      ) {
        throw new TemplateDraftValidationError(
          "Все поля шаблона с повтором должны находиться внутри выбранной строки или диапазона."
        );
      }
      if (request.body.repeatRow && request.body.repeatArea !== undefined) {
        throw new TemplateDraftValidationError(
          "Выберите один способ повтора: строку DOCX или диапазон XLSX."
        );
      }
      const repeatBinding = request.body.repeatRow
        ? repeatBindingForElement(element)
        : request.body.repeatArea === undefined
          ? undefined
          : xlsxRepeatBindingForArea(
              draft.structure,
              element,
              request.body.repeatArea,
              draft.structureTruncated
            );
      if (repeatBinding !== undefined) {
        const outsideField = draft.fields.find((field) => {
          return !fieldInsideRepeat(field.binding, repeatBinding);
        });
        if (outsideField !== undefined) {
          throw new TemplateDraftValidationError(
            `Поле «${outsideField.label}» находится вне выбранной повторяемой строки.`
          );
        }
      }
      if (
        request.body.decimalPlaces !== undefined &&
        request.body.valueType !== "number"
      ) {
        throw new TemplateDraftValidationError(
          "Число знаков после запятой можно задать только для числового поля."
        );
      }
      if (
        request.body.timeZone !== undefined &&
        request.body.valueType !== "date-time"
      ) {
        throw new TemplateDraftValidationError(
          "Часовой пояс можно задать только для поля даты и времени."
        );
      }
      const formatter = defaultScalarFormatter(request.body.valueType, {
        ...(request.body.decimalPlaces === undefined
          ? {}
          : { fractionDigits: request.body.decimalPlaces }),
        ...(request.body.timeZone === undefined
          ? {}
          : { timeZone: request.body.timeZone })
      });
      const field = draftRegistry.createField(
        request.params.spaceId,
        draft.id,
        {
          key: request.body.key,
          label: request.body.label,
          valueType: request.body.valueType,
          required: request.body.required ?? false,
          elementId: request.body.elementId,
          elementKind: binding.kind,
          binding: binding.binding,
          formatter: toJsonValue(formatter),
          ...(repeatBinding === undefined ? {} : { repeatBinding }),
          originalPreview: binding.preview,
          structureSha256: draft.structureSha256
        },
        mutationContextFromRequest(request)
      );
      reply.code(201).header("cache-control", "no-store");
      return responseEnvelope(request, {
        draftId: draft.id,
        structureSha256: draft.structureSha256,
        repeatBinding: draft.repeatBinding ?? repeatBinding ?? null,
        field
      });
    }
  );
}
