function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatValue(value, format) {
  if (value === null || value === undefined) return "未获取";
  if (format === "money") {
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value / 10000) + " 万元";
  }
  if (format === "percent") {
    return new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 }).format(value);
  }
  if (format === "ratio") return Number(value).toFixed(2);
  return typeof value === "number"
    ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value)
    : String(value);
}

function cards(values) {
  return `<div class="cards">${(values || []).map(function (card) {
    return `<article><span>${escapeHtml(card.label)}</span>${(card.values || []).map(function (value) {
      return `<strong>${escapeHtml(formatValue(value.value, value.format))}</strong>`;
    }).join("")}${card.note ? `<small>${escapeHtml([
      card.note.count === null || card.note.count === undefined ? "笔数未获取" : card.note.count + " 笔",
      Object.prototype.hasOwnProperty.call(card.note, "rate")
        ? "回款率 " + (card.note.rate === null || card.note.rate === undefined
          ? "-"
          : formatValue(card.note.rate, "percent"))
        : null
    ].filter(Boolean).join(" · "))}</small>` : ""}</article>`;
  }).join("")}</div>`;
}

function valueFor(row, column) {
  return column.value ? column.value(row) : row[column.key];
}

function table(title, rows, columns, options = {}) {
  const body = (rows || []).map(function (row) {
    const search = options.search
      ? ` data-project-row data-search="${escapeHtml(options.search(row))}"`
      : "";
    return `<tr${search}>${columns.map(function (column) {
      return `<td>${escapeHtml(formatValue(valueFor(row, column), column.format))}</td>`;
    }).join("")}</tr>`;
  }).join("") || `<tr><td colspan="${columns.length}">无数据</td></tr>`;
  return `<details open><summary>${escapeHtml(title)}</summary><div class="table-wrap"><table>` +
    `<thead><tr>${columns.map(function (column, index) {
      return `<th><button type="button" data-sort="${index}">${escapeHtml(column.label)}</button></th>`;
    }).join("")}</tr></thead><tbody>${body}</tbody></table></div></details>`;
}

const PROJECT_COLUMNS = [
  { key: "projectNo", label: "编码" }, { key: "projectName", label: "项目名称" },
  { key: "projectManagerName", label: "PM" }, { key: "currStatusDesc", label: "状态" },
  { key: "revenue", label: "收入", format: "money" }, { key: "bac", label: "BAC", format: "money" },
  { key: "ac", label: "AC", format: "money" }, { key: "ev", label: "EV", format: "money" },
  { key: "cr", label: "CR", format: "money" }, { key: "inputMd", label: "本期投入人天" },
  { key: "previousInputMd", label: "上期投入人天" },
  { key: "inputCost", label: "投入成本", format: "money" },
  { key: "periodSPI", label: "区间 SPI", format: "ratio" },
  { key: "cpi", label: "CPI", format: "ratio" }, { key: "ccpi", label: "CCPI", format: "ratio" },
  { key: "totalSPI", label: "总 SPI", format: "ratio" }
];

const MILESTONE_COLUMNS = [
  { key: "group", label: "分组" }, { key: "projectNo", label: "编码" },
  { key: "projectName", label: "项目名称" }, { key: "projectManagerName", label: "PM" },
  { key: "nodeName", label: "节点" }, { key: "planEndTime", label: "计划日" },
  { label: "状态", value: function (row) { return row.completed === true ? "已完成" : "未完成"; } }
];

const INVOICE_COLUMNS = [
  { key: "group", label: "分组" }, { key: "contractNo", label: "合同编号" },
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
  { key: "customerName", label: "客户" }, { key: "paymentNature", label: "款项性质" },
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
      return (row.receivedFlag === "1" ? "已回款" : "待回款") +
        (row.redReversal === "是" ? "（红冲）" : "");
    }
  }
];

const COMPARISON_GROUPS = [
  ["投入与产出", "active", [
    ["projectCount", "投入项目数", "number"], ["inputMd", "投入人天", "number"],
    ["inputCost", "投入成本", "money"], ["monthSPI", "结束月 SPI", "ratio"],
    ["periodPV", "区间 PV", "money"], ["periodEV", "区间 EV", "money"],
    ["periodSPI", "区间 SPI", "ratio"], ["serviceEV", "区间产服 EV", "money"],
    ["periodCPI", "区间 CPI", "ratio"], ["periodCCPI", "区间 CCPI", "ratio"],
    ["periodPerCapita", "区间人均产值", "money"], ["nextPeriodPlannedMd", "下期计划人天", "number"]
  ]],
  ["里程碑", "milestone", [
    ["plannedCount", "应完成", "number"], ["completedCount", "已完成", "number"],
    ["completionRate", "完成率", "percent"], ["overdueCount", "逾期", "number"],
    ["upcomingCount", "未来 7 天", "number"]
  ]],
  ["回款", "invoice", [
    ["monthPlan", "结束月计划", "money"], ["received", "实收", "money"],
    ["pending", "待回", "money"], ["receivedRate", "回款率", "percent"],
    ["overdueCount", "逾期笔数", "number"]
  ]]
];

function groupedRows(groups) {
  return groups.flatMap(function ([label, rows]) {
    return (rows || []).map(function (row) { return Object.assign({ group: label }, row); });
  });
}

function comparisonTables(report) {
  return `<section><h2>本期经营与上期比较</h2><div class="comparison">` +
    COMPARISON_GROUPS.map(function ([title, section, fields]) {
      const rows = fields.map(function ([field, label, format]) {
        return { label, format, comparison: report.metrics?.comparison?.[section]?.[field] || {} };
      });
      return `<div><h3>${escapeHtml(title)}</h3>${table("指标比较", rows, [
        { key: "label", label: "指标" },
        {
          label: report.scope.periodLabels?.current || "本期",
          value: function (row) { return formatValue(row.comparison.current, row.format); }
        },
        {
          label: report.scope.periodLabels?.previous || "上期",
          value: function (row) { return formatValue(row.comparison.previous, row.format); }
        },
        { label: "变化", value: function (row) { return formatValue(row.comparison.delta, row.format); } },
        { label: "环比", value: function (row) { return formatValue(row.comparison.changeRate, "percent"); } }
      ])}</div>`;
    }).join("") + "</div></section>";
}

function diagnostics(report) {
  const value = report.tables.diagnostics || {};
  const supplement = value.receivables || {};
  const statuses = (value.sourceStatus || []).map(function (item) {
    return [item.source, item.projectId || "-", item.status].map(escapeHtml).join(" / ");
  }).join("<br>") || "无";
  const entered = new Set(value.enteredProjectIds || []);
  const changes = table("投入范围变化", value.rangeChangeProjects || [], [
    {
      label: "变化",
      value: function (row) { return entered.has(String(row.projectId)) ? "本期进入" : "本期退出"; }
    },
    { key: "projectNo", label: "编码" }, { key: "projectName", label: "项目名称" },
    { key: "currentInputMd", label: "本期人天" }, { key: "previousInputMd", label: "上期人天" }
  ]);
  return `<section><h2>数据完整性与范围变化诊断</h2>` +
    `<p>来源覆盖率：${escapeHtml(formatValue(value.coverage, "percent"))}</p>` +
    `<p>来源状态：${statuses}</p>` +
    `<p>未映射回款：${escapeHtml(supplement.unmappedCount || 0)} 笔，` +
    `${escapeHtml(formatValue(supplement.unmappedAmount || 0, "money"))}</p>` +
    `<p>多重匹配回款：${escapeHtml(supplement.ambiguousCount || 0)} 笔，` +
    `${escapeHtml(formatValue(supplement.ambiguousAmount || 0, "money"))}</p>` +
    `<p>异常回款：${escapeHtml(supplement.invalidCount || 0)} 笔</p>` +
    `<p>替代周报：${escapeHtml((value.replacedWeeklyReportIds || []).join("、") || "无")}</p>` +
    `${changes}</section>`;
}

function companyTable(report) {
  if (!report.company) return "";
  return table("部门实时对比", report.company.departments, [
    { key: "departmentName", label: "部门" },
    { label: "状态", value: function (row) { return row.complete ? "可用" : "部分失败"; } },
    { key: "projectCount", label: "项目数" }, { key: "capturedAt", label: "查询时间" },
    { label: "收入", format: "money", value: function (row) { return row.metrics?.overview?.revenue; } },
    { label: "需关注", value: function (row) { return row.metrics?.risks?.attentionProjectCount; } },
    { label: "有投入", value: function (row) { return row.metrics?.active?.projectCount; } },
    { label: "逾期里程碑", value: function (row) { return row.metrics?.milestone?.overdueCount; } },
    { label: "逾期回款", value: function (row) { return row.metrics?.invoice?.overdueCount; } }
  ]);
}

function reportStatus(report) {
  const coverage = report.tables.diagnostics?.coverage;
  const formalCount = report.scope.formalCount;
  const candidateCount = report.scope.candidateCount;
  const formal = formalCount === null || formalCount === undefined
    ? "未获取/" + candidateCount
    : formalCount + "/" + candidateCount;
  return [
    "报告状态 " + (report.complete === true ? "完整" : "数据不完整"),
    "周期 " + report.identity.startDate + " 至 " + report.identity.endDate,
    "正式范围 " + formal,
    report.scope.onlyCurrentPeriodInput ? "仅本期日报投入项目" : "全部候选项目",
    "来源覆盖率 " + (coverage === null || coverage === undefined ? "未获取" : Math.round(coverage * 100) + "%"),
    "查询时间 " + (report.identity.capturedAt || "未获取")
  ].join(" · ");
}

export function createOfflineReport(report) {
  if (!report || !report.identity || !report.tables || report.scope?.mode === "selection") {
    throw new Error("formal analytics report required");
  }
  const milestoneRows = groupedRows([
    ["本月节点", report.tables.milestones?.planned],
    ["已逾期", report.tables.milestones?.overdue],
    ["未来 7 天", report.tables.milestones?.upcoming]
  ]);
  const invoiceRows = groupedRows([
    ["当月计划", report.tables.invoices?.monthRows],
    ["逾期未回", report.tables.invoices?.overdue]
  ]);
  const invoiceDetailRows = (report.tables.invoices?.overdue || []).flatMap(function (row) {
    return (row.details || []).length > 1
      ? row.details.map(function (detail) { return Object.assign({ group: "净额组成" }, detail); })
      : [];
  });
  const weeklyRows = (report.tables.weeklyExecution || []).map(function (row) {
    return {
      startDate: row.startDate,
      endDate: row.endDate,
      projectNo: row.projectNo,
      projectName: row.projectName,
      summary: row.summary,
      nextPlan: row.nextPlan,
      inputMd: row.inputMd,
      inputCost: row.inputCost,
      periodSPI: row.periodSPI
    };
  });
  const script = `document.addEventListener("DOMContentLoaded",function(){const q=document.querySelector('[data-role="project-search"]');const rows=[...document.querySelectorAll('[data-project-row]')];function draw(){const v=q.value.trim().toLowerCase();rows.forEach(r=>r.hidden=v&&!r.dataset.search.toLowerCase().includes(v));}q.addEventListener("input",draw);document.querySelector('[data-action="restore"]').addEventListener("click",function(){q.value="";draw();});document.querySelectorAll("[data-sort]").forEach(function(b){b.addEventListener("click",function(){const body=b.closest("table").tBodies[0];const i=Number(b.dataset.sort);[...body.rows].sort((a,c)=>a.cells[i].textContent.localeCompare(c.cells[i].textContent,"zh-CN",{numeric:true})).forEach(r=>body.appendChild(r));});});});`;
  const executive = [
    formatValue(report.metrics?.risks?.attentionProjectCount) + " 个风险项目",
    formatValue(report.metrics?.milestone?.overdueCount) + " 个逾期里程碑",
    formatValue(report.metrics?.invoice?.overdueCount) + " 笔逾期回款",
    formatValue(report.metrics?.risks?.itemCount) + " 项待跟进"
  ].join(" · ");
  const style = `*{box-sizing:border-box}body{margin:0;color:#20262d;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4f6f8}header,main{width:min(1440px,calc(100% - 32px));margin:auto}header{padding:24px 0 16px;border-bottom:1px solid #ccd3da}h1{margin:0;font-size:24px}h2{font-size:18px}h3{font-size:14px}section,details{padding:18px 0;border-bottom:1px solid #d7dde3}summary{cursor:pointer;font-weight:650}.status{padding:11px 14px;border:1px solid #cbd4dc;border-left:4px solid #1769aa;background:#fff}.executive{border-left:4px solid #c23b3b;padding-left:14px}.cards{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}.cards article{min-height:84px;padding:12px;border:1px solid #d5dbe1;border-radius:6px;background:#fff}.cards span,.cards strong,.cards small{display:block}.cards span{color:#68737e;font-size:12px}.cards strong{margin-top:12px;font-size:18px}.cards small{margin-top:6px;color:#68737e}.comparison{display:grid;grid-template-columns:1.6fr 1fr 1fr;gap:14px}.comparison details{padding-top:0}.tools{display:flex;gap:8px;margin:16px 0}.tools input{min-width:260px}.tools input,.tools button,th button{min-height:34px;border:1px solid #aeb8c2;border-radius:5px;padding:6px 9px;background:#fff}.table-wrap{overflow:auto;border:1px solid #d5dbe1;background:#fff}table{width:100%;min-width:980px;border-collapse:collapse}th,td{padding:8px 9px;border-bottom:1px solid #e3e7eb;text-align:left;white-space:nowrap}th{background:#eef1f4}th button{min-height:0;border:0;padding:0;background:transparent;font-weight:650}@media(max-width:1100px){.comparison{grid-template-columns:1fr}.cards{grid-template-columns:repeat(3,minmax(0,1fr))}}@media(max-width:760px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.tools{flex-wrap:wrap}.tools input{min-width:100%}}`;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>经营分析_${escapeHtml(report.identity.departmentName)}</title><style>${style}</style></head><body>` +
    `<header><h1>经营分析</h1><p>${escapeHtml(report.identity.departmentName)}</p></header><main>` +
    `<p class="status">${escapeHtml(reportStatus(report))}</p>` +
    `<section class="executive"><h2>经营速览</h2><p>${escapeHtml(executive)}</p></section>` +
    `<section><h2>实时累计经营概览</h2>${cards(report.cards.overview)}</section>` +
    `${companyTable(report)}${comparisonTables(report)}` +
    `<section><h2>项目明细</h2><div class="tools"><input type="search" data-role="project-search" ` +
    `aria-label="搜索项目" placeholder="搜索项目编码或名称"><button type="button" data-action="restore">恢复正式范围</button></div>` +
    `${table("正式项目", report.tables.projects, PROJECT_COLUMNS, {
      search: function (row) { return String(row.projectNo || "") + " " + String(row.projectName || ""); }
    })}</section>` +
    `<section><h2>里程碑与回款</h2>${cards(report.cards.milestone)}` +
    `${table("里程碑明细", milestoneRows, MILESTONE_COLUMNS)}${cards(report.cards.invoice)}` +
    `${table("回款明细", invoiceRows, INVOICE_COLUMNS)}` +
    `${invoiceDetailRows.length > 0 ? table("回款净额组成", invoiceDetailRows, INVOICE_COLUMNS) : ""}</section>` +
    `${table("项目经理维度", report.tables.projectManagers, [
      { key: "projectManagerName", label: "PM" }, { key: "projectCount", label: "项目数" },
      { key: "revenue", label: "收入", format: "money" }, { key: "ac", label: "成本", format: "money" },
      { key: "cpi", label: "CPI", format: "ratio" }, { key: "ccpi", label: "CCPI", format: "ratio" }
    ])}` +
    `${table("预算健康度", report.tables.budgetHealth, [
      { key: "projectNo", label: "编码" }, { key: "projectName", label: "项目名称" },
      { key: "bac", label: "BAC", format: "money" }, { key: "ac", label: "AC", format: "money" },
      { key: "remainingBudget", label: "剩余预算", format: "money" },
      { key: "periodCost", label: "期间消耗", format: "money" },
      { key: "estimatedExhaustionDays", label: "预计耗尽天数" }
    ])}` +
    `${table("周期执行", weeklyRows, [
      { key: "startDate", label: "开始日期" }, { key: "endDate", label: "结束日期" },
      { key: "projectNo", label: "编码" }, { key: "projectName", label: "项目名称" },
      { key: "summary", label: "总结" }, { key: "nextPlan", label: "计划" },
      { key: "inputMd", label: "投入人天" }, { key: "inputCost", label: "投入成本", format: "money" },
      { key: "periodSPI", label: "SPI", format: "ratio" }
    ])}${diagnostics(report)}</main><script>${script}</script></body></html>`;
}

export function createOfflineReportFileName(report, now = new Date()) {
  const department = String(report?.identity?.departmentName || "全部部门")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim() || "全部部门";
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.getTime())) throw new Error("valid export time required");
  const stamp = instant.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const parts = ["经营分析", department, report.identity.startDate, report.identity.endDate];
  if (report.complete !== true) parts.push("数据不完整");
  parts.push(stamp);
  return parts.join("_") + ".html";
}
