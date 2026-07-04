(function () {
  const DEFAULT_SYSTEM_PROMPT = [
    "你是项目周报助手。请根据用户提供的本周日报 JSON，总结“本周执行情况”。要求：",
    "1. 只基于 JSON 中的 taskDetail，不编造事实。",
    "2. 按项目交付视角合并同类工作项，突出完成事项、推进事项、联调/优化/问题处理，不同人的工作内容分开罗列，完成项必须分开罗列，不要一行罗列多个完成项。",
    "3. 输出中文自然段，可用分号分隔重点。",
    "4. 不要逐人逐日罗列，不要输出 Markdown 标题，不要提到“JSON”或“日报”，不要提及人名，不要在同一行的任务描述中罗列多个完成项。",
    "5. 严格按照模板的文字风格和排版风格， 有序号，有换行",
    "# 模板",
    "1. 完成施工方案内容完整性督查能力建设，覆盖专项施工方案文档结构完整性、工程概况和特点及施工难点要点完整性、人员架构完整性、倒杆风险防控措施、触电应急措施、跨越措施、危大工程验收要求等规则；",
    "2. 完成施工方案内容合规性督查能力建设，覆盖吊装作业风险评估错误、起重机与带电体最小安全距离校验、钢丝绳强度计算与机具清单一致性校验等规则；",
    "3. 完成施工方案内容逻辑性督查能力建设，新增专项施工方案报审时间与勘察单现场勘察时间前后关系校验规则；",
    "4. 完成带电作业未退出重合闸或自愈功能规则开发；",
    "5. 完成应合接地刀闸或应装接地线装设地点填写不规范规则开发；",
    "6. 完成OMS作业计划（调度）场景下C09、D10违章不输出规则调整。"
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
