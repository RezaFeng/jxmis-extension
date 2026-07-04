(function () {
  const DEFAULT_SYSTEM_PROMPT = (globalThis.CW_DEFAULTS && globalThis.CW_DEFAULTS.systemPrompt) || "";

  const fields = {
    baseUrl: document.getElementById("baseUrl"),
    apiKey: document.getElementById("apiKey"),
    model: document.getElementById("model"),
    enableThinking: document.getElementById("enableThinking"),
    systemPrompt: document.getElementById("systemPrompt"),
    modelList: document.getElementById("modelList"),
    refreshModels: document.getElementById("refreshModels"),
    save: document.getElementById("save"),
    status: document.getElementById("status")
  };

  function setStatus(text, kind) {
    fields.status.textContent = text || "";
    fields.status.className = "status" + (kind ? " " + kind : "");
  }

  function storageGet(defaults) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(defaults, resolve);
    });
  }

  function storageSet(data) {
    return new Promise(function (resolve) {
      chrome.storage.local.set(data, resolve);
    });
  }

  function sendMessage(message) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(message, resolve);
    });
  }

  function readForm() {
    return {
      baseUrl: fields.baseUrl.value.trim(),
      apiKey: fields.apiKey.value.trim(),
      model: fields.model.value.trim(),
      enableThinking: fields.enableThinking.checked,
      systemPrompt: fields.systemPrompt.value.trim() || DEFAULT_SYSTEM_PROMPT
    };
  }

  async function save() {
    await storageSet(readForm());
    setStatus("配置已保存", "ok");
  }

  async function load() {
    const data = await storageGet({
      baseUrl: "",
      apiKey: "",
      model: "",
      enableThinking: false,
      systemPrompt: DEFAULT_SYSTEM_PROMPT
    });
    fields.baseUrl.value = data.baseUrl || "";
    fields.apiKey.value = data.apiKey || "";
    fields.model.value = data.model || "";
    fields.enableThinking.checked = data.enableThinking === true;
    fields.systemPrompt.value = data.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  }

  function renderModels(models) {
    fields.modelList.textContent = "";
    models.forEach(function (model) {
      const option = document.createElement("option");
      option.value = model;
      fields.modelList.appendChild(option);
    });
  }

  async function refreshModels() {
    fields.refreshModels.disabled = true;
    setStatus("正在保存配置并刷新模型...", "");
    try {
      await save();
      const response = await sendMessage({
        type: "CW_AI_FETCH_MODELS"
      });
      if (!response || !response.ok) {
        throw new Error((response && response.error) || "获取模型失败");
      }
      renderModels(response.models || []);
      if (!fields.model.value && response.models && response.models[0]) {
        fields.model.value = response.models[0];
        await save();
      }
      setStatus("已获取 " + (response.models || []).length + " 个模型", "ok");
    } catch (error) {
      setStatus(error && error.message ? error.message : String(error), "error");
    } finally {
      fields.refreshModels.disabled = false;
    }
  }

  fields.save.addEventListener("click", function () {
    save().catch(function (error) {
      setStatus(error && error.message ? error.message : String(error), "error");
    });
  });

  fields.refreshModels.addEventListener("click", function () {
    refreshModels();
  });

  load().catch(function (error) {
    setStatus(error && error.message ? error.message : String(error), "error");
  });
})();
