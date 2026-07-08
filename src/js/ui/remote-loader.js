function normalizeRemoteMediaUrl(rawUrl, baseUrl) {
  const trimmedUrl = String(rawUrl || "").trim();
  if (!trimmedUrl) throw new Error("Remote URL is empty.");
  const parsedUrl = new URL(trimmedUrl, baseUrl || (typeof window !== "undefined" ? window.location.href : undefined));
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Only http:// and https:// media URLs are supported.");
  }
  return parsedUrl.href;
}

async function probeRemoteMediaResource(rawUrl, options = {}) {
  const url = normalizeRemoteMediaUrl(rawUrl, options.baseUrl);
  const controllerSignal = options.signal;
  const headProbe = await probeRemoteHead(url, controllerSignal);
  const rangeProbe = await probeRemoteRange(url, controllerSignal);
  const size = rangeProbe.size || headProbe.size || 0;
  const type = options.type || headProbe.type || rangeProbe.type || "";
  const name = options.name || inferRemoteFileName(url, headProbe.contentDisposition) || "remote-media";
  const fallbackReason = rangeProbe.reason || headProbe.reason || "HTTP range support could not be verified.";
  if (rangeProbe.supported && Number.isFinite(size) && size > 0) {
    return {
      canStream: true,
      fallbackReason: "",
      resource: {
        kind: "remote-url",
        url,
        previewUrl: url,
        name,
        size,
        type,
        rangeSupported: true,
        lastModified: 0
      }
    };
  }
  return {
    canStream: false,
    fallbackReason,
    resource: null,
    fallback: {
      url,
      name,
      type,
      size
    }
  };
}

async function probeRemoteHead(url, signal) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      method: "HEAD",
      signal
    });
    if (!response.ok) {
      return { reason: "HEAD request failed: " + response.status + " " + response.statusText };
    }
    return {
      size: parseContentLength(response.headers),
      type: response.headers.get("Content-Type") || "",
      contentDisposition: response.headers.get("Content-Disposition") || "",
      acceptsRanges: /\bbytes\b/i.test(response.headers.get("Accept-Ranges") || ""),
      reason: /\bbytes\b/i.test(response.headers.get("Accept-Ranges") || "") ? "" : "HEAD did not advertise byte ranges."
    };
  } catch (error) {
    if (isAbortError(error)) throw new Error("Remote load cancelled.");
    return { reason: "HEAD request failed: " + getErrorMessage(error) };
  }
}

async function probeRemoteRange(url, signal) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Range: "bytes=0-0" },
      signal
    });
    if (response.status !== 206) {
      return { supported: false, reason: "Range probe returned HTTP " + response.status + " instead of 206." };
    }
    await response.arrayBuffer();
    return {
      supported: true,
      size: parseContentRangeSize(response.headers.get("Content-Range")) || parseContentLength(response.headers),
      type: response.headers.get("Content-Type") || "",
      reason: ""
    };
  } catch (error) {
    if (isAbortError(error)) throw new Error("Remote load cancelled.");
    return { supported: false, reason: "Range probe failed: " + getErrorMessage(error) };
  }
}

async function downloadRemoteMediaFile(rawUrl, metadata = {}, options = {}) {
  const url = normalizeRemoteMediaUrl(rawUrl, options.baseUrl);
  const response = await fetch(url, {
    cache: "no-store",
    signal: options.signal
  });
  if (!response.ok) throw new Error("Download failed: " + response.status + " " + response.statusText);
  const type = metadata.type || response.headers.get("Content-Type") || "";
  const size = metadata.size || parseContentLength(response.headers) || 0;
  const name = metadata.name || inferRemoteFileName(url, response.headers.get("Content-Disposition") || "") || "remote-media";
  const blob = await readResponseBlobWithProgress(response, {
    type,
    size,
    signal: options.signal,
    onProgress: options.onProgress
  });
  return new File([blob], name, {
    type: type || blob.type || "",
    lastModified: 0
  });
}

async function readResponseBlobWithProgress(response, options = {}) {
  const totalSize = options.size || parseContentLength(response.headers) || 0;
  if (!response.body || typeof response.body.getReader !== "function") {
    const blob = await response.blob();
    if (options.onProgress) options.onProgress(blob.size || totalSize, blob.size || totalSize);
    return blob;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let loadedBytes = 0;
  while (true) {
    if (options.signal && options.signal.aborted) throw new Error("Remote load cancelled.");
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
    loadedBytes += result.value.byteLength;
    if (options.onProgress) options.onProgress(loadedBytes, totalSize);
  }
  return new Blob(chunks, { type: options.type || "" });
}

function parseContentLength(headers) {
  const value = Number(headers && headers.get ? headers.get("Content-Length") : 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function parseContentRangeSize(contentRange) {
  const match = String(contentRange || "").match(/\/(\d+)$/);
  if (!match) return 0;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function inferRemoteFileName(url, contentDisposition) {
  const dispositionName = parseContentDispositionFileName(contentDisposition);
  if (dispositionName) return dispositionName;
  const pathname = new URL(url).pathname;
  const pathName = decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "");
  return pathName || "";
}

function parseContentDispositionFileName(contentDisposition) {
  const value = String(contentDisposition || "");
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) return decodeURIComponent(utf8Match[1].trim().replace(/^"|"$/g, ""));
  const asciiMatch = value.match(/filename=([^;]+)/i);
  if (asciiMatch) return asciiMatch[1].trim().replace(/^"|"$/g, "");
  return "";
}

function isAbortError(error) {
  return Boolean(error && (error.name === "AbortError" || /cancelled|aborted/i.test(error.message || "")));
}

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error);
}

export {
  normalizeRemoteMediaUrl,
  probeRemoteMediaResource,
  downloadRemoteMediaFile,
  parseContentRangeSize,
  inferRemoteFileName
};
