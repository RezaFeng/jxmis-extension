import { DEFAULT_RISK_THRESHOLDS, validateRiskThresholds } from "./config.js";

export const RISK_TYPES = Object.freeze({
  LOW_PER_CAPITA: "lowPerCapita",
  LOW_CPI: "lowCpi",
  BUDGET_OVERRUN: "budgetOverrun",
  SEVERE_OVERRUN: "severeOverrun",
  SPI_WARN: "spiWarn",
  SPI_CRITICAL: "spiCritical",
  HIGH_INPUT_ZERO_OUTPUT: "highInputZeroOutput",
  BUDGET_EXHAUSTION: "budgetExhaustion",
  MILESTONE_OVERDUE: "milestoneOverdue",
  INVOICE_OVERDUE: "invoiceOverdue"
});

const RISK_LABELS = Object.freeze({
  [RISK_TYPES.LOW_PER_CAPITA]: "低人均产值",
  [RISK_TYPES.LOW_CPI]: "成本效率低",
  [RISK_TYPES.BUDGET_OVERRUN]: "预算超支",
  [RISK_TYPES.SEVERE_OVERRUN]: "严重超支",
  [RISK_TYPES.SPI_WARN]: "SPI预警",
  [RISK_TYPES.SPI_CRITICAL]: "SPI严重",
  [RISK_TYPES.HIGH_INPUT_ZERO_OUTPUT]: "高投入零产出",
  [RISK_TYPES.BUDGET_EXHAUSTION]: "预算即将耗尽",
  [RISK_TYPES.MILESTONE_OVERDUE]: "里程碑逾期",
  [RISK_TYPES.INVOICE_OVERDUE]: "回款逾期"
});

function known(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function risk(type, severity, value) {
  return { type, label: RISK_LABELS[type], severity, value };
}

export function evaluateProjectRisks(project, thresholds = DEFAULT_RISK_THRESHOLDS) {
  const policy = validateRiskThresholds(thresholds);
  const risks = [];
  if (known(project.perCapita) && project.perCapita > 0 && project.perCapita < policy.lowPerCapita) {
    risks.push(risk(RISK_TYPES.LOW_PER_CAPITA, "warn", project.perCapita));
  }
  if (known(project.cpi) && project.cpi > 0 && project.cpi < policy.cpiWarn) {
    risks.push(risk(RISK_TYPES.LOW_CPI, "warn", project.cpi));
  }
  if (known(project.ac) && known(project.bac) && project.ac > project.bac) {
    risks.push(risk(RISK_TYPES.BUDGET_OVERRUN, "warn", project.ac - project.bac));
    if (project.bac > 0 && project.ac / project.bac > policy.severeOverrunRatio) {
      risks.push(risk(RISK_TYPES.SEVERE_OVERRUN, "critical", project.ac / project.bac));
    }
  }
  const spi = project.periodSPI ?? project.totalSPI;
  if (known(spi) && spi >= 0 && spi < policy.spiCritical) {
    risks.push(risk(RISK_TYPES.SPI_CRITICAL, "critical", spi));
  } else if (known(spi) && spi >= 0 && spi < policy.spiWarn) {
    risks.push(risk(RISK_TYPES.SPI_WARN, "warn", spi));
  }
  if (
    known(project.inputMd) &&
    project.inputMd > policy.highInputZeroOutputMd &&
    project.periodEV === 0
  ) {
    risks.push(risk(RISK_TYPES.HIGH_INPUT_ZERO_OUTPUT, "critical", project.inputMd));
  }
  if (
    known(project.remainingBudget) &&
    known(project.burnRatePerDay) &&
    project.burnRatePerDay > 0
  ) {
    const days = project.remainingBudget / project.burnRatePerDay;
    if (days <= policy.budgetExhaustionDays) {
      risks.push(risk(RISK_TYPES.BUDGET_EXHAUSTION, "warn", days));
    }
  }
  if (known(project.overdueMilestoneCount) && project.overdueMilestoneCount > 0) {
    risks.push(risk(RISK_TYPES.MILESTONE_OVERDUE, "critical", project.overdueMilestoneCount));
  }
  if (known(project.overdueInvoiceCount) && project.overdueInvoiceCount > 0) {
    risks.push(risk(RISK_TYPES.INVOICE_OVERDUE, "critical", project.overdueInvoiceCount));
  }
  return risks;
}

export function summarizeRisks(projects) {
  const projectIds = new Set();
  const counts = Object.fromEntries(Object.values(RISK_TYPES).map(function (type) {
    return [type, 0];
  }));
  let itemCount = 0;
  projects.forEach(function (project) {
    const risks = project.risks || [];
    if (risks.length > 0) {
      projectIds.add(project.projectId);
    }
    risks.forEach(function (item) {
      counts[item.type] += 1;
      itemCount += 1;
    });
  });
  return {
    attentionProjectCount: projectIds.size,
    attentionProjectIds: [...projectIds],
    itemCount,
    counts
  };
}
