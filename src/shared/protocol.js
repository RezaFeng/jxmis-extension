export const SOURCES = Object.freeze({
  PROJECT_MANAGER: "cw-project-manager-config",
  DAILY_PAGE: "cw-daily-approval-page",
  DAILY_CONTENT: "cw-daily-approval-content",
  WORK_PAGE: "cw-batch-work-page",
  WORK_CONTENT: "cw-batch-work-content",
  WEEKLY_PAGE: "cw-weekly-approval-page",
  WEEKLY_CONTENT: "cw-weekly-approval-content"
});

export const MESSAGE_TYPES = Object.freeze({
  PROJECT_MANAGER_CONFIG: "CW_PROJECT_MANAGER_OVERRIDE_CONFIG",
  AI_FETCH_MODELS: "CW_AI_FETCH_MODELS",

  DAILY_START: "CW_DAILY_APPROVAL_START",
  DAILY_RUNNING: "CW_DAILY_APPROVAL_RUNNING",
  DAILY_PROGRESS: "CW_DAILY_APPROVAL_PROGRESS",
  DAILY_DONE: "CW_DAILY_APPROVAL_DONE",
  DAILY_ERROR: "CW_DAILY_APPROVAL_ERROR",

  WORK_START: "CW_BATCH_WORK_START",
  WORK_RUNNING: "CW_BATCH_WORK_RUNNING",
  WORK_DONE: "CW_BATCH_WORK_DONE",
  WORK_ERROR: "CW_BATCH_WORK_ERROR",

  TOOLBAR_ACTION: "CW_TOOLBAR_ACTION",
  TOOLBAR_RUNNING: "CW_TOOLBAR_ACTION_RUNNING",
  TOOLBAR_DONE: "CW_TOOLBAR_ACTION_DONE",
  TOOLBAR_ERROR: "CW_TOOLBAR_ACTION_ERROR",

  WEEKLY_START: "CW_WEEKLY_APPROVAL_START",
  WEEKLY_RUNNING: "CW_WEEKLY_APPROVAL_RUNNING",
  WEEKLY_PROGRESS: "CW_WEEKLY_APPROVAL_PROGRESS",
  WEEKLY_PREVIEW: "CW_WEEKLY_APPROVAL_PREVIEW",
  WEEKLY_DONE: "CW_WEEKLY_APPROVAL_DONE",
  WEEKLY_ERROR: "CW_WEEKLY_APPROVAL_ERROR",

  AI_REQUEST: "CW_WEEKLY_SUMMARY_AI_REQUEST",
  AI_STATUS: "CW_WEEKLY_SUMMARY_AI_STATUS",
  AI_REASONING: "CW_WEEKLY_SUMMARY_AI_REASONING",
  AI_CHUNK: "CW_WEEKLY_SUMMARY_AI_CHUNK",
  AI_DONE: "CW_WEEKLY_SUMMARY_AI_DONE",
  AI_ERROR: "CW_WEEKLY_SUMMARY_AI_ERROR",

  CACHE_GET: "CW_WEEKLY_SUMMARY_CACHE_GET",
  CACHE_SET: "CW_WEEKLY_SUMMARY_CACHE_SET",
  CACHE_GET_RESULT: "CW_WEEKLY_SUMMARY_CACHE_GET_RESULT",
  CACHE_SET_RESULT: "CW_WEEKLY_SUMMARY_CACHE_SET_RESULT"
});

export const AI_PORT_TYPES = Object.freeze({
  START: "start",
  STATUS: "status",
  WARNING: "warning",
  REASONING: "reasoning",
  CHUNK: "chunk",
  DONE: "done",
  ERROR: "error"
});

const KNOWN_SOURCES = new Set(Object.values(SOURCES));
const KNOWN_MESSAGE_TYPES = new Set(Object.values(MESSAGE_TYPES));
const KNOWN_AI_PORT_TYPES = new Set(Object.values(AI_PORT_TYPES));
const REQUEST_ID_TYPES = new Set([
  MESSAGE_TYPES.AI_REQUEST,
  MESSAGE_TYPES.AI_STATUS,
  MESSAGE_TYPES.AI_REASONING,
  MESSAGE_TYPES.AI_CHUNK,
  MESSAGE_TYPES.AI_DONE,
  MESSAGE_TYPES.AI_ERROR,
  MESSAGE_TYPES.CACHE_GET,
  MESSAGE_TYPES.CACHE_SET,
  MESSAGE_TYPES.CACHE_GET_RESULT,
  MESSAGE_TYPES.CACHE_SET_RESULT
]);

function invalid(error) {
  return { ok: false, error: error, value: null };
}

function valid(value) {
  return { ok: true, error: "", value: value };
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isValidRequestId(value) {
  return typeof value === "string" && value.trim() !== "";
}

export function createMessage(source, type, payload = {}) {
  if (!KNOWN_SOURCES.has(source)) {
    throw new Error("unknown message source: " + String(source || ""));
  }
  if (!KNOWN_MESSAGE_TYPES.has(type)) {
    throw new Error("unknown message type: " + String(type || ""));
  }
  if (!isRecord(payload)) {
    throw new TypeError("message payload must be an object");
  }
  return Object.assign({}, payload, { source: source, type: type });
}

export function createRequestMessage(source, type, requestId, payload = {}) {
  if (!isValidRequestId(requestId)) {
    throw new Error("requestId is required");
  }
  return createMessage(source, type, Object.assign({}, payload, { requestId: requestId }));
}

export function parseMessage(value, options = {}) {
  if (!isRecord(value)) {
    return invalid("message must be an object");
  }
  if (!KNOWN_SOURCES.has(value.source)) {
    return invalid("unknown message source");
  }
  if (!KNOWN_MESSAGE_TYPES.has(value.type)) {
    return invalid("unknown message type");
  }
  if (options.source && value.source !== options.source) {
    return invalid("unexpected message source");
  }
  if (Array.isArray(options.types) && !options.types.includes(value.type)) {
    return invalid("unexpected message type");
  }
  const requiresRequestId = options.requireRequestId === true || REQUEST_ID_TYPES.has(value.type);
  if (requiresRequestId && !isValidRequestId(value.requestId)) {
    return invalid("requestId is required");
  }
  return valid(value);
}

export function parseWindowMessage(event, options = {}) {
  if (!event || (options.windowRef && event.source !== options.windowRef)) {
    return invalid("unexpected window source");
  }
  return parseMessage(event.data, options);
}

export function parseAiPortEvent(value) {
  if (!isRecord(value) || !KNOWN_AI_PORT_TYPES.has(value.type)) {
    return invalid("unknown AI port event");
  }
  if (value.type === AI_PORT_TYPES.START) {
    if (!isValidRequestId(value.requestId)) {
      return invalid("AI start requestId is required");
    }
    if (typeof value.userPrompt !== "string" || value.userPrompt.trim() === "") {
      return invalid("AI start userPrompt is required");
    }
  }
  if (
    (value.type === AI_PORT_TYPES.REASONING || value.type === AI_PORT_TYPES.CHUNK) &&
    typeof value.text !== "string"
  ) {
    return invalid("AI text event requires text");
  }
  if (
    (value.type === AI_PORT_TYPES.STATUS ||
      value.type === AI_PORT_TYPES.WARNING ||
      value.type === AI_PORT_TYPES.ERROR) &&
    value.message != null &&
    typeof value.message !== "string"
  ) {
    return invalid("AI status event message must be text");
  }
  return valid(value);
}

export function getCacheResultType(type) {
  if (type === MESSAGE_TYPES.CACHE_GET) {
    return MESSAGE_TYPES.CACHE_GET_RESULT;
  }
  if (type === MESSAGE_TYPES.CACHE_SET) {
    return MESSAGE_TYPES.CACHE_SET_RESULT;
  }
  throw new Error("not a cache request type: " + String(type || ""));
}

export function createCacheResult(source, requestType, requestId, response = {}) {
  return createRequestMessage(
    source,
    getCacheResultType(requestType),
    requestId,
    {
      ok: Boolean(response.ok),
      cache: response.cache,
      error: response.error
    }
  );
}
