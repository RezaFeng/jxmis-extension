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
  if (format === "money") return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value / 10000) + " 万元";
  if (format === "percent") return new Intl.NumberFormat("zh-CN", { style: "percent", maximumFractionDigits: 1 }).format(value);
  if (format === "ratio") return Number(value).toFixed(2);
  return typeof value === "number"
    ? new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(value)
    : String(value);
}

function cards(values) {
  return `<div class="cards">${(values || []).map(function (card) {
    return `<article><span>${escapeHtml(card.label)}</span>${(card.values || []).map(function (value) {
      return `<strong>${escapeHtml(formatValue(value.value, value.format))}</strong>`;
    }).join("")}</article>`;
  }).join("")}</div>`;
}

function valueFor(row, column) {
  return column.value ? column.value(row) : row[column.key];
}

function table(title, rows, columns, options = {}) {
  const body = (rows || []).map(function (row) {
    const search = options.search ? ` data-project-row data-search="${escapeHtml(options.search(row))}"` : "";
    return `<tr${search}>${columns.map(function (column) {
      return `<td>${escapeHtml(formatValue(valueFor(row, column), column.format))}</td>`;
    }).join("")}</tr>`;
  }).join("") || `<tr><td colspan="${columns.length}">无数据</td></tr>`;
  return `<details open><summary>${escapeHtml(title)}</summary><div class="table-wrap"><table><thead><tr>${columns.map(function (column, index) {
    return `<th><button type="button" data-sort="${index}">${escapeHtml(column.label)}</button></th>`;
  }).join("")}</tr></thead><tbody>${body}</tbody></table></div></details>`;
}

const PROJECT_COLUMNS = [
  { key: "projectNo", label: "编码" }, { key: "projectName", label: "项目名称" },
  { key: "projectManagerName", label: "PM" }, { key: "currStatusDesc", label: "状态" },
  { key: "revenue", label: "收入", format: "money" }, { key: "bac", label: "BAC", format: "money" },
  { key: "ac", label: "AC", format: "money" }, { key: "ev", label: "EV", format: "money" },
  { key: "cr", label: "CR", format: "money" }, { key: "inputMd", label: "投入人天" },
  { key: "inputCost", label: "投入成本", format: "money" }, { key: "cpi", label: "CPI", format: "ratio" },
  { key: "ccpi", label: "CCPI", format: "ratio" }, { key: "totalSPI", label: "总SPI", format: "ratio" }
];

const MILESTONE_COLUMNS = [
  { key: "group", label: "分组" }, { key: "projectNo", label: "编码" },
  { key: "projectName", label: "项目名称" }, { key: "projectManagerName", label: "PM" },
  { key: "nodeName", label: "节点" }, { key: "planEndTime", label: "计划日" },
  { key: "confirmStatus", label: "状态" }
];

const INVOICE_COLUMNS = [
  { key: "group", label: "分组" }, { key: "projectNo", label: "编码" },
  { key: "projectName", label: "项目名称" }, { key: "contractNo", label: "合同编号" },
  { key: "planDate", label: "计划日" }, { key: "planAmount", label: "计划金额", format: "money" },
  { key: "receivedAmount", label: "已回款", format: "money" },
  { key: "pendingAmount", label: "待回款", format: "money" }
];

function groupedRows(groups) {
  return groups.flatMap(function ([label, rows]) {
    return (rows || []).map(function (row) { return Object.assign({ group: label }, row); });
  });
}

function diagnostics(report) {
  const value = report.tables.diagnostics || {};
  const supplement = value.invoiceSupplement || {};
  const statuses = (value.sourceStatus || []).map(function (item) {
    return [item.source, item.projectId || "-", item.status].map(escapeHtml).join(" / ");
  }).join("<br>") || "无";
  return `<section><h2>数据完整性与诊断</h2><p>来源覆盖率：${escapeHtml(formatValue(value.coverage, "percent"))}</p>` +
    `<p>来源状态：${statuses}</p>` +
    `<p>未映射回款：${escapeHtml(supplement.unmappedCount || 0)} 笔，${escapeHtml(formatValue(supplement.unmappedAmount || 0, "money"))}</p>` +
    `<p>替代周报：${escapeHtml((value.replacedWeeklyReportIds || []).join("、") || "无")}</p></section>`;
}

function companyTable(report) {
  if (!report.company) return "";
  return table("部门覆盖与对比", report.company.departments, [
    { key: "departmentName", label: "部门" }, { key: "status", label: "状态" },
    { key: "projectCount", label: "项目数" }, { key: "capturedAt", label: "更新时间" },
    { label: "收入", format: "money", value: function (row) { return row.metrics?.overview?.revenue; } },
    { label: "需关注", value: function (row) { return row.metrics?.risks?.attentionProjectCount; } },
    { label: "有投入", value: function (row) { return row.metrics?.active?.projectCount; } },
    { label: "逾期里程碑", value: function (row) { return row.metrics?.milestone?.overdueCount; } },
    { label: "逾期回款", value: function (row) { return row.metrics?.invoice?.overdueCount; } }
  ]);
}

export function createOfflineReport(report) {
  if (!report || !report.identity || !report.tables || report.scope?.mode === "selection") {
    throw new Error("formal analytics report required");
  }
  const milestoneRows = groupedRows([
    ["本月节点", report.tables.milestones?.planned],
    ["已逾期", report.tables.milestones?.overdue],
    ["未来7天", report.tables.milestones?.upcoming]
  ]);
  const invoiceRows = groupedRows([
    ["当月计划", report.tables.invoices?.monthRows],
    ["逾期未回", report.tables.invoices?.overdue]
  ]);
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
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:"><meta name="viewport" content="width=device-width,initial-scale=1"><title>经营分析_${escapeHtml(report.identity.departmentName)}</title><style>*{box-sizing:border-box}body{margin:0;color:#20262d;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f4f6f8}header,main{width:min(1440px,calc(100% - 32px));margin:auto}header{padding:24px 0 16px;border-bottom:1px solid #ccd3da}h1{margin:0;font-size:24px}h2{font-size:18px}section,details{padding:18px 0;border-bottom:1px solid #d7dde3}summary{cursor:pointer;font-weight:650}.cards{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px}.cards article{min-height:84px;padding:12px;border:1px solid #d5dbe1;border-radius:6px;background:#fff}.cards span,.cards strong{display:block}.cards span{color:#68737e;font-size:12px}.cards strong{margin-top:12px;font-size:18px}.tools{display:flex;gap:8px;margin:16px 0}.tools input{min-width:260px}.tools input,.tools button,th button{min-height:34px;border:1px solid #aeb8c2;border-radius:5px;padding:6px 9px;background:#fff}.table-wrap{overflow:auto;border:1px solid #d5dbe1;background:#fff}table{width:100%;min-width:980px;border-collapse:collapse}th,td{padding:8px 9px;border-bottom:1px solid #e3e7eb;text-align:left;white-space:nowrap}th{background:#eef1f4}th button{min-height:0;border:0;padding:0;background:transparent;font-weight:650}@media(max-width:760px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}.tools{flex-wrap:wrap}.tools input{min-width:100%}}</style></head><body><header><h1>经营分析</h1><p>${escapeHtml(report.identity.departmentName)} · ${escapeHtml(report.identity.startDate)} 至 ${escapeHtml(report.identity.endDate)} · 生成于 ${escapeHtml(report.identity.capturedAt || "未获取")}</p></header><main><section><h2>${report.company ? "公司经营概览" : "部门经营概览"}</h2>${cards(report.cards.overview)}</section>${companyTable(report)}<div class="tools"><input type="search" data-role="project-search" aria-label="搜索项目" placeholder="搜索项目编码或名称"><button type="button" data-action="restore">恢复全量</button></div>${table("项目明细", report.tables.projects, PROJECT_COLUMNS, { search: function (row) { return String(row.projectNo || "") + " " + String(row.projectName || ""); } })}<section><h2>${escapeHtml(report.scope.periodLabels?.current || "本期")}有投入项目经营</h2>${cards(report.cards.active)}</section>${table("有投入项目", report.tables.activeProjects, PROJECT_COLUMNS)}<section><h2>里程碑</h2>${cards(report.cards.milestone)}</section>${table("里程碑明细", milestoneRows, MILESTONE_COLUMNS)}<section><h2>回款</h2>${cards(report.cards.invoice)}</section>${table("回款明细", invoiceRows, INVOICE_COLUMNS)}${table("项目经理维度", report.tables.projectManagers, [{key:"projectManagerName",label:"PM"},{key:"projectCount",label:"项目数"},{key:"revenue",label:"收入",format:"money"},{key:"ac",label:"成本",format:"money"},{key:"cpi",label:"CPI",format:"ratio"},{key:"ccpi",label:"CCPI",format:"ratio"}])}${table("预算健康度", report.tables.budgetHealth, [{key:"projectNo",label:"编码"},{key:"projectName",label:"项目名称"},{key:"bac",label:"BAC",format:"money"},{key:"ac",label:"AC",format:"money"},{key:"remainingBudget",label:"剩余预算",format:"money"},{key:"periodCost",label:"期间消耗",format:"money"},{key:"estimatedExhaustionDays",label:"预计耗尽天数"}])}${table("周期执行", weeklyRows, [{key:"startDate",label:"开始日期"},{key:"endDate",label:"结束日期"},{key:"projectNo",label:"编码"},{key:"projectName",label:"项目名称"},{key:"summary",label:"总结"},{key:"nextPlan",label:"计划"},{key:"inputMd",label:"投入人天"},{key:"inputCost",label:"投入成本",format:"money"},{key:"periodSPI",label:"SPI",format:"ratio"}])}${diagnostics(report)}</main><script>${script}</script></body></html>`;
}

export function createOfflineReportFileName(report, now = new Date()) {
  const department = String(report?.identity?.departmentName || "全部部门")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim() || "全部部门";
  const instant = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(instant.getTime())) throw new Error("valid export time required");
  const stamp = instant.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return ["经营分析", department, report.identity.startDate, report.identity.endDate, stamp].join("_") + ".html";
}
