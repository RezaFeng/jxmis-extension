# 周报新增下周计划任务 JS 填充流程说明

## 1. 目的

本文记录在周报页面“下周计划”表格中，通过页面已有前端 JS 精准新增并填充一条任务的交互链路。

适用页面：

```text
/jxpmo/index/frame#!/jxpmo/project/WkReportService/id/{wkId}
```

目标效果：

| 字段 | 示例值 |
|---|---|
| 任务属性 | `WBS任务` |
| WBS任务名称 | `AI辅助协作场景效益分析初稿编写` |
| 任务名称 | `测试任务` |
| 负责人 | `冯俊华` |
| 计划用时/H | `8` |
| 计划完成时间 | 按业务指定，例如 `2026-07-03 17:30:00` |

> 注意：WBS 选择弹窗确认后会自动回填 WBS 自带的负责人和计划完成时间。如果需要强制使用自定义计划完成时间，必须在 WBS 确认完成后再次写入 `planEndTime`。

## 2. 页面关键对象

### 2.1 新增按钮

```html
<button
  id="myAdd"
  data-url="/project/WkExecutionService/add"
  data-id="WkExecutiongrid_1"
  onclick="WkFormJS.addWkPlan();">
  新增
</button>
```

点击“新增”实际调用：

```js
WkFormJS.addWkPlan()
```

### 2.2 下周计划表格

```js
const $table = $("#WkExecutiongrid_1");
const dt = $table.DataTable();
```

该表格是 DataTables 表格。新增行数据保存在：

```js
$("#WkExecutiongrid_1").data("newData")
```

新增行对象带有：

```js
{
  _add_: true,
  _id_: 1783086352661
}
```

## 3. 点击新增的真实链路

### 3.1 调用逻辑

`WkFormJS.addWkPlan()` 内部流程：

```js
const wkId = $("#wkId").val();
const projectId = $("#projectId").val();
const projectName = $("#projectName").val();
const projectManager = $("#projectManager").val();
const planEndTime = $("#planEndTime").val();

$.ajax({
  url: BOMF.CONST.WEB_APP_NAME + "/rest/project/WkExecutionService/add",
  data: "",
  dataType: "json",
  async: false,
  success(bean) {
    bean.nextWkId = wkId;
    bean.taskResouce = "2";
    bean.isLaskTask = "1";
    bean.projectId = projectId;
    bean.createPerson = projectManager;
    bean.projectName = projectName;
    bean.planEndTime = planEndTime;

    DataTablesUtil.data._addRow(bean, $("#WkExecutiongrid_1"));
  }
});
```

### 3.2 请求

```http
GET /jxpmo/rest/project/WkExecutionService/add
```

返回一条空任务 bean。前端补充 `nextWkId`、`projectId`、`createPerson` 等字段后调用：

```js
DataTablesUtil.data._addRow(bean, $("#WkExecutiongrid_1"));
```

`_addRow` 做三件事：

```js
const row = DataTablesUtil.data._addSingleRow(bean);
DataTablesUtil.data.putTatbleData(DataTablesUtil.const.DATA_STORE_NEW, $table, row);
$dt.draw();
```

结果：

- 原来的“没有数据！”行被移除。
- 插入一条 `class="add odd"` 的编辑行。
- DataTables 行数从 `0` 变成 `1`。
- 新行进入 `newData`，尚未保存到后端。

## 4. 字段与 DataTables 列映射

`#WkExecutiongrid_1` 的关键列：

| 列序号 | 表头 | data-column | 控件/渲染 |
|---|---|---|---|
| 2 | 任务属性 | `_v_render` | `select#taskField` |
| 3 | WBS任务名称 | `_v_render` | `#wbsName` + `#wbsId` + 放大镜 |
| 4 | 任务名称 | `extName` | 普通 input |
| 5 | 负责人 | `_v_render` | `#majorPersonName` + `#majorPerson` + 放大镜 |
| 6 | 计划用时/H | `planDate` | 普通 input |
| 7 | 计划完成时间 | `planEndTime` | 日期 input |

普通 input 的 `change` 事件会调用：

```js
DataTablesUtil.event.domOnChange(this, colIdx)
```

它根据 `colIdx` 找到对应表头 `data-column`，再写入当前行对象：

```js
rowData[thColumn] = $(this).val();
```

因为新增行带 `_id_`，`domOnChange` 写入行对象后直接返回，不进入普通变更缓存 `changeData`。

## 5. 字段填充交互序列

### 5.1 任务属性选择 WBS任务

控件：

```js
const $row = $("#WkExecutiongrid_1 tbody tr.add").last();
const taskField = $row.find("select#taskField")[0];
```

执行：

```js
$(taskField).val("WBS任务").trigger("change");
taskField.dispatchEvent(new Event("change", { bubbles: true }));
```

触发：

```js
intaskFieid(taskField, row)
```

效果：

```js
rowData.taskField = "WBS任务";
$("#wbsName").addClass("validate[required]");
```

选择 WBS 任务后，WBS 任务名称变为必填。

### 5.2 打开 WBS 任务选择弹窗

点击 WBS 任务名称列放大镜按钮，执行：

```js
BasicTestJS.showWBSList(
  button,
  null,
  "wbsName",
  "wbsId",
  "majorPersonName",
  "majorPerson",
  "planEndTime"
);
```

内部先查最新计划 ID：

```http
GET /jxpmo/rest/project/queryWbsPlanService/query
  ?queryType=all
  &queryName=queryWbsPlanId
  &projectId={projectId}
```

返回：

```json
[
  {
    "planId": "cf005174b9c9420ca1defb6d92f7aaab"
  }
]
```

然后加载 WBS 选择页：

```http
GET /jxpmo/project/WkReportService/selectWBSPage2
  ?projectId={projectId}
  &planId={planId}
```

弹窗内表格 ID：

```js
#PlanRbsExecutegrid
```

### 5.3 搜索并选择 WBS

弹窗搜索框：

```js
#select3
```

搜索按钮执行：

```js
MyQuery2("#select3", event, "PlanRbsExecutegrid")
```

搜索请求：

```http
GET /jxpmo/rest/project/ProjectPlanDetailService/query
  ?queryName=queryVer
  &filterQuery=true
  &queryType=page
  &WBSproject2={projectId}
  &WBSplanId={planId}
  &likeAll=AI辅助协作场景效益分析初稿编写
  &rows=100
```

示例返回：

```json
{
  "rows": [
    {
      "detailId": "2a6bb5dea61a4ff2897aac275791c305",
      "detailName": "AI辅助协作场景效益分析初稿编写",
      "roleName": "冯俊华",
      "roleId": "e7c45b074bd54616afadc1df9fbe5a0c",
      "planEndTime": "2026-07-17 00:00:00",
      "finishStatus": "10",
      "finishStatusDesc": "未开始",
      "taskNo": "202607.03.12"
    }
  ]
}
```

选中目标行后点击“确定”，确认逻辑会调用：

```js
const rowData = DataTablesUtil.data.getSelectionData("PlanRbsExecutegrid", "row");
```

然后写回新增行 DOM：

```js
$row.find("#wbsName").val(rowData.detailName);
$row.find("#wbsId").val(rowData.detailId);
$row.find("#majorPersonName").val(rowData.roleName);
$row.find("#majorPerson").val(rowData.roleId);
$row.find("#planEndTime").val(rowData.planEndTime);
```

并同步写回 DataTables 行对象：

```js
row.wbsId = rowData.detailId;
row.wbsName = rowData.detailName;
row.majorPerson = rowData.roleId;
row.majorPersonName = rowData.roleName;
row.planEndTime = rowData.planEndTime;
row.taskField = "WBS任务";
row.wkStatus = "0";
```

### 5.4 任务名称填充

控件是第 4 列普通 input：

```js
const taskNameInput = $row.children().eq(4).find("input")[0];
taskNameInput.value = "测试任务";
taskNameInput.dispatchEvent(new Event("input", { bubbles: true }));
taskNameInput.dispatchEvent(new Event("change", { bubbles: true }));
```

触发：

```js
DataTablesUtil.event.domOnChange(taskNameInput, 4)
```

写入：

```js
rowData.extName = "测试任务";
```

### 5.5 负责人填充

负责人列是 readonly，正常交互为点击放大镜：

```js
BasicTestJS.showUserList(button, null, "majorPersonName", "majorPerson")
```

弹窗确认后写入：

```js
$row.find("#majorPersonName").val(rowData.userFullname);
$row.find("#majorPerson").val(rowData.userId);

row.majorPerson = rowData.userId;
row.majorPersonName = rowData.userFullname;
DataTablesUtil.event.domOnChange($row, null);
```

如果已知用户 ID，可以等价写入：

```js
const rowData = dt.row($row[0]).data();

$row.find("#majorPersonName").val("冯俊华");
$row.find("#majorPerson").val("e7c45b074bd54616afadc1df9fbe5a0c");

rowData.majorPersonName = "冯俊华";
rowData.majorPerson = "e7c45b074bd54616afadc1df9fbe5a0c";
DataTablesUtil.event.domOnChange($row, null);
```

### 5.6 计划用时填充

控件是第 6 列普通 input。

注意：该列表头字段名为 `planDate`，虽然页面显示为“计划用时/H”。

```js
const hoursInput = $row.children().eq(6).find("input")[0];
hoursInput.value = "8";
hoursInput.dispatchEvent(new Event("input", { bubbles: true }));
hoursInput.dispatchEvent(new Event("change", { bubbles: true }));
```

触发：

```js
DataTablesUtil.event.domOnChange(hoursInput, 6)
```

写入：

```js
rowData.planDate = "8";
```

### 5.7 计划完成时间填充

控件是第 7 列日期 input。

```js
const endTimeInput = $row.children().eq(7).find("input")[0];
endTimeInput.value = "2026-07-03 17:30:00";
endTimeInput.dispatchEvent(new Event("input", { bubbles: true }));
endTimeInput.dispatchEvent(new Event("change", { bubbles: true }));
```

触发：

```js
DataTablesUtil.event.domOnChange(endTimeInput, 7)
```

写入：

```js
rowData.planEndTime = "2026-07-03 17:30:00";
```

如果先选 WBS，后填计划完成时间，则最终值为自定义时间。
如果先填计划完成时间，再选 WBS，则会被 WBS 自带 `planEndTime` 覆盖。

## 6. 推荐 JS 封装

下面脚本适合在页面上下文中执行，例如浏览器 DevTools Console、扩展 content script 注入后的页面上下文。

它会：

1. 调用页面原生 `WkFormJS.addWkPlan()` 新增一行。
2. 设置任务属性为 `WBS任务`。
3. 查询 WBS 最新计划 ID。
4. 查询目标 WBS。
5. 将 WBS 信息、任务名称、负责人、计划用时、计划完成时间写入新增行。
6. 触发页面原有 `change` 逻辑，保持 DataTables 行对象同步。

```js
async function addNextWeekWbsTask(options) {
  const {
    wbsName,
    taskName,
    majorPersonName,
    majorPerson,
    planHours,
    planEndTime
  } = options;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));

  // 1. 新增行：使用页面原生新增逻辑，确保 newData、DataTables 状态一致。
  WkFormJS.addWkPlan();
  await sleep(100);

  const $table = $("#WkExecutiongrid_1");
  const dt = $table.DataTable();
  const $row = $("#WkExecutiongrid_1 tbody tr.add").last();
  const rowData = dt.row($row[0]).data();

  if (!$row.length || !rowData) {
    throw new Error("未找到新增行");
  }

  // 2. 任务属性：WBS任务。
  const taskField = $row.find("select#taskField")[0];
  $(taskField).val("WBS任务").trigger("change");
  fire(taskField, "change");
  rowData.taskField = "WBS任务";

  // 3. 查询当前项目最新 planId。
  const projectId = $("#projectId").val();
  const planRows = await $.ajax({
    type: "GET",
    url: BOMF.CONST.WEB_APP_NAME + "/rest/project/queryWbsPlanService/query",
    data: {
      queryType: "all",
      queryName: "queryWbsPlanId",
      projectId
    },
    dataType: "json"
  });

  const planId = planRows && planRows[0] && planRows[0].planId;
  if (!planId) {
    throw new Error("未查询到项目计划 planId");
  }

  // 4. 查询目标 WBS。
  const wbsResult = await $.ajax({
    type: "GET",
    url: BOMF.CONST.WEB_APP_NAME + "/rest/project/ProjectPlanDetailService/query",
    data: {
      queryName: "queryVer",
      filterQuery: true,
      queryType: "page",
      WBSproject2: projectId,
      WBSplanId: planId,
      likeAll: wbsName,
      rows: 100,
      draw: 1,
      page: 1,
      start: 0,
      length: 100
    },
    dataType: "json"
  });

  const wbs = (wbsResult.rows || []).find((item) => item.detailName === wbsName);
  if (!wbs) {
    throw new Error("未找到目标 WBS：" + wbsName);
  }

  if (wbs.finishStatus === "40") {
    throw new Error("已取消的 WBS 任务不能选择：" + wbsName);
  }

  if (wbs.finishStatus === "50") {
    throw new Error("已完成的 WBS 任务不能选择：" + wbsName);
  }

  // 5. 按 showWBSList 确认逻辑写回 WBS、负责人、计划完成时间。
  $row.find("#wbsName").val(wbs.detailName);
  $row.find("#wbsId").val(wbs.detailId);
  $row.find("#majorPersonName").val(wbs.roleName || majorPersonName);
  $row.find("#majorPerson").val(wbs.roleId || majorPerson);

  rowData.wbsName = wbs.detailName;
  rowData.wbsId = wbs.detailId;
  rowData.majorPersonName = wbs.roleName || majorPersonName;
  rowData.majorPerson = wbs.roleId || majorPerson;
  rowData.planEndTime = wbs.planEndTime;
  rowData.taskField = "WBS任务";
  rowData.wkStatus = new Date(wbs.planEndTime) > new Date() ? "0" : "1";
  $row.find("#wkStatus").text(rowData.wkStatus === "0" ? "正常" : "异常");

  // 6. 任务名称。
  const taskNameInput = $row.children().eq(4).find("input")[0];
  taskNameInput.value = taskName;
  fire(taskNameInput, "input");
  fire(taskNameInput, "change");

  // 7. 如需要覆盖负责人，放在 WBS 写回之后。
  if (majorPersonName && majorPerson) {
    $row.find("#majorPersonName").val(majorPersonName);
    $row.find("#majorPerson").val(majorPerson);
    rowData.majorPersonName = majorPersonName;
    rowData.majorPerson = majorPerson;
  }

  // 8. 计划用时/H。页面字段名实际为 planDate。
  const hoursInput = $row.children().eq(6).find("input")[0];
  hoursInput.value = String(planHours);
  fire(hoursInput, "input");
  fire(hoursInput, "change");

  // 9. 计划完成时间。如果业务要求自定义时间，必须放在 WBS 写回之后。
  const endTimeInput = $row.children().eq(7).find("input")[0];
  endTimeInput.value = planEndTime;
  fire(endTimeInput, "input");
  fire(endTimeInput, "change");

  // 10. 确保新增缓存中的对象就是当前行对象。
  return {
    rowData,
    newData: $table.data("newData")
  };
}

addNextWeekWbsTask({
  wbsName: "AI辅助协作场景效益分析初稿编写",
  taskName: "测试任务",
  majorPersonName: "冯俊华",
  majorPerson: "e7c45b074bd54616afadc1df9fbe5a0c",
  planHours: 8,
  planEndTime: "2026-07-03 17:30:00"
});
```

## 7. 最终数据检查

执行完成后检查：

```js
const $table = $("#WkExecutiongrid_1");
const dt = $table.DataTable();
const $row = $("#WkExecutiongrid_1 tbody tr.add").last();

dt.row($row[0]).data();
$table.data("newData");
```

期望关键字段：

```js
{
  taskField: "WBS任务",
  wbsId: "2a6bb5dea61a4ff2897aac275791c305",
  wbsName: "AI辅助协作场景效益分析初稿编写",
  extName: "测试任务",
  majorPerson: "e7c45b074bd54616afadc1df9fbe5a0c",
  majorPersonName: "冯俊华",
  planDate: "8",
  planEndTime: "2026-07-03 17:30:00",
  _add_: true
}
```

## 8. 保存说明

本文只覆盖“新增并填充前端 DataTables 新行”的流程。

此时数据仍在浏览器前端缓存中：

```js
$("#WkExecutiongrid_1").data("newData")
```

真正落库需要继续触发页面“保存”逻辑。保存时应确认 `newData` 中该新增对象字段完整，再调用页面原有保存流程或对应保存接口。

