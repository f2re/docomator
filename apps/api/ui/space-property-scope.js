const DOCOMATOR_DEFAULT_SPACE_ID = "00000000-0000-4000-8000-000000000001";

function currentRequestSpaceId() {
  return String(
    globalThis.docomatorCurrentSpaceId ||
      localStorage.getItem("docomator.space") ||
      DOCOMATOR_DEFAULT_SPACE_ID
  ).trim();
}

function installSpaceScopedPropertyRequests() {
  if (globalThis.__docomatorSpacePropertyScopeInstalled) return;
  globalThis.__docomatorSpacePropertyScopeInstalled = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const rawUrl =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : null;
    const origin = globalThis.location?.origin;
    if (rawUrl !== null && origin) {
      const url = new URL(rawUrl, origin);
      if (
        url.origin === origin &&
        url.pathname.startsWith("/api/v1/knowledge/property-definitions") &&
        !url.searchParams.has("spaceId")
      ) {
        const spaceId = currentRequestSpaceId();
        if (spaceId) {
          url.searchParams.set("spaceId", spaceId);
          const nextUrl = /^https?:/u.test(rawUrl)
            ? url.toString()
            : `${url.pathname}${url.search}${url.hash}`;
          return originalFetch(nextUrl, init);
        }
      }
    }
    return originalFetch(input, init);
  };
}

installSpaceScopedPropertyRequests();
