  const DEFAULT_PROVIDER = "deepseek";
  const PROVIDERS = {
    DEEPSEEK: "deepseek",
    MODELSCOPE: "modelscope",
    OPENAI_COMPATIBLE: "openai-compatible"
  };

  function normalizeProvider(provider) {
    const value = String(provider || "").trim().toLowerCase();
    if (
      value === PROVIDERS.DEEPSEEK ||
      value === PROVIDERS.MODELSCOPE ||
      value === PROVIDERS.OPENAI_COMPATIBLE
    ) {
      return value;
    }
    return DEFAULT_PROVIDER;
  }

  function applyThinkingConfig(requestBody, provider, enableThinking) {
    const normalizedProvider = normalizeProvider(provider);
    const thinkingEnabled = enableThinking === true;

    if (normalizedProvider === PROVIDERS.MODELSCOPE) {
      requestBody.chat_template_kwargs = {
        enable_thinking: thinkingEnabled
      };
      return requestBody;
    }

    if (normalizedProvider === PROVIDERS.OPENAI_COMPATIBLE) {
      requestBody.reasoning_effort = thinkingEnabled ? "high" : "none";
      return requestBody;
    }

    requestBody.thinking = {
      type: thinkingEnabled ? "enabled" : "disabled"
    };
    if (thinkingEnabled) {
      requestBody.reasoning_effort = "high";
    }
    return requestBody;
  }

  function createChatRequestBody(options) {
    const data = options || {};
    const requestBody = {
      model: data.model,
      stream: true,
      messages: [
        {
          role: "system",
          content: data.systemPrompt
        },
        {
          role: "user",
          content: data.userPrompt
        }
      ]
    };
    return applyThinkingConfig(requestBody, data.provider, data.enableThinking);
  }

  export {
    DEFAULT_PROVIDER,
    PROVIDERS,
    normalizeProvider,
    applyThinkingConfig,
    createChatRequestBody
  };
