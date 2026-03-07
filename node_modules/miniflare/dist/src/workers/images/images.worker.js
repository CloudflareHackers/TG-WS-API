// src/workers/images/images.worker.ts
import { WorkerEntrypoint } from "cloudflare:workers";

// src/workers/core/constants.ts
var CoreHeaders = {
  CUSTOM_FETCH_SERVICE: "MF-Custom-Fetch-Service",
  CUSTOM_NODE_SERVICE: "MF-Custom-Node-Service",
  ORIGINAL_URL: "MF-Original-URL",
  /**
   * Stores the original hostname when using the `upstream` option.
   * When requests are proxied to an upstream, the `Host` header is rewritten
   * to match the upstream. This header preserves the original hostname
   * so Workers can access it if needed.
   */
  ORIGINAL_HOSTNAME: "MF-Original-Hostname",
  PROXY_SHARED_SECRET: "MF-Proxy-Shared-Secret",
  DISABLE_PRETTY_ERROR: "MF-Disable-Pretty-Error",
  ERROR_STACK: "MF-Experimental-Error-Stack",
  ROUTE_OVERRIDE: "MF-Route-Override",
  CF_BLOB: "MF-CF-Blob",
  /** Used by the Vite plugin to pass through the original `sec-fetch-mode` header */
  SEC_FETCH_MODE: "MF-Sec-Fetch-Mode",
  // API Proxy
  OP_SECRET: "MF-Op-Secret",
  OP: "MF-Op",
  OP_TARGET: "MF-Op-Target",
  OP_KEY: "MF-Op-Key",
  OP_SYNC: "MF-Op-Sync",
  OP_STRINGIFIED_SIZE: "MF-Op-Stringified-Size",
  OP_RESULT_TYPE: "MF-Op-Result-Type"
}, CoreBindings = {
  SERVICE_LOOPBACK: "MINIFLARE_LOOPBACK",
  SERVICE_USER_ROUTE_PREFIX: "MINIFLARE_USER_ROUTE_",
  SERVICE_USER_FALLBACK: "MINIFLARE_USER_FALLBACK",
  TEXT_CUSTOM_SERVICE: "MINIFLARE_CUSTOM_SERVICE",
  IMAGES_SERVICE: "MINIFLARE_IMAGES_SERVICE",
  TEXT_UPSTREAM_URL: "MINIFLARE_UPSTREAM_URL",
  JSON_CF_BLOB: "CF_BLOB",
  JSON_ROUTES: "MINIFLARE_ROUTES",
  JSON_LOG_LEVEL: "MINIFLARE_LOG_LEVEL",
  DATA_LIVE_RELOAD_SCRIPT: "MINIFLARE_LIVE_RELOAD_SCRIPT",
  DURABLE_OBJECT_NAMESPACE_PROXY: "MINIFLARE_PROXY",
  DATA_PROXY_SECRET: "MINIFLARE_PROXY_SECRET",
  DATA_PROXY_SHARED_SECRET: "MINIFLARE_PROXY_SHARED_SECRET",
  TRIGGER_HANDLERS: "TRIGGER_HANDLERS",
  LOG_REQUESTS: "LOG_REQUESTS",
  STRIP_DISABLE_PRETTY_ERROR: "STRIP_DISABLE_PRETTY_ERROR",
  SERVICE_LOCAL_EXPLORER: "MINIFLARE_LOCAL_EXPLORER",
  EXPLORER_DISK: "MINIFLARE_EXPLORER_DISK",
  JSON_LOCAL_EXPLORER_BINDING_MAP: "LOCAL_EXPLORER_BINDING_MAP",
  SERVICE_CACHE: "MINIFLARE_CACHE"
};

// src/workers/images/images.worker.ts
function base64DecodeArrayBuffer(buffer) {
  let base64String = new TextDecoder().decode(buffer), binaryString = atob(base64String.trim()), bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++)
    bytes[i] = binaryString.charCodeAt(i);
  return bytes.buffer;
}
async function base64DecodeStream(stream) {
  let buffer = await new Response(stream).arrayBuffer();
  return base64DecodeArrayBuffer(buffer);
}
var ImagesService = class extends WorkerEntrypoint {
  async details(imageId) {
    return (await this.env.IMAGES_STORE.getWithMetadata(
      imageId,
      "arrayBuffer"
    )).metadata ?? null;
  }
  async image(imageId) {
    let data = await this.env.IMAGES_STORE.get(imageId, "arrayBuffer");
    return data === null ? null : new Blob([data]).stream();
  }
  async upload(image, options) {
    let imageData = image;
    options?.encoding === "base64" && (imageData = image instanceof ArrayBuffer ? base64DecodeArrayBuffer(image) : await base64DecodeStream(image));
    let buffer = imageData instanceof ArrayBuffer ? imageData : await new Response(imageData).arrayBuffer(), id = options?.id ?? crypto.randomUUID(), metadata = {
      id,
      filename: options?.filename ?? "uploaded.jpg",
      uploaded: (/* @__PURE__ */ new Date()).toISOString(),
      requireSignedURLs: options?.requireSignedURLs ?? !1,
      meta: options?.metadata ?? {},
      variants: ["public"],
      draft: !1,
      creator: options?.creator
    };
    return await this.env.IMAGES_STORE.put(id, buffer, { metadata }), metadata;
  }
  async update(imageId, options) {
    let existing = await this.env.IMAGES_STORE.getWithMetadata(
      imageId,
      "arrayBuffer"
    );
    if (existing.value === null || existing.metadata === null)
      throw new Error(`Image not found: ${imageId}`);
    let updatedMetadata = {
      ...existing.metadata,
      requireSignedURLs: options.requireSignedURLs ?? existing.metadata.requireSignedURLs,
      meta: options.metadata ?? existing.metadata.meta,
      creator: options.creator ?? existing.metadata.creator
    };
    return await this.env.IMAGES_STORE.put(imageId, existing.value, {
      metadata: updatedMetadata
    }), updatedMetadata;
  }
  async delete(imageId) {
    return await this.env.IMAGES_STORE.get(imageId, "arrayBuffer") === null ? !1 : (await this.env.IMAGES_STORE.delete(imageId), !0);
  }
  async list(options) {
    let limit = options?.limit ?? 50, allImages = [], kvCursor;
    do {
      let kvResult = await this.env.IMAGES_STORE.list({
        cursor: kvCursor
      });
      for (let key of kvResult.keys)
        key.metadata && allImages.push(key.metadata);
      kvCursor = kvResult.list_complete ? void 0 : kvResult.cursor;
    } while (kvCursor);
    options?.creator && allImages.splice(
      0,
      allImages.length,
      ...allImages.filter((i) => i.creator === options.creator)
    ), allImages.sort((a, b) => {
      let dateA = a.uploaded ?? "", dateB = b.uploaded ?? "", cmp = dateA.localeCompare(dateB) || a.id.localeCompare(b.id);
      return options?.sortOrder === "desc" ? -cmp : cmp;
    });
    let startIndex = 0;
    if (options?.cursor) {
      let cursorIndex = allImages.findIndex((i) => i.id === options.cursor);
      cursorIndex >= 0 && (startIndex = cursorIndex + 1);
    }
    let page = allImages.slice(startIndex, startIndex + limit), hasMore = startIndex + limit < allImages.length, lastImage = page[page.length - 1];
    return {
      images: page,
      cursor: hasMore && lastImage ? lastImage.id : void 0,
      listComplete: !hasMore
    };
  }
  // Handle HTTP requests for info and transform operations
  // These are forwarded to Node.js via the loopback service where Sharp runs
  async fetch(request) {
    let forwardRequest = new Request(request);
    return forwardRequest.headers.set(
      CoreHeaders.CUSTOM_FETCH_SERVICE,
      CoreBindings.IMAGES_SERVICE
    ), forwardRequest.headers.set(CoreHeaders.ORIGINAL_URL, request.url), this.env[CoreBindings.SERVICE_LOOPBACK].fetch(forwardRequest);
  }
};
export {
  ImagesService as default
};
//# sourceMappingURL=images.worker.js.map
