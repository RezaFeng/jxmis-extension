export function createBusinessAnalyticsReportView(adapters) {
  const document = adapters.document;
  let elements;

  function mount(shadowRoot) {
    if (elements && elements.root.isConnected) return;
    elements = null;
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = adapters.cssUrl;
    const root = document.createElement("div");
    root.className = "analytics-app";
    root.innerHTML = `
      <header class="report-toolbar">
        <button type="button" class="icon-button" data-action="close" title="返回项目页面" aria-label="返回项目页面">←</button>
        <div class="report-title"><strong>经营分析</strong><span data-role="period-label">部门经营报告</span></div>
        <label><span>部门</span><select data-field="department"><option value="">加载中...</option></select></label>
        <label><span>开始日期</span><input data-field="startDate" type="date"></label>
        <label><span>结束日期</span><input data-field="endDate" type="date"></label>
        <div class="toolbar-actions">
          <button type="button" class="primary" data-action="query">查询</button>
          <button type="button" data-action="refresh">刷新</button>
          <button type="button" data-action="cancel" hidden>取消</button>
          <button type="button" data-action="export" disabled>导出HTML</button>
          <button type="button" class="icon-button" data-action="settings" title="设置" aria-label="设置">⚙</button>
        </div>
        <span class="data-status" data-role="data-status">未查询</span>
      </header>
      <main class="report-content">
        <section class="state-panel" data-role="state" aria-live="polite">
          <strong data-role="state-title">准备查询</strong>
          <p data-role="state-message">请选择部门和日期后查询。</p>
          <div class="progress" data-role="progress" hidden><span></span></div>
        </section>
        <section class="report-summary" data-role="summary" hidden></section>
      </main>`;
    shadowRoot.append(stylesheet, root);
    elements = {
      root,
      department: root.querySelector('[data-field="department"]'),
      startDate: root.querySelector('[data-field="startDate"]'),
      endDate: root.querySelector('[data-field="endDate"]'),
      status: root.querySelector('[data-role="data-status"]'),
      stateTitle: root.querySelector('[data-role="state-title"]'),
      stateMessage: root.querySelector('[data-role="state-message"]'),
      progress: root.querySelector('[data-role="progress"]'),
      progressBar: root.querySelector('[data-role="progress"] span'),
      summary: root.querySelector('[data-role="summary"]'),
      cancel: root.querySelector('[data-action="cancel"]')
    };
    root.querySelectorAll("[data-action]").forEach(function (button) {
      button.addEventListener("click", function () { adapters.onAction(button.dataset.action); });
    });
  }

  function setDateRange(range) {
    elements.startDate.value = range.startDate;
    elements.endDate.value = range.endDate;
  }

  function setDepartments(departments) {
    elements.department.textContent = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "请选择部门";
    elements.department.appendChild(placeholder);
    (departments || []).forEach(function (department) {
      const option = document.createElement("option");
      option.value = department.id;
      option.textContent = department.name + "（" + department.projectCount + "）";
      elements.department.appendChild(option);
    });
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = "全部部门";
    elements.department.appendChild(all);
  }

  function getQuery() {
    return {
      departmentId: elements.department.value,
      departmentName: elements.department.selectedOptions[0]?.textContent || "",
      startDate: elements.startDate.value,
      endDate: elements.endDate.value
    };
  }

  function renderState(state) {
    const states = {
      initial: ["准备查询", "请选择部门和日期后查询。"],
      scope: ["加载部门", "正在读取当前可访问的部门和项目范围..."],
      loading: ["生成报告", state.message || "正在获取经营数据..."],
      empty: ["当前筛选无项目", "当前配置和部门下没有匹配项目。"],
      partial: ["报告部分可用", state.message || "部分数据未获取，可查看完整性诊断。"],
      session: ["登录已失效", "请重新登录 JXPMO 后重试。"],
      error: ["查询失败", state.message || "经营数据查询失败。"],
      ready: ["报告已生成", state.message || "经营数据已完成。"]
    };
    const value = states[state.kind] || states.initial;
    elements.stateTitle.textContent = value[0];
    elements.stateMessage.textContent = value[1];
    elements.status.textContent = state.status || value[0];
    const loading = state.kind === "loading" || state.kind === "scope";
    elements.progress.hidden = !loading;
    elements.cancel.hidden = !loading;
    elements.progressBar.style.width = String(state.percent || (loading ? 12 : 0)) + "%";
  }

  function renderResult(result) {
    elements.summary.hidden = false;
    elements.summary.textContent = "已加载 " + result.projects.length + " 个项目，数据覆盖率 " +
      Math.round(result.coverage * 100) + "%";
  }

  return { mount, setDateRange, setDepartments, getQuery, renderState, renderResult };
}
