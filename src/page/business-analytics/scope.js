import { validateProjectFilters, projectMatchesFilters } from "../../analytics/config.js";

function flattenDepartmentNodes(nodes, result = []) {
  (Array.isArray(nodes) ? nodes : []).forEach(function (node) {
    if (!node || typeof node !== "object") {
      return;
    }
    result.push(node);
    flattenDepartmentNodes(node.children, result);
  });
  return result;
}

export function normalizeDepartments(nodes) {
  const byId = new Map();
  flattenDepartmentNodes(nodes).forEach(function (node) {
    const id = String(node.id ?? "").trim();
    const name = String(node.text ?? "").trim();
    const privLevel = String(node.attributes?.privLevel ?? "");
    if (id && name && privLevel !== "1") {
      byId.set(id, { id, name, privLevel });
    }
  });
  return [...byId.values()];
}

export function buildProjectScope(input) {
  const departments = normalizeDepartments(input.departments);
  const filters = validateProjectFilters(input.filters);
  const filteredProjects = (input.projects || []).filter(function (project) {
    return projectMatchesFilters(project, filters);
  });
  const departmentById = new Map(departments.map(function (department) {
    return [department.id, department];
  }));
  const projectsByDepartment = new Map();
  const historical = new Map();
  filteredProjects.forEach(function (project) {
    const departmentId = String(project.projectDept ?? "").trim();
    if (!departmentById.has(departmentId)) {
      const key = departmentId + "::" + String(project.projectDeptName || "");
      const item = historical.get(key) || {
        projectDept: departmentId || null,
        projectDeptName: project.projectDeptName || null,
        projectCount: 0
      };
      item.projectCount += 1;
      historical.set(key, item);
      return;
    }
    const rows = projectsByDepartment.get(departmentId) || [];
    rows.push(project);
    projectsByDepartment.set(departmentId, rows);
  });
  const recentOrder = new Map((input.recentDepartmentIds || []).map(function (id, index) {
    return [String(id), index];
  }));
  const validDepartments = departments.filter(function (department) {
    return (projectsByDepartment.get(department.id) || []).length > 0;
  }).map(function (department) {
    return Object.assign({}, department, {
      projectCount: projectsByDepartment.get(department.id).length
    });
  }).sort(function (a, b) {
    const aOrder = recentOrder.has(a.id) ? recentOrder.get(a.id) : Number.MAX_SAFE_INTEGER;
    const bOrder = recentOrder.has(b.id) ? recentOrder.get(b.id) : Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder || a.name.localeCompare(b.name, "zh-CN");
  });
  const allProjects = [];
  const seen = new Set();
  validDepartments.forEach(function (department) {
    projectsByDepartment.get(department.id).forEach(function (project) {
      if (!seen.has(project.projectId)) {
        seen.add(project.projectId);
        allProjects.push(project);
      }
    });
  });
  return {
    filters,
    departments: validDepartments,
    projectsByDepartment,
    allProjects,
    diagnostics: {
      historicalDepartments: [...historical.values()],
      historicalProjectCount: [...historical.values()].reduce(function (sum, item) {
        return sum + item.projectCount;
      }, 0)
    }
  };
}

export function selectDepartmentProjects(scope, departmentId) {
  if (departmentId === "all") {
    return scope.allProjects.slice();
  }
  return (scope.projectsByDepartment.get(String(departmentId)) || []).slice();
}

function inputHoursByProject(rows) {
  const result = new Map();
  (rows || []).forEach(function (row) {
    const projectId = String(row.projectId);
    result.set(projectId, (result.get(projectId) || 0) + row.realHour);
  });
  return result;
}

export function applyCurrentPeriodInputScope(input) {
  const candidates = (input.projects || []).slice();
  const onlyCurrentPeriodInput = input.onlyCurrentPeriodInput !== false;
  const currentAvailable = input.currentAvailable !== false;
  const previousAvailable = input.previousAvailable !== false;
  const currentHours = currentAvailable ? inputHoursByProject(input.currentDailyRows) : null;
  const previousHours = previousAvailable ? inputHoursByProject(input.previousDailyRows) : null;
  const projects = onlyCurrentPeriodInput && currentAvailable
    ? candidates.filter(function (project) {
      return (currentHours.get(String(project.projectId)) || 0) > 0;
    })
    : candidates;
  const rangesKnown = currentAvailable && previousAvailable;
  const enteredProjectIds = rangesKnown ? [] : null;
  const exitedProjectIds = rangesKnown ? [] : null;
  const rangeChangeProjects = rangesKnown ? [] : null;
  if (rangesKnown) {
    candidates.forEach(function (project) {
      const projectId = String(project.projectId);
      const current = currentHours.get(projectId) || 0;
      const previous = previousHours.get(projectId) || 0;
      if (current > 0 && previous === 0) enteredProjectIds.push(projectId);
      if (current === 0 && previous > 0) exitedProjectIds.push(projectId);
      if ((current > 0) !== (previous > 0)) {
        rangeChangeProjects.push({
          projectId,
          projectNo: project.projectNo || null,
          projectName: project.projectName,
          currentInputMd: current / 8,
          previousInputMd: previous / 8
        });
      }
    });
  }
  return {
    projects,
    candidateProjectCount: candidates.length,
    formalProjectCount: onlyCurrentPeriodInput && !currentAvailable ? null : projects.length,
    onlyCurrentPeriodInput,
    status: onlyCurrentPeriodInput ? (currentAvailable ? "success" : "failed") : "notApplicable",
    enteredProjectIds,
    exitedProjectIds,
    rangeChangeProjects
  };
}
