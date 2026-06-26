(function () {
  const DEFAULT_SYSTEM_PROMPT = [
    "你是项目周报助手。请根据用户提供的本周日报 JSON，总结“本周执行情况”。要求：",
    "1. 只基于 JSON 中的 taskDetail，不编造事实。",
    "2. 按项目交付视角合并同类工作，突出完成事项、推进事项、联调/优化/问题处理。",
    "3. 输出中文自然段，可用分号分隔重点。",
    "4. 不要逐人逐日罗列，不要输出 Markdown 标题，不要提到“JSON”或“日报”。",
    "5. 控制在 300-600 字。"
  ].join("\n");

  const fields = {
    baseUrl: document.getElementById("baseUrl"),
    apiKey: document.getElementById("apiKey"),
    model: document.getElementById("model"),
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
      systemPrompt: DEFAULT_SYSTEM_PROMPT
    });
    fields.baseUrl.value = data.baseUrl || "";
    fields.apiKey.value = data.apiKey || "";
    fields.model.value = data.model || "";
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
