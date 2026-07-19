import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";

import type { ReleaseIdentityResponse } from "@docomator/contracts";

const MAXIMUM_RELEASE_METADATA_BYTES = 64 * 1024;
const COMMIT_PATTERN = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function installedIdentity(
  value: unknown,
  expectedVersion: string,
  sha256: string
): ReleaseIdentityResponse {
  const release = record(value);
  if (
    release?.name !== "docomator" ||
    release.version !== expectedVersion ||
    typeof release.gitCommit !== "string" ||
    !COMMIT_PATTERN.test(release.gitCommit)
  ) {
    throw new Error("installed release metadata does not match the API version");
  }
  return {
    name: "docomator",
    version: expectedVersion,
    gitCommit: release.gitCommit,
    releaseMetadataSha256: sha256,
    source: "installed"
  };
}

export async function loadReleaseIdentity(
  releaseMetadataPath: string | null,
  version: string
): Promise<ReleaseIdentityResponse> {
  if (releaseMetadataPath === null) {
    return {
      name: "docomator",
      version,
      gitCommit: null,
      releaseMetadataSha256: null,
      source: "development"
    };
  }

  const pathInformation = await lstat(releaseMetadataPath);
  if (!pathInformation.isFile()) {
    throw new Error("installed release metadata is not a regular file");
  }
  const canonicalPath = await realpath(releaseMetadataPath);
  const handle = await open(
    canonicalPath,
    constants.O_RDONLY | constants.O_NOFOLLOW
  );
  try {
    const information = await handle.stat();
    if (
      !information.isFile() ||
      information.size <= 0 ||
      information.size > MAXIMUM_RELEASE_METADATA_BYTES
    ) {
      throw new Error("installed release metadata has an invalid size");
    }
    const source = await handle.readFile();
    if (source.byteLength !== information.size) {
      throw new Error("installed release metadata changed while it was read");
    }
    const parsed: unknown = JSON.parse(source.toString("utf8"));
    return installedIdentity(
      parsed,
      version,
      createHash("sha256").update(source).digest("hex")
    );
  } finally {
    await handle.close();
  }
}
