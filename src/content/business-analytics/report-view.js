export function filterProjectRows(projects, filters) {
  const search = String(filters.search || "").trim().toLowerCase();
  return projects.filter(function (project) {
    if (filters.status && String(project.currStatus) !== filters.status) return false;
    if (filters.pm && String(project.projectManagerName || "未指定") !== filters.pm) return false;
    if (filters.activity === "yes" && !(project.inputMd > 0)) return false;
    if (filters.activity === "no" && project.inputMd > 0) return false;
    if (filters.risk && !(project.risks || []).some(function (risk) { return risk.type === filters.risk; })) return false;
    if (search && !String(project.projectNo + " " + project.projectName).toLowerCase().includes(search)) return false;
    return true;
  });
}

export function createBusinessAnalyticsReportView(adapters) {
  const document = adapters.document;
  let elements;
  let formalReport;
  let selectedIds = new Set();

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

  function formatValue(value, format) {
    if (value === null || value === undefined) return "无法历史回溯";
    if (format === "money") return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value / 10000) + " 万元";
    if (format === "percent") return new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 }).format(value);
    if (format === "ratio") return Number(value).toFixed(2);
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
  }

  function appendCardGrid(container, cards) {
    const grid = document.createElement("div");
    grid.className = "metric-grid";
    cards.forEach(function (card) {
      const item = document.createElement("article");
      item.className = "metric-card";
      const label = document.createElement("span");
      label.textContent = card.label;
      item.appendChild(label);
      card.values.forEach(function (value) {
        const number = document.createElement("strong");
        number.textContent = formatValue(value.value, value.format);
        if (value.status === "unavailable") number.className = "unavailable";
        item.appendChild(number);
      });
      grid.appendChild(item);
    });
    container.appendChild(grid);
  }

  function addOption(select, value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  function renderProjectTable(container, report) {
    const projects = formalReport.tables.projects;
    const controls = document.createElement("div");
    controls.className = "project-filters";
    controls.innerHTML = `
      <input type="search" data-filter="search" placeholder="搜索编码或名称" aria-label="搜索项目">
      <select data-filter="status" aria-label="项目状态"><option value="">全部状态</option></select>
      <select data-filter="pm" aria-label="项目经理"><option value="">全部项目经理</option></select>
      <select data-filter="activity" aria-label="投入状态"><option value="">全部投入状态</option><option value="yes">有投入</option><option value="no">无投入</option></select>
      <select data-filter="risk" aria-label="风险"><option value="">全部风险</option></select>
      <button type="button" data-action="restore-selection">恢复部门全量</button>
      <span data-role="selection-count"></span>`;
    const status = controls.querySelector('[data-filter="status"]');
    const pm = controls.querySelector('[data-filter="pm"]');
    const risk = controls.querySelector('[data-filter="risk"]');
    [...new Set(projects.map(function (item) { return String(item.currStatus || ""); }).filter(Boolean))]
      .forEach(function (value) { addOption(status, value, value); });
    [...new Set(projects.map(function (item) { return item.projectManagerName || "未指定"; }))]
      .forEach(function (value) { addOption(pm, value, value); });
    const risks = new Map();
    projects.forEach(function (project) { (project.risks || []).forEach(function (item) { risks.set(item.type, item.label); }); });
    risks.forEach(function (label, value) { addOption(risk, value, label); });
    const tableWrap = document.createElement("div");
    tableWrap.className = "table-scroll";
    const table = document.createElement("table");
    table.innerHTML = "<thead><tr><th></th><th>编码</th><th>项目名称</th><th>PM</th><th>状态</th><th>收入</th><th>BAC</th><th>AC</th><th>EV</th><th>CR</th><th>进度</th><th>人均</th><th>CPI</th><th>CCPI</th><th>EAC</th><th>总SPI</th><th>风险</th></tr></thead><tbody></tbody>";
    tableWrap.appendChild(table);
    container.append(controls, tableWrap);
    const tbody = table.querySelector("tbody");
    const count = controls.querySelector('[data-role="selection-count"]');

    function filters() {
      return Object.fromEntries([...controls.querySelectorAll("[data-filter]")].map(function (input) {
        return [input.dataset.filter, input.value];
      }));
    }
    function notify(ids) {
      selectedIds = new Set(ids);
      count.textContent = ids.length === projects.length ? "部门全量 " + projects.length : "已选项目分析 " + ids.length + "/" + projects.length;
      adapters.onSelection(ids.length === projects.length ? null : ids);
    }
    function draw(rows) {
      tbody.textContent = "";
      rows.forEach(function (project) {
        const tr = document.createElement("tr");
        const values = [project.projectNo, project.projectName, project.projectManagerName || "未指定", project.currStatusDesc || project.currStatus,
          formatValue(project.revenue, "money"), formatValue(project.bac, "money"), formatValue(project.ac, "money"), formatValue(project.ev, "money"), formatValue(project.cr, "money"),
          formatValue(project.progress, "percent"), formatValue(project.perCapita, "money"), formatValue(project.cpi, "ratio"), formatValue(project.ccpi, "ratio"), formatValue(project.eac, "money"), formatValue(project.totalSPI, "ratio"),
          (project.risks || []).map(function (item) { return item.label; }).join("、") || "-"];
        const checkCell = document.createElement("td");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = selectedIds.has(project.projectId);
        checkbox.addEventListener("change", function () {
          if (checkbox.checked) selectedIds.add(project.projectId); else selectedIds.delete(project.projectId);
          notify([...selectedIds]);
        });
        checkCell.appendChild(checkbox);
        tr.appendChild(checkCell);
        values.forEach(function (value) { const td = document.createElement("td"); td.textContent = value; tr.appendChild(td); });
        tbody.appendChild(tr);
      });
    }
    controls.addEventListener("input", function () {
      const rows = filterProjectRows(projects, filters());
      selectedIds = new Set(rows.map(function (item) { return item.projectId; }));
      draw(rows);
      notify([...selectedIds]);
    });
    controls.querySelector('[data-action="restore-selection"]').addEventListener("click", function () {
      controls.querySelectorAll("[data-filter]").forEach(function (input) { input.value = ""; });
      selectedIds = new Set(projects.map(function (item) { return item.projectId; }));
      draw(projects);
      notify([...selectedIds]);
    });
    draw(projects);
    count.textContent = report.scope.mode === "selection"
      ? "已选项目分析 " + report.scope.selectedCount + "/" + projects.length
      : "部门全量 " + projects.length;
  }

  function renderReport(report, options = {}) {
    if (options.formal) {
      formalReport = report;
      selectedIds = new Set(report.tables.projects.map(function (item) { return item.projectId; }));
    }
    if (!formalReport) return;
    if (!options.formal) {
      const executiveText = elements.summary.querySelector('[data-role="executive-text"]');
      const cardHost = elements.summary.querySelector('[data-role="overview-cards"]');
      const count = elements.summary.querySelector('[data-role="selection-count"]');
      if (executiveText && cardHost) {
        executiveText.textContent = report.metrics.risks.attentionProjectCount > 0
          ? report.metrics.risks.attentionProjectCount + " 个项目需要关注，共 " + report.metrics.risks.itemCount + " 项风险。"
          : "当前口径未命中经营风险。";
        cardHost.textContent = "";
        appendCardGrid(cardHost, report.cards.overview);
        if (count) count.textContent = "已选项目分析 " + report.scope.selectedCount + "/" + formalReport.tables.projects.length;
        return;
      }
    }
    elements.summary.hidden = false;
    elements.summary.textContent = "";
    const executive = document.createElement("section");
    executive.className = "report-section executive";
    const executiveTitle = document.createElement("h2");
    executiveTitle.textContent = "本期例会速览与风险预警";
    const executiveText = document.createElement("p");
    executiveText.dataset.role = "executive-text";
    executiveText.textContent = report.metrics.risks.attentionProjectCount > 0
      ? report.metrics.risks.attentionProjectCount + " 个项目需要关注，共 " + report.metrics.risks.itemCount + " 项风险。"
      : "当前口径未命中经营风险。";
    executive.append(executiveTitle, executiveText);
    const overview = document.createElement("section");
    overview.className = "report-section";
    const title = document.createElement("h2");
    title.textContent = "部门经营概览";
    overview.appendChild(title);
    const overviewCards = document.createElement("div");
    overviewCards.dataset.role = "overview-cards";
    overview.appendChild(overviewCards);
    appendCardGrid(overviewCards, report.cards.overview);
    const projects = document.createElement("section");
    projects.className = "report-section";
    const projectTitle = document.createElement("h2");
    projectTitle.textContent = "项目明细";
    projects.appendChild(projectTitle);
    renderProjectTable(projects, report);
    elements.summary.append(executive, overview, projects);
  }

  return { mount, setDateRange, setDepartments, getQuery, renderState, renderResult, renderReport };
}
