# 周报下周计划新增 WBS 任务直填说明

## 1. 文档目的

本文说明如何在周报页面“下周计划”表格中，通过页面已有 JS 对当前新增行进行精准填充。

本文记录的是最新验证过的一次完整流程：

| 字段 | 填充值 |
|---|---|
| 任务属性 | `WBS任务` |
| WBS任务名称 | `AI辅助协作场景效益分析初稿编写` |
| 任务名称 | 同 WBS 任务名称，即 `AI辅助协作场景效益分析初稿编写` |
| 负责人 | `冯俊华` |
| 计划用时/H | `16` |
| 计划完成时间 | `2026-07-10 17:30:00` |

该方案不打开 WBS 弹窗，不点击搜索按钮，而是直接复刻弹窗“确定”后的回填逻辑。

## 2. 前置条件

必须满足：

1. 当前页面已经进入周报详情页。
2. 下周计划表格 `#WkExecutiongrid_1` 已初始化为 DataTables。
3. 当前已经存在一条新增行，通常由页面按钮触发：

```js
WkFormJS.addWkPlan();
```

4. 目标 WBS 的关键字段已知：

```js
{
  detailId: "2a6bb5dea61a4ff2897aac275791c305",
  detailName: "AI辅助协作场景效益分析初稿编写",
  roleId: "e7c45b074bd54616afadc1df9fbe5a0c",
  roleName: "冯俊华",
  finishStatus: "10"
}
```

5. WBS 状态必须可选：

| finishStatus | 含义 | 是否可选 |
|---|---|---|
| `10` | 未开始 | 是 |
| `40` | 已取消 | 否 |
| `50` | 已完成 | 否 |

## 3. 页面关键结构

### 3.1 新增按钮

页面“新增”按钮：

```html
<button
  id="myAdd"
  data-url="/project/WkExecutionService/add"
  data-id="WkExecutiongrid_1"
  onclick="WkFormJS.addWkPlan();">
  新增
</button>
```

点击后执行：

```js
WkFormJS.addWkPlan();
```

内部请求：

```http
GET /jxpmo/rest/project/WkExecutionService/add
```

返回空任务 bean 后，页面会补充周报、项目、创建人等字段，并调用：

```js
DataTablesUtil.data._addRow(bean, $("#WkExecutiongrid_1"));
```

新增结果：

- 表格 `#WkExecutiongrid_1` 出现一条 `tr.add` 行。
- DataTables 行对象带 `_add_: true`。
- 新行对象同步保存在：

```js
$("#WkExecutiongrid_1").data("newData")
```

### 3.2 下周计划表格

```js
const $table = $("#WkExecutiongrid_1");
const dt = $table.DataTable();
const $row = $("#WkExecutiongrid_1 tbody tr.add").last();
const row = dt.row($row[0]).data();
```

## 4. 字段映射

`#WkExecutiongrid_1` 的关键列如下：

| 列序号 | 页面字段 | DataTables 字段 | DOM 控件 |
|---|---|---|---|
| 2 | 任务属性 | `taskField` | `select#taskField` |
| 3 | WBS任务名称 | `wbsName` / `wbsId` | `#wbsName` / `#wbsId` |
| 4 | 任务名称 | `extName` | 第 4 列 input |
| 5 | 负责人 | `majorPersonName` / `majorPerson` | `#majorPersonName` / `#majorPerson` |
| 6 | 计划用时/H | `planDate` | 第 6 列 input |
| 7 | 计划完成时间 | `planEndTime` | 第 7 列 input |
| 8 | 任务状态 | `wkStatus` | `#wkStatus` |

注意：页面显示“计划用时/H”，但 DataTables 字段名实际是 `planDate`。

## 5. 最新验证流程

### 5.1 开始前

当前新增行为空：

```js
{
  taskField: "",
  wbsId: "",
  wbsName: "",
  extName: "",
  majorPerson: "",
  majorPersonName: "",
  planDate: "",
  planEndTime: "",
  wkStatus: "",
  _add_: true
}
```

### 5.2 任务属性选择 WBS任务

操作：

```js
const taskField = $row.find("select#taskField")[0];
$(taskField).val("WBS任务").trigger("change");
taskField.dispatchEvent(new Event("change", { bubbles: true }));
```

触发：

```js
intaskFieid(taskField, row);
```

效果：

```js
row.taskField = "WBS任务";
$row.find("#wbsName").addClass("validate[required]");
```

事件记录：

```js
{ type: "change", tag: "SELECT", id: "taskField", value: "WBS任务" }
```

### 5.3 WBS任务名称直接回填

不打开弹窗，直接写入目标 WBS：

```js
$row.find("#wbsName").val("AI辅助协作场景效益分析初稿编写");
$row.find("#wbsId").val("2a6bb5dea61a4ff2897aac275791c305");

row.wbsName = "AI辅助协作场景效益分析初稿编写";
row.wbsId = "2a6bb5dea61a4ff2897aac275791c305";
```

触发 DOM 事件：

```js
fire($row.find("#wbsName")[0], "input");
fire($row.find("#wbsName")[0], "change");
```

事件记录：

```js
{ type: "input", tag: "TEXTAREA", id: "wbsName", value: "AI辅助协作场景效益分析初稿编写" }
{ type: "change", tag: "TEXTAREA", id: "wbsName", value: "AI辅助协作场景效益分析初稿编写" }
```

### 5.4 任务名称填为 WBS任务名称

业务要求：任务名称内容等于 WBS 任务名称。

操作：

```js
const taskNameInput = $row.children().eq(4).find("input")[0];
taskNameInput.value = wbs.detailName;
fire(taskNameInput, "input");
fire(taskNameInput, "change");
row.extName = wbs.detailName;
```

触发：

```js
DataTablesUtil.event.domOnChange(taskNameInput, 4);
```

写入：

```js
row.extName = "AI辅助协作场景效益分析初稿编写";
```

事件记录：

```js
{ type: "input", tag: "INPUT", id: "", value: "AI辅助协作场景效益分析初稿编写" }
{ type: "change", tag: "INPUT", id: "", value: "AI辅助协作场景效益分析初稿编写" }
```

### 5.5 负责人填冯俊华

操作：

```js
$row.find("#majorPersonName").val("冯俊华");
$row.find("#majorPerson").val("e7c45b074bd54616afadc1df9fbe5a0c");

row.majorPersonName = "冯俊华";
row.majorPerson = "e7c45b074bd54616afadc1df9fbe5a0c";
```

触发 DOM 事件：

```js
fire($row.find("#majorPersonName")[0], "input");
fire($row.find("#majorPersonName")[0], "change");
```

事件记录：

```js
{ type: "input", tag: "INPUT", id: "majorPersonName", value: "冯俊华" }
{ type: "change", tag: "INPUT", id: "majorPersonName", value: "冯俊华" }
```

### 5.6 计划用时填 16

操作：

```js
const hoursInput = $row.children().eq(6).find("input")[0];
hoursInput.value = "16";
fire(hoursInput, "input");
fire(hoursInput, "change");
row.planDate = "16";
```

触发：

```js
DataTablesUtil.event.domOnChange(hoursInput, 6);
```

写入：

```js
row.planDate = "16";
```

事件记录：

```js
{ type: "input", tag: "INPUT", id: "", value: "16" }
{ type: "change", tag: "INPUT", id: "", value: "16" }
```

### 5.7 计划完成时间填 2026-07-10 17:30:00

操作：

```js
const planEndInput = $row.children().eq(7).find("input")[0];
planEndInput.value = "2026-07-10 17:30:00";
fire(planEndInput, "input");
fire(planEndInput, "change");

row.planEndTime = "2026-07-10 17:30:00";
row.wkStatus = new Date(row.planEndTime) > new Date() ? "0" : "1";
$row.find("#wkStatus").text(row.wkStatus === "0" ? "正常" : "异常");
```

触发：

```js
DataTablesUtil.event.domOnChange(planEndInput, 7);
```

写入：

```js
row.planEndTime = "2026-07-10 17:30:00";
row.wkStatus = "0";
```

事件记录：

```js
{ type: "input", tag: "INPUT", id: "1783088204101_56186", value: "2026-07-10 17:30:00" }
{ type: "change", tag: "INPUT", id: "1783088204101_56186", value: "2026-07-10 17:30:00" }
```

## 6. 最终结果

最终 DataTables 行对象和 `newData` 中的新增对象一致：

```js
{
  taskField: "WBS任务",
  wbsId: "2a6bb5dea61a4ff2897aac275791c305",
  wbsName: "AI辅助协作场景效益分析初稿编写",
  extName: "AI辅助协作场景效益分析初稿编写",
  majorPerson: "e7c45b074bd54616afadc1df9fbe5a0c",
  majorPersonName: "冯俊华",
  planDate: "16",
  planEndTime: "2026-07-10 17:30:00",
  wkStatus: "0",
  _add_: true
}
```

校验方式：

```js
const $table = $("#WkExecutiongrid_1");
const dt = $table.DataTable();
const $row = $("#WkExecutiongrid_1 tbody tr.add").last();

console.log(dt.row($row[0]).data());
console.log($table.data("newData"));
```

## 7. 完整 JS 示例

该脚本用于填充当前最后一条新增行。

```js
const $table = $("#WkExecutiongrid_1");
const dt = $table.DataTable();
const $row = $("#WkExecutiongrid_1 tbody tr.add").last();
const row = dt.row($row[0]).data();

const wbs = {
  detailId: "2a6bb5dea61a4ff2897aac275791c305",
  detailName: "AI辅助协作场景效益分析初稿编写",
  roleId: "e7c45b074bd54616afadc1df9fbe5a0c",
  roleName: "冯俊华",
  finishStatus: "10"
};

const fire = (el, type) => {
  if (!el) return;
  el.dispatchEvent(new Event(type, { bubbles: true }));
};

if (!row) {
  throw new Error("未找到当前新增行 DataTables 数据");
}

if (wbs.finishStatus === "40" || wbs.finishStatus === "50") {
  throw new Error("WBS状态不可选择");
}

// 1. 任务属性 = WBS任务
const taskField = $row.find("select#taskField")[0];
$(taskField).val("WBS任务").trigger("change");
fire(taskField, "change");
row.taskField = "WBS任务";
$row.find("#wbsName").addClass("validate[required]");

// 2. WBS任务名称
$row.find("#wbsName").val(wbs.detailName);
$row.find("#wbsId").val(wbs.detailId);
row.wbsName = wbs.detailName;
row.wbsId = wbs.detailId;
fire($row.find("#wbsName")[0], "input");
fire($row.find("#wbsName")[0], "change");

// 3. 任务名称 = WBS任务名称
const taskNameInput = $row.children().eq(4).find("input")[0];
taskNameInput.value = wbs.detailName;
fire(taskNameInput, "input");
fire(taskNameInput, "change");
row.extName = wbs.detailName;

// 4. 负责人 = 冯俊华
$row.find("#majorPersonName").val("冯俊华");
$row.find("#majorPerson").val("e7c45b074bd54616afadc1df9fbe5a0c");
row.majorPersonName = "冯俊华";
row.majorPerson = "e7c45b074bd54616afadc1df9fbe5a0c";
fire($row.find("#majorPersonName")[0], "input");
fire($row.find("#majorPersonName")[0], "change");

// 5. 计划用时/H = 16，字段名实际为 planDate
const hoursInput = $row.children().eq(6).find("input")[0];
hoursInput.value = "16";
fire(hoursInput, "input");
fire(hoursInput, "change");
row.planDate = "16";

// 6. 计划完成时间
const planEndInput = $row.children().eq(7).find("input")[0];
planEndInput.value = "2026-07-10 17:30:00";
fire(planEndInput, "input");
fire(planEndInput, "change");
row.planEndTime = "2026-07-10 17:30:00";
row.wkStatus = new Date(row.planEndTime) > new Date() ? "0" : "1";
$row.find("#wkStatus").text(row.wkStatus === "0" ? "正常" : "异常");
```

## 8. 可选：包含新增行创建的完整脚本

如果当前还没有新增行，可以先调用页面原生新增逻辑：

```js
WkFormJS.addWkPlan();
```

再执行第 7 节脚本。

也可以封装为函数：

```js
function fillCurrentWbsTask() {
  if (!$("#WkExecutiongrid_1 tbody tr.add").length) {
    WkFormJS.addWkPlan();
  }

  const $table = $("#WkExecutiongrid_1");
  const dt = $table.DataTable();
  const $row = $("#WkExecutiongrid_1 tbody tr.add").last();
  const row = dt.row($row[0]).data();
  const fire = (el, type) => el && el.dispatchEvent(new Event(type, { bubbles: true }));

  const wbs = {
    detailId: "2a6bb5dea61a4ff2897aac275791c305",
    detailName: "AI辅助协作场景效益分析初稿编写",
    roleId: "e7c45b074bd54616afadc1df9fbe5a0c",
    roleName: "冯俊华",
    finishStatus: "10"
  };

  if (!row) throw new Error("未找到新增行");
  if (wbs.finishStatus === "40" || wbs.finishStatus === "50") {
    throw new Error("WBS状态不可选择");
  }

  const taskField = $row.find("select#taskField")[0];
  $(taskField).val("WBS任务").trigger("change");
  fire(taskField, "change");
  row.taskField = "WBS任务";

  $row.find("#wbsName").addClass("validate[required]").val(wbs.detailName);
  $row.find("#wbsId").val(wbs.detailId);
  row.wbsName = wbs.detailName;
  row.wbsId = wbs.detailId;
  fire($row.find("#wbsName")[0], "input");
  fire($row.find("#wbsName")[0], "change");

  const taskNameInput = $row.children().eq(4).find("input")[0];
  taskNameInput.value = wbs.detailName;
  fire(taskNameInput, "input");
  fire(taskNameInput, "change");
  row.extName = wbs.detailName;

  $row.find("#majorPersonName").val("冯俊华");
  $row.find("#majorPerson").val("e7c45b074bd54616afadc1df9fbe5a0c");
  row.majorPersonName = "冯俊华";
  row.majorPerson = "e7c45b074bd54616afadc1df9fbe5a0c";
  fire($row.find("#majorPersonName")[0], "input");
  fire($row.find("#majorPersonName")[0], "change");

  const hoursInput = $row.children().eq(6).find("input")[0];
  hoursInput.value = "16";
  fire(hoursInput, "input");
  fire(hoursInput, "change");
  row.planDate = "16";

  const planEndInput = $row.children().eq(7).find("input")[0];
  planEndInput.value = "2026-07-10 17:30:00";
  fire(planEndInput, "input");
  fire(planEndInput, "change");
  row.planEndTime = "2026-07-10 17:30:00";

  row.wkStatus = new Date(row.planEndTime) > new Date() ? "0" : "1";
  $row.find("#wkStatus").text(row.wkStatus === "0" ? "正常" : "异常");

  return {
    rowData: row,
    newData: $table.data("newData")
  };
}

fillCurrentWbsTask();
```

## 9. 保存注意事项

以上流程只完成前端表格新增行填充。

此时数据仍在页面前端：

```js
$("#WkExecutiongrid_1").data("newData")
```

真正落库仍需要触发页面原有“保存”逻辑。

