import {
  DataExtractionConflictError,
  DataExtractionNotFoundError,
  DataExtractionValidationError
} from "@docomator/storage";

import { DataExtractionDefinitionError } from "./data-extraction-service.js";

type ErrorConstructor = new (...args: never[]) => Error;

const mappings: ReadonlyArray<readonly [ErrorConstructor, number]> = [
  [DataExtractionDefinitionError, 400],
  [DataExtractionValidationError, 400],
  [DataExtractionNotFoundError, 404],
  [DataExtractionConflictError, 409]
];

export function installDataExtractionHttpErrorMapping(): void {
  for (const [constructor, statusCode] of mappings) {
    if (Object.hasOwn(constructor.prototype, "statusCode")) continue;
    Object.defineProperty(constructor.prototype, "statusCode", {
      configurable: false,
      enumerable: false,
      writable: false,
      value: statusCode
    });
  }
}
