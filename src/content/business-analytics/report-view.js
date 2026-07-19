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

function formatOperationalValue(value, format) {
  if (value === null || value === undefined) return "未获取";
  if (format === "money") {
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value / 10000) + " 万元";
  }
  if (format === "percent") {
    return new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 }).format(value);
  }
  if (format === "ratio") return Number(value).toFixed(2);
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value);
}

function appendOperationalCards(document, container, cards) {
  const grid = document.createElement("div");
  grid.className = "metric-grid";
  (cards || []).forEach(function (card) {
    const item = document.createElement("article");
    item.className = "metric-card";
    const label = document.createElement("span");
    label.textContent = card.label;
    item.appendChild(label);
    card.values.forEach(function (value) {
      const number = document.createElement("strong");
      number.textContent = formatOperationalValue(value.value, value.format);
      if (value.status === "unavailable") number.className = "unavailable";
      item.appendChild(number);
    });
    if (card.note) {
      const note = document.createElement("small");
      const parts = [];
      parts.push(card.note.count === null || card.note.count === undefined
        ? "笔数未获取"
        : card.note.count + " 笔");
      if (Object.prototype.hasOwnProperty.call(card.note, "rate")) {
        parts.push("回款率 " + (card.note.rate === null || card.note.rate === undefined
          ? "-"
          : formatOperationalValue(card.note.rate, "percent")));
      }
      note.textContent = parts.join(" · ");
      item.appendChild(note);
    }
    grid.appendChild(item);
  });
  container.appendChild(grid);
}

function appendOperationalTable(document, container, columns, rows, emptyLabel) {
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const header = document.createElement("tr");
  columns.forEach(function (column) {
    const th = document.createElement("th");
    th.textContent = column.label;
    header.appendChild(th);
  });
  thead.appendChild(header);
  const tbody = document.createElement("tbody");
  if (!rows || rows.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = columns.length;
    td.textContent = emptyLabel;
    tr.appendChild(td);
    tbody.appendChild(tr);
  } else {
    rows.forEach(function (row) {
      const tr = document.createElement("tr");
      columns.forEach(function (column) {
        const td = document.createElement("td");
        const value = column.value ? column.value(row) : row[column.key];
        td.textContent = column.format
          ? formatOperationalValue(value, column.format)
          : value === null || value === undefined || value === "" ? "未获取" : String(value);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }
  table.append(thead, tbody);
  wrap.appendChild(table);
  container.appendChild(wrap);
}

function createOperationalSection(document, title, role) {
  const section = document.createElement("section");
  section.className = "report-section operational-section";
  section.dataset.role = role;
  const heading = document.createElement("h2");
  heading.textContent = title;
  section.appendChild(heading);
  return section;
}

const COMPARISON_GROUPS = Object.freeze([
  Object.freeze({
    key: "active",
    title: "投入与产出",
    fields: Object.freeze([
      ["projectCount", "投入项目数", "number"],
      ["inputMd", "投入人天", "number"],
      ["inputCost", "投入成本", "money"],
      ["monthSPI", "结束月 SPI", "ratio"],
      ["periodPV", "区间 PV", "money"],
      ["periodEV", "区间 EV", "money"],
      ["periodSPI", "区间 SPI", "ratio"],
      ["serviceEV", "区间产服 EV", "money"],
      ["periodCPI", "区间 CPI", "ratio"],
      ["periodCCPI", "区间 CCPI", "ratio"],
      ["periodPerCapita", "区间人均产值", "money"],
      ["nextPeriodPlannedMd", "下期计划人天", "number"]
    ])
  }),
  Object.freeze({
    key: "milestone",
    title: "里程碑",
    fields: Object.freeze([
      ["plannedCount", "应完成", "number"],
      ["completedCount", "已完成", "number"],
      ["completionRate", "完成率", "percent"],
      ["overdueCount", "逾期", "number"],
      ["upcomingCount", "未来 7 天", "number"]
    ])
  }),
  Object.freeze({
    key: "invoice",
    title: "回款",
    fields: Object.freeze([
      ["monthPlan", "结束月计划", "money"],
      ["received", "实收", "money"],
      ["pending", "待回", "money"],
      ["receivedRate", "回款率", "percent"],
      ["overdueCount", "逾期笔数", "number"]
    ])
  })
]);

export function renderAnalyticsStatusSection(document, container, report) {
  const section = document.createElement("section");
  section.className = "report-status-band";
  section.dataset.role = "report-status";
  const formalCount = report.scope.formalCount;
  const candidateCount = report.scope.candidateCount;
  const formal = formalCount === null || formalCount === undefined
    ? "未获取/" + candidateCount
    : formalCount + "/" + candidateCount;
  const coverage = report.tables.diagnostics.coverage;
  const queryTime = report.identity.capturedAt
    ? String(report.identity.capturedAt).replace("T", " ").replace(/\.\d{3}Z$/, "Z")
    : "未获取";
  section.textContent = [
    "周期 " + report.identity.startDate + " 至 " + report.identity.endDate,
    "正式范围 " + formal,
    report.scope.onlyCurrentPeriodInput ? "仅本期日报投入项目" : "全部候选项目",
    "来源覆盖率 " + (coverage === null || coverage === undefined
      ? "未获取"
      : Math.round(coverage * 100) + "%"),
    "查询时间 " + queryTime
  ].join(" · ");
  container.appendChild(section);
}

export function renderPeriodComparisonSection(document, container, report) {
  const section = createOperationalSection(document, "本期经营与上期比较", "period-comparison");
  const grid = document.createElement("div");
  grid.className = "comparison-grid";
  COMPARISON_GROUPS.forEach(function (definition) {
    const group = document.createElement("div");
    group.className = "comparison-group";
    const title = document.createElement("h3");
    title.textContent = definition.title;
    group.appendChild(title);
    const rows = definition.fields.map(function ([field, label, format]) {
      return { label, format, comparison: report.metrics.comparison[definition.key][field] };
    });
    appendOperationalTable(document, group, [
      { key: "label", label: "指标" },
      {
        label: report.scope.periodLabels.current,
        value: function (row) {
          return formatOperationalValue(row.comparison.current, row.format);
        }
      },
      {
        label: report.scope.periodLabels.previous,
        value: function (row) {
          return formatOperationalValue(row.comparison.previous, row.format);
        }
      },
      {
        label: "变化",
        value: function (row) { return formatOperationalValue(row.comparison.delta, row.format); }
      },
      {
        label: "环比",
        value: function (row) { return formatOperationalValue(row.comparison.changeRate, "percent"); }
      }
    ], rows, "无期间比较数据");
    group.dataset.comparisonGroup = definition.key;
    grid.appendChild(group);
  });
  section.appendChild(grid);
  container.appendChild(section);
}

function appendOperationalList(document, container, title, role, columns, rows, emptyLabel) {
  const group = document.createElement("div");
  group.className = "operational-list";
  group.dataset.role = role;
  const heading = document.createElement("h3");
  heading.textContent = title;
  group.appendChild(heading);
  appendOperationalTable(document, group, columns, rows, emptyLabel);
  container.appendChild(group);
}

function relativeDateLabel(value, endDate, completed) {
  if (completed || !value || !endDate) return "-";
  const days = Math.round((Date.parse(value + "T00:00:00Z") - Date.parse(endDate + "T00:00:00Z")) / 86400000);
  if (!Number.isFinite(days)) return "未获取";
  return days < 0 ? "逾期 " + Math.abs(days) + " 天" : "剩余 " + days + " 天";
}

function milestoneColumns(endDate) {
  return [
    { key: "projectNo", label: "编码" },
    { key: "projectName", label: "项目名称" },
    { key: "projectManagerName", label: "PM" },
    { key: "nodeName", label: "节点" },
    { key: "planEndTime", label: "计划日" },
    {
      label: "状态",
      value: function (row) { return String(row.confirmStatus) === "2" ? "已完成" : "未完成"; }
    },
    {
      label: "距截止日",
      value: function (row) { return relativeDateLabel(row.planEndTime, endDate, String(row.confirmStatus) === "2"); }
    }
  ];
}

function invoiceColumns(endDate) {
  return [
    { key: "contractNo", label: "合同编号" },
    {
      label: "项目名称",
      value: function (row) {
        const projectName = row.projectName || "未找到对应项目";
        return row.contractName && row.contractName !== projectName
          ? projectName + " / " + row.contractName
          : projectName;
      }
    },
    { key: "projectManagerName", label: "项目经理" },
    { key: "customerName", label: "客户" },
    { key: "paymentNature", label: "款项性质" },
    { key: "planAmount", label: "计划金额", format: "money" },
    { key: "receivedAmount", label: "已回款", format: "money" },
    { key: "pendingAmount", label: "待回款", format: "money" },
    { key: "planDate", label: "计划回款日" },
    {
      label: "实际回款日",
      value: function (row) { return row.receivedFlag === "0" ? "-" : row.realReceivedDate; }
    },
    {
      label: "状态",
      value: function (row) {
        if (row.valid === false) return "数据异常";
        const status = row.receivedFlag === "1" ? "已回款" : "待回款";
        const reversal = row.redReversal === "是" ? "（红冲）" : "";
        const relative = row.pendingAmount > 0 ? " · " + relativeDateLabel(row.planDate, endDate, false) : "";
        return status + reversal + relative;
      }
    }
  ];
}

function diagnosticIdentifiers(rows, value) {
  return (rows || []).map(value).filter(Boolean).slice(0, 8).join("、") || "无";
}

function appendInvoiceDiagnostics(document, container, report) {
  const diagnostics = document.createElement("p");
  diagnostics.className = "diagnostic-note";
  diagnostics.dataset.role = "invoice-diagnostics";
  const supplement = report.tables.diagnostics?.receivables || {};
  if (report.tables.invoices.available === false) {
    diagnostics.textContent = "回款数据及关联诊断未获取";
  } else {
    diagnostics.textContent = "未映射 " + (supplement.unmappedCount || 0) + " 笔，" +
      formatOperationalValue(supplement.unmappedAmount || 0, "money") + "；多重匹配 " +
      (supplement.ambiguousCount || 0) + " 笔，" +
      formatOperationalValue(supplement.ambiguousAmount || 0, "money") + "；数据异常 " +
      (supplement.invalidCount || 0) + " 笔。未映射合同：" +
      diagnosticIdentifiers(supplement.unmapped, function (item) { return item.contractNo; }) +
      "；多重匹配合同：" +
      diagnosticIdentifiers(supplement.ambiguous, function (item) {
        const candidates = (item.candidates || []).map(function (candidate) {
          return candidate.projectNo || candidate.projectId;
        }).filter(Boolean).join("/");
        return (item.contractNo || "无合同号") + (candidates ? "→" + candidates : "");
      }) +
      "；异常明细：" +
      diagnosticIdentifiers(supplement.invalid, function (item) {
        return (item.detailId || "无ID") + "[" + (item.fields || []).join("/") + "]";
      });
  }
  container.appendChild(diagnostics);
}

function appendInvoicePlanDetails(document, container, rows, columns) {
  (rows || []).filter(function (row) {
    return (row.details || []).length > 1;
  }).forEach(function (row) {
    const details = document.createElement("details");
    details.className = "invoice-plan-details";
    details.dataset.role = "invoice-plan-details";
    const summary = document.createElement("summary");
    summary.textContent = (row.contractNo || "未获取合同") + " 净额组成（" + row.details.length + " 条）";
    details.appendChild(summary);
    appendOperationalTable(document, details, columns, row.details, "无组成明细");
    container.appendChild(details);
  });
}

export function renderAnalyticsOperationalSections(document, container, report) {
  const labels = report.scope.periodLabels;
  const active = createOperationalSection(document, labels.current + "有投入项目经营", "active-projects");
  const cardHost = document.createElement("div");
  cardHost.dataset.role = "active-cards";
  active.appendChild(cardHost);
  appendOperationalCards(document, cardHost, report.cards.active);
  appendOperationalTable(document, active, [
    { key: "projectNo", label: "编码" },
    { key: "projectName", label: "项目名称" },
    { key: "projectManagerName", label: "PM" },
    { key: "inputMd", label: labels.current + "投入人天", format: "number" },
    { key: "previousInputMd", label: labels.previous + "投入人天", format: "number" },
    { key: "inputCost", label: labels.current + "投入成本", format: "money" },
    { key: "costDelta", label: "成本环比", format: "percent" },
    { key: "monthSPI", label: "月SPI", format: "ratio" },
    { key: "periodSPI", label: "区间SPI", format: "ratio" },
    { key: "periodPV", label: "区间PV", format: "money" },
    { key: "periodEV", label: "区间EV", format: "money" },
    { key: "serviceEV", label: "区间产服EV", format: "money" },
    { key: "periodCPI", label: "区间CPI", format: "ratio" },
    { key: "periodCCPI", label: "区间CCPI", format: "ratio" },
    { key: "periodPerCapita", label: "区间人均产值", format: "money" },
    { key: "nextPeriodPlannedMd", label: labels.next + "计划人天", format: "number" },
    {
      label: "风险",
      value: function (row) {
        return (row.risks || []).map(function (item) { return item.label; }).join("、") || "-";
      }
    }
  ], report.tables.activeProjects, report.metrics.active.projectCount === null
    ? "投入数据未获取完整"
    : "当前范围无有投入项目");
  container.appendChild(active);

  const milestone = createOperationalSection(document, "里程碑与关键节点", "milestone-view");
  const milestoneCards = document.createElement("div");
  milestoneCards.dataset.role = "milestone-cards";
  milestone.appendChild(milestoneCards);
  appendOperationalCards(document, milestoneCards, report.cards.milestone);
  const columns = milestoneColumns(report.identity.endDate);
  appendOperationalList(
    document,
    milestone,
    "本月节点",
    "milestone-planned",
    columns,
    report.tables.milestones.planned,
    report.tables.milestones.available === false ? "里程碑数据未获取完整" : "本月无计划节点"
  );
  appendOperationalList(
    document,
    milestone,
    "已逾期",
    "milestone-overdue",
    columns,
    report.tables.milestones.overdue,
    report.tables.milestones.available === false ? "里程碑数据未获取完整" : "无逾期节点"
  );
  appendOperationalList(
    document,
    milestone,
    "未来 7 天",
    "milestone-upcoming",
    columns,
    report.tables.milestones.upcoming,
    report.tables.milestones.available === false ? "里程碑数据未获取完整" : "未来 7 天无节点"
  );
  container.appendChild(milestone);

  const invoice = createOperationalSection(document, "回款计划", "invoice-view");
  const invoiceCards = document.createElement("div");
  invoiceCards.dataset.role = "invoice-cards";
  invoice.appendChild(invoiceCards);
  appendOperationalCards(document, invoiceCards, report.cards.invoice);
  const invoiceTableColumns = invoiceColumns(report.identity.endDate);
  appendOperationalList(
    document,
    invoice,
    "当月计划明细",
    "invoice-month",
    invoiceTableColumns,
    report.tables.invoices.monthRows,
    report.tables.invoices.available === false ? "回款数据未获取完整" : "当月无回款计划"
  );
  appendOperationalList(
    document,
    invoice,
    "逾期未回",
    "invoice-overdue",
    invoiceTableColumns,
    report.tables.invoices.overdue,
    report.tables.invoices.available === false ? "回款数据未获取完整" : "无逾期未回记录"
  );
  appendInvoicePlanDetails(document, invoice, report.tables.invoices.overdue, invoiceTableColumns);
  appendInvoiceDiagnostics(document, invoice, report);
  container.appendChild(invoice);
}

function diagnosticList(document, container, title, role, columns, rows, emptyLabel) {
  appendOperationalList(document, container, title, role, columns, rows, emptyLabel);
}

export function renderAnalyticsManagementSections(document, container, report, onAction = function () {}) {
  const pm = createOperationalSection(document, "项目经理维度", "pm-analytics");
  appendOperationalTable(document, pm, [
    { key: "projectManagerName", label: "PM" },
    { key: "projectCount", label: "项目数", format: "number" },
    { key: "contractAmount", label: "合同金额", format: "money" },
    { key: "revenue", label: "收入", format: "money" },
    { key: "progress", label: "进度", format: "percent" },
    { key: "ac", label: "成本", format: "money" },
    { key: "perCapita", label: "人均产值", format: "money" },
    { key: "cpi", label: "CPI", format: "ratio" },
    { key: "ccpi", label: "CCPI", format: "ratio" }
  ], report.tables.projectManagers, "无项目经理数据");
  container.appendChild(pm);

  const budget = createOperationalSection(document, "预算健康度", "budget-health");
  appendOperationalTable(document, budget, [
    { key: "projectNo", label: "编码" },
    { key: "projectName", label: "项目名称" },
    { key: "projectManagerName", label: "PM" },
    { key: "wbsBudget", label: "WBS预算", format: "money" },
    { key: "bac", label: "BAC", format: "money" },
    { key: "budgetVariance", label: "预算偏差", format: "money" },
    { key: "ac", label: "AC", format: "money" },
    { key: "remainingBudget", label: "剩余预算", format: "money" },
    { key: "periodCost", label: "期间消耗", format: "money" },
    { key: "burnRatePerDay", label: "日均消耗", format: "money" },
    { key: "estimatedExhaustionDays", label: "预计耗尽天数", format: "number" }
  ], report.tables.budgetHealth, "无预算数据");
  container.appendChild(budget);

  const weekly = createOperationalSection(document, "各项目周期执行情况", "weekly-execution");
  appendOperationalTable(document, weekly, [
    {
      label: "周期",
      value: function (row) { return row.startDate && row.endDate ? row.startDate + " 至 " + row.endDate : null; }
    },
    { key: "projectNo", label: "编码" },
    { key: "projectName", label: "项目名称" },
    { key: "projectManagerName", label: "PM" },
    { key: "summary", label: "总结" },
    { key: "nextPlan", label: "计划" },
    { key: "inputMd", label: "投入人天", format: "number" },
    { key: "inputCost", label: "投入成本", format: "money" },
    { key: "periodSPI", label: "SPI", format: "ratio" }
  ], report.tables.weeklyExecution, "当前范围无周期执行数据");
  (report.tables.weeklyExecution || []).forEach(function (row) {
    if (!(row.details || []).length) return;
    const details = document.createElement("details");
    details.className = "execution-details";
    const summary = document.createElement("summary");
    summary.textContent = (row.projectNo || "未获取") + " " + row.startDate + " 至 " + row.endDate + " 执行明细";
    details.appendChild(summary);
    row.details.forEach(function (item) {
      const line = document.createElement("p");
      const hours = item.realHour ?? item.planHour;
      line.textContent = (item.taskName || item.detailName || "未获取") +
        (item.majorPerson || item.personName || "未获取") +
        (hours === null || hours === undefined ? "未获取" : hours + " 小时");
      details.appendChild(line);
    });
    weekly.appendChild(details);
  });
  container.appendChild(weekly);

  const diagnostics = createOperationalSection(document, "数据完整性与诊断", "data-diagnostics");
  const meta = report.tables.diagnostics || {};
  const coverage = document.createElement("p");
  coverage.className = "coverage-summary";
  coverage.textContent = "来源覆盖率" + (meta.coverage === null || meta.coverage === undefined
    ? "未获取"
    : Math.round(meta.coverage * 100) + "%");
  diagnostics.appendChild(coverage);
  diagnosticList(document, diagnostics, "失败项目", "failed-sources", [
    { key: "source", label: "来源" },
    { key: "projectId", label: "项目ID" },
    { key: "error", label: "错误" }
  ], meta.failedRequests, "无失败项");
  const entered = new Set(meta.enteredProjectIds || []);
  diagnosticList(document, diagnostics, "投入范围变化", "range-changes", [
    {
      label: "变化",
      value: function (row) { return entered.has(String(row.projectId)) ? "本期进入" : "本期退出"; }
    },
    { key: "projectNo", label: "编码" },
    { key: "projectName", label: "项目名称" },
    { key: "currentInputMd", label: "本期人天", format: "number" },
    { key: "previousInputMd", label: "上期人天", format: "number" }
  ], meta.rangeChangeProjects, "本期与上期投入范围一致");
  diagnosticList(document, diagnostics, "非当前组织部门", "historical-departments", [
    { key: "projectDept", label: "部门ID" },
    { key: "projectDeptName", label: "部门名称" },
    { key: "projectCount", label: "项目数", format: "number" }
  ], meta.historicalDepartments, "无历史部门");
  const supplement = meta.receivables || {};
  const invoiceDiagnostic = document.createElement("p");
  invoiceDiagnostic.textContent = "未映射回款" + (supplement.unmappedCount || 0) + " 笔，" +
    formatOperationalValue(supplement.unmappedAmount || 0, "money") + "；多重匹配" +
    (supplement.ambiguousCount || 0) + " 笔；数据异常" + (supplement.invalidCount || 0) + " 笔";
  diagnostics.appendChild(invoiceDiagnostic);
  const replaced = document.createElement("p");
  replaced.textContent = "替代周报" + ((meta.replacedWeeklyReportIds || []).join("、") || "无");
  diagnostics.appendChild(replaced);
  if ((meta.failedRequests || []).length > 0) {
    const retry = document.createElement("button");
    retry.type = "button";
    retry.dataset.role = "retry-failed";
    retry.textContent = "仅重试失败项";
    retry.addEventListener("click", function () { onAction("retry-failed"); });
    diagnostics.appendChild(retry);
  }
  container.appendChild(diagnostics);
}

export function renderCompanyAnalyticsSection(document, container, report, onDepartment = function () {}) {
  if (!report.company) return;
  const section = createOperationalSection(document, "全部部门总览", "company-analytics");
  const coverage = document.createElement("p");
  coverage.className = "coverage-summary";
  coverage.textContent = "部门覆盖 " + Math.round(report.company.coverage * report.company.departments.length) +
    "/" + report.company.departments.length;
  section.appendChild(coverage);
  const wrap = document.createElement("div");
  wrap.className = "table-scroll";
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const header = document.createElement("tr");
  ["部门", "状态", "项目数", "查询时间", "收入", "AC", "CPI", "需关注项目", "有投入项目", "逾期里程碑", "逾期回款"]
    .forEach(function (label) {
      const th = document.createElement("th");
      th.textContent = label;
      header.appendChild(th);
    });
  thead.appendChild(header);
  const tbody = document.createElement("tbody");
  report.company.departments.forEach(function (department) {
    const tr = document.createElement("tr");
    const name = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "drilldown-button";
    button.dataset.role = "department-" + department.departmentId;
    button.textContent = department.departmentName || department.departmentId;
    button.addEventListener("click", function () { onDepartment(department.departmentId); });
    name.appendChild(button);
    tr.appendChild(name);
    const metrics = department.metrics;
    const values = [
      department.complete ? "可用" : "部分失败",
      department.projectCount,
      department.capturedAt,
      metrics?.overview?.revenue,
      metrics?.overview?.ac,
      metrics?.overview?.cpi,
      metrics?.risks?.attentionProjectCount,
      metrics?.active?.projectCount,
      metrics?.milestone?.overdueCount,
      metrics?.invoice?.overdueCount
    ];
    values.forEach(function (value, index) {
      const td = document.createElement("td");
      if ([3, 4].includes(index)) td.textContent = formatOperationalValue(value, "money");
      else if (index === 5) td.textContent = formatOperationalValue(value, "ratio");
      else td.textContent = value === null || value === undefined || value === "" ? "未获取" : String(value);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.append(thead, tbody);
  wrap.appendChild(table);
  section.appendChild(wrap);
  container.appendChild(section);
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
        <div class="report-title"><strong>经营分析</strong><span data-role="period-label">部门经营报告</span></div>
        <label><span>部门</span><select data-field="department"><option value="">加载中...</option></select></label>
        <label><span>开始日期</span><input data-field="startDate" type="date"></label>
        <label><span>结束日期</span><input data-field="endDate" type="date"></label>
        <div class="toolbar-actions">
          <button type="button" class="primary" data-action="query">查询</button>
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
      cancel: root.querySelector('[data-action="cancel"]'),
      query: root.querySelector('[data-action="query"]')
    };
    root.querySelectorAll("[data-action]").forEach(function (button) {
      button.addEventListener("click", function () { adapters.onAction(button.dataset.action); });
    });
    elements.department.disabled = true;
    elements.query.disabled = true;
    elements.department.addEventListener("change", function () {
      elements.query.disabled = elements.department.disabled || !elements.department.value;
    });
    [elements.startDate, elements.endDate].forEach(function (input) {
      input.addEventListener("change", function () { adapters.onDateRange?.(); });
    });
  }

  function setDateRange(range) {
    elements.startDate.value = range.startDate;
    elements.endDate.value = range.endDate;
  }

  function setDepartments(departments) {
    const rows = departments || [];
    elements.department.textContent = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = rows.length > 0 ? "请选择部门" : "当前条件无可用部门";
    elements.department.appendChild(placeholder);
    rows.forEach(function (department) {
      const option = document.createElement("option");
      option.value = department.id;
      option.dataset.departmentName = department.name;
      option.textContent = department.name + "（" + department.projectCount + "）";
      elements.department.appendChild(option);
    });
    if (rows.length > 0) {
      const all = document.createElement("option");
      all.value = "all";
      all.dataset.departmentName = "全部部门";
      all.textContent = "全部部门（" + rows.reduce(function (sum, department) {
        return sum + department.projectCount;
      }, 0) + "）";
      elements.department.appendChild(all);
    }
    elements.query.disabled = true;
  }

  function setDepartment(departmentId) {
    elements.department.value = String(departmentId || "");
    elements.query.disabled = elements.department.disabled || !elements.department.value;
  }

  function setScopeEnabled(enabled) {
    elements.department.disabled = !enabled;
    elements.query.disabled = !enabled || !elements.department.value;
  }

  function setQueryPending(pending) {
    elements.query.disabled = pending || elements.department.disabled || !elements.department.value;
  }

  function clearReport() {
    formalReport = null;
    selectedIds = new Set();
    elements.summary.textContent = "";
    elements.summary.hidden = true;
  }

  function setExportEnabled(enabled) {
    const button = elements?.root?.querySelector('[data-action="export"]');
    if (button) button.disabled = !enabled;
  }

  function getQuery() {
    const selectedDepartment = elements.department.selectedOptions[0];
    return {
      departmentId: elements.department.value,
      departmentName: selectedDepartment?.dataset.departmentName || selectedDepartment?.textContent || "",
      startDate: elements.startDate.value,
      endDate: elements.endDate.value
    };
  }

  function renderState(state) {
    const states = {
      initial: ["准备查询", "请选择部门和日期后查询。"],
      scope: ["加载部门", state.message || "正在读取当前可访问的部门和项目范围..."],
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
    if (value === null || value === undefined) return "未获取";
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
      <button type="button" data-action="restore-selection">恢复正式范围</button>
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
      count.textContent = ids.length === projects.length
        ? "正式范围 " + projects.length
        : "临时选择 " + ids.length + "/" + projects.length;
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
      ? "临时选择 " + report.scope.selectedCount + "/" + projects.length
      : "正式范围 " + projects.length;
  }

  function renderReport(report, options = {}) {
    if (options.formal) {
      formalReport = report;
      selectedIds = new Set(report.tables.projects.map(function (item) { return item.projectId; }));
    }
    if (!formalReport) return;
    if (!options.formal) {
      const banner = elements.summary.querySelector('[data-role="temporary-selection"]');
      if (banner) {
        const temporary = report.scope.mode === "selection";
        banner.hidden = !temporary;
        banner.textContent = temporary
          ? "临时选择 " + report.scope.selectedCount + "/" + formalReport.tables.projects.length +
            "，顶部正式统计保持不变。"
          : "";
      }
      return;
    }
    elements.summary.hidden = false;
    elements.summary.textContent = "";
    renderAnalyticsStatusSection(document, elements.summary, report);
    const executive = document.createElement("section");
    executive.className = "report-section executive";
    const executiveTitle = document.createElement("h2");
    executiveTitle.textContent = "经营速览";
    const executiveText = document.createElement("p");
    executiveText.dataset.role = "executive-text";
    executiveText.textContent = [
      formatValue(report.metrics.risks.attentionProjectCount, "number") + " 个风险项目",
      formatValue(report.metrics.milestone.overdueCount, "number") + " 个逾期里程碑",
      formatValue(report.metrics.invoice.overdueCount, "number") + " 笔逾期回款",
      formatValue(report.metrics.risks.itemCount, "number") + " 项待跟进"
    ].join(" · ");
    executive.append(executiveTitle, executiveText);
    const overview = document.createElement("section");
    overview.className = "report-section";
    overview.dataset.role = "realtime-overview";
    const title = document.createElement("h2");
    title.textContent = "实时累计经营概览";
    overview.appendChild(title);
    const overviewCards = document.createElement("div");
    overviewCards.dataset.role = "overview-cards";
    overview.appendChild(overviewCards);
    appendCardGrid(overviewCards, report.cards.overview);
    const company = document.createElement("div");
    renderCompanyAnalyticsSection(document, company, report, adapters.onDepartment);
    const comparison = document.createElement("div");
    renderPeriodComparisonSection(document, comparison, report);
    const projects = document.createElement("section");
    projects.className = "report-section";
    projects.dataset.role = "project-details";
    const projectTitle = document.createElement("h2");
    projectTitle.textContent = "项目明细";
    projects.appendChild(projectTitle);
    const temporary = document.createElement("p");
    temporary.className = "temporary-selection";
    temporary.dataset.role = "temporary-selection";
    temporary.hidden = true;
    projects.appendChild(temporary);
    renderProjectTable(projects, report);
    const operational = document.createElement("div");
    renderAnalyticsOperationalSections(document, operational, report);
    const management = document.createElement("div");
    renderAnalyticsManagementSections(document, management, report, adapters.onAction);
    const byRole = function (container, role) {
      return [...container.children].find(function (child) { return child.dataset.role === role; });
    };
    elements.summary.append(executive, overview);
    [...company.children].forEach(function (child) { elements.summary.appendChild(child); });
    [...comparison.children].forEach(function (child) { elements.summary.appendChild(child); });
    elements.summary.appendChild(projects);
    ["milestone-view", "invoice-view"].forEach(function (role) {
      const section = byRole(operational, role);
      if (section) elements.summary.appendChild(section);
    });
    ["pm-analytics", "budget-health", "weekly-execution", "data-diagnostics"].forEach(function (role) {
      const section = byRole(management, role);
      if (section) elements.summary.appendChild(section);
    });
  }

  return {
    mount,
    setDateRange,
    setDepartments,
    setDepartment,
    setScopeEnabled,
    setQueryPending,
    clearReport,
    setExportEnabled,
    getQuery,
    renderState,
    renderResult,
    renderReport
  };
}
