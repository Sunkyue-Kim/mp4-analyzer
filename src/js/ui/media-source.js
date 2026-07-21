const MEDIA_PREVIEW_PRELOAD = "metadata";
const MEDIA_PREVIEW_HAVE_METADATA = 1;
const MEDIA_PREVIEW_HAVE_CURRENT_DATA = 2;
const MEDIA_PREVIEW_FRAME_SEEK_NUDGE_SECONDS = 0.001;
const REMOTE_SHARED_DOWNLOAD_LIMIT_BYTES = 4 * 1024 * 1024;

function getMediaResourceKind(resource) {
  return resource && resource.kind === "remote-url" ? "remote-url" : "local-file";
}

function createMediaPreviewPlan(resource, options = {}) {
  const sourceKind = getMediaResourceKind(resource);
  const suppliedPreviewUrl = options.previewUrl || resource && resource.previewUrl || "";
  if (suppliedPreviewUrl) {
    return {
      sourceKind,
      url: suppliedPreviewUrl,
      isObjectUrl: false,
      preload: MEDIA_PREVIEW_PRELOAD,
      title: ""
    };
  }

  const objectUrlFactory = options.objectUrlFactory || getDefaultObjectUrlFactory();
  return {
    sourceKind,
    url: objectUrlFactory(resource),
    isObjectUrl: true,
    preload: MEDIA_PREVIEW_PRELOAD,
    title: ""
  };
}

function getDefaultObjectUrlFactory() {
  if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    return (resource) => URL.createObjectURL(resource);
  }
  throw new Error("Object URL creation is not available in this environment.");
}

function shouldDownloadRemoteOnceForSharedPlayback(resource, options = {}) {
  if (options.forceStreaming) return false;
  const size = Number(resource && resource.size || 0);
  return Number.isFinite(size) && size > 0 && size <= REMOTE_SHARED_DOWNLOAD_LIMIT_BYTES;
}

function prepareMediaPreviewFrame(mediaElement) {
  if (!mediaElement || !mediaElement.src) return { status: "unavailable", targetTime: null };
  const currentTime = getMediaPreviewCurrentTime(mediaElement);
  if (mediaElement.seeking) return { status: "pending", targetTime: currentTime };
  if (Number(mediaElement.readyState) >= MEDIA_PREVIEW_HAVE_CURRENT_DATA) {
    return { status: "ready", targetTime: currentTime };
  }
  if (Number(mediaElement.readyState) < MEDIA_PREVIEW_HAVE_METADATA) {
    return { status: "metadata-pending", targetTime: null };
  }
  const targetTime = getMediaPreviewFrameSeekTarget(mediaElement, currentTime);
  try {
    mediaElement.currentTime = targetTime;
    return { status: "requested", targetTime };
  } catch (_) {
    return { status: "unavailable", targetTime: null };
  }
}

function getMediaPreviewFrameSeekTarget(mediaElement, currentTime = getMediaPreviewCurrentTime(mediaElement)) {
  const duration = Number(mediaElement && mediaElement.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    return currentTime + MEDIA_PREVIEW_FRAME_SEEK_NUDGE_SECONDS;
  }
  const remainingDuration = Math.max(0, duration - currentTime);
  if (remainingDuration > 0) {
    return currentTime + Math.min(
      MEDIA_PREVIEW_FRAME_SEEK_NUDGE_SECONDS,
      remainingDuration / 2
    );
  }
  return Math.max(
    0,
    currentTime - Math.min(MEDIA_PREVIEW_FRAME_SEEK_NUDGE_SECONDS, currentTime / 2)
  );
}

function getMediaPreviewCurrentTime(mediaElement) {
  const currentTime = Number(mediaElement && mediaElement.currentTime);
  return Number.isFinite(currentTime) && currentTime >= 0 ? currentTime : 0;
}

export {
  MEDIA_PREVIEW_FRAME_SEEK_NUDGE_SECONDS,
  MEDIA_PREVIEW_PRELOAD,
  REMOTE_SHARED_DOWNLOAD_LIMIT_BYTES,
  createMediaPreviewPlan,
  getMediaResourceKind,
  getMediaPreviewFrameSeekTarget,
  prepareMediaPreviewFrame,
  shouldDownloadRemoteOnceForSharedPlayback
};
