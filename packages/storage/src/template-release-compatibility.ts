import type { MutationContext } from "./knowledge.js";
import {
  TemplateReleaseRegistry,
  type ActivateTemplateReleaseInput,
  type ActiveTemplateReleaseRecord,
  type CompleteTemplateReleasePreviewInput,
  type RequestTemplateReleasePreviewInput,
  type TemplateReleasePreviewRecord
} from "./template-releases.js";

export interface LegacyTemplatePreviewRequestInput {
  id?: string;
  spaceId: string;
  testVersionId: string;
}

export type CompatibleTemplatePreviewRequestInput =
  | RequestTemplateReleasePreviewInput
  | LegacyTemplatePreviewRequestInput;

export interface CompatibleTemplateReleasePreviewRecord
  extends TemplateReleasePreviewRecord {
  testVersionId: string;
}

export interface CompatibleActiveTemplateReleaseRecord
  extends ActiveTemplateReleaseRecord {
  testVersionId: string;
}

function normalizePreviewInput(
  input: CompatibleTemplatePreviewRequestInput
): RequestTemplateReleasePreviewInput {
  if ("versionId" in input) return input;
  return {
    ...(input.id === undefined ? {} : { id: input.id }),
    spaceId: input.spaceId,
    versionId: input.testVersionId,
    versionKind: "single"
  };
}

function compatiblePreview(
  record: TemplateReleasePreviewRecord
): CompatibleTemplateReleasePreviewRecord {
  return { ...record, testVersionId: record.versionId };
}

function compatibleActive(
  record: ActiveTemplateReleaseRecord
): CompatibleActiveTemplateReleaseRecord {
  return { ...record, testVersionId: record.versionId };
}

export class UnifiedTemplatePreviewActivationRegistry extends TemplateReleaseRegistry {
  override requestPreview(
    input: CompatibleTemplatePreviewRequestInput,
    context: MutationContext
  ): {
    request: CompatibleTemplateReleasePreviewRecord;
    created: boolean;
    retried: boolean;
  } {
    const result = super.requestPreview(normalizePreviewInput(input), context);
    return { ...result, request: compatiblePreview(result.request) };
  }

  override getPreview(
    spaceIdentity: string,
    requestId: string
  ): CompatibleTemplateReleasePreviewRecord {
    return compatiblePreview(super.getPreview(spaceIdentity, requestId));
  }

  override getPreviewForWorker(
    requestId: string
  ): CompatibleTemplateReleasePreviewRecord {
    return compatiblePreview(super.getPreviewForWorker(requestId));
  }

  override async completePreview(
    input: CompleteTemplateReleasePreviewInput,
    context: MutationContext
  ): Promise<CompatibleTemplateReleasePreviewRecord> {
    return compatiblePreview(await super.completePreview(input, context));
  }

  override failPreview(
    requestId: string,
    error: Parameters<TemplateReleaseRegistry["failPreview"]>[1],
    context: MutationContext
  ): CompatibleTemplateReleasePreviewRecord {
    return compatiblePreview(super.failPreview(requestId, error, context));
  }

  override activateVersion(
    input: ActivateTemplateReleaseInput,
    context: MutationContext
  ): CompatibleActiveTemplateReleaseRecord {
    return compatibleActive(super.activateVersion(input, context));
  }

  override listActiveTemplates(
    spaceIdentity: string
  ): CompatibleActiveTemplateReleaseRecord[] {
    return super.listActiveTemplates(spaceIdentity).map(compatibleActive);
  }

  override getActiveTemplate(
    spaceIdentity: string,
    activeVersionId: string
  ): CompatibleActiveTemplateReleaseRecord {
    return compatibleActive(
      super.getActiveTemplate(spaceIdentity, activeVersionId)
    );
  }
}
