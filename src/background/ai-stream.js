import { AI_PORT_TYPES } from "../shared/protocol.js";

export function getChoiceText(choice) {
  const delta = choice && choice.delta;
  const message = choice && choice.message;
  return String(
    (delta && delta.content) ||
      (delta && delta.text) ||
      (choice && choice.text) ||
      (message && message.content) ||
      ""
  );
}

export function getChoiceReasoningText(choice) {
  const delta = choice && choice.delta;
  const message = choice && choice.message;
  return String(
    (delta && (delta.reasoning_content || delta.reasoning)) ||
      (message && (message.reasoning_content || message.reasoning)) ||
      ""
  );
}

export function createStreamState(requestId) {
  return {
    requestId: requestId || "",
    textChunkCount: 0,
    reasoningChunkCount: 0,
    emptyChunkCount: 0
  };
}

export function readStreamLine(line, port, streamState, logger = console) {
  const trimmed = String(line || "").trim();
  if (!trimmed || !trimmed.startsWith("data:")) {
    return false;
  }
  const payload = trimmed.slice(5).trim();
  if (payload === "[DONE]") {
    return true;
  }

  try {
    const json = JSON.parse(payload);
    const choice = json && json.choices && json.choices[0];
    const text = getChoiceText(choice);
    if (text) {
      streamState.textChunkCount += 1;
      if (streamState.textChunkCount === 1) {
        port.postMessage({
          type: AI_PORT_TYPES.STATUS,
          message: "已解析到模型正文，开始写入周报总结"
        });
      }
      port.postMessage({ type: AI_PORT_TYPES.CHUNK, text: text });
      return false;
    }

    const reasoningText = getChoiceReasoningText(choice);
    if (reasoningText) {
      streamState.reasoningChunkCount += 1;
      port.postMessage({
        type: AI_PORT_TYPES.REASONING,
        index: streamState.reasoningChunkCount,
        text: reasoningText
      });
      if (streamState.reasoningChunkCount === 1) {
        port.postMessage({
          type: AI_PORT_TYPES.STATUS,
          message: "模型正在输出推理内容，等待周报正文片段"
        });
      }
      return false;
    }

    streamState.emptyChunkCount += 1;
  } catch (error) {
    logger.warn("[cw-weekly-summary-ai] ignored malformed stream line", error);
    port.postMessage({
      type: AI_PORT_TYPES.WARNING,
      message: "忽略无法解析的模型流片段"
    });
  }
  return false;
}
