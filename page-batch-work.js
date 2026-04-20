(function () {
  if (window.__cwBatchWorkPageLoaded) {
    return;
  }
  window.__cwBatchWorkPageLoaded = true;

  const SOURCE_PAGE = "cw-batch-work-page";
  const SOURCE_CONTENT = "cw-batch-work-content";

  let running = false;

  function post(type, message, extra) {
    window.postMessage(
      Object.assign(
        {
          source: SOURCE_PAGE,
          type: type,
          message: message
        },
        extra || {}
      ),
      "*"
    );
  }

  function runBatchWork() {
    const $ = window.jQuery;
    const tableId = "WkExecutiongrid";
    const $table = $("#" + tableId);
    const dt = $table.data("dataTablesDT");

    if (!$table.length || !dt) {
      throw new Error("未找到 WkExecutiongrid 或 dataTablesDT");
    }

    const CHANGED = DataTablesUtil.const.CHANGED_CLASS_NAME || "changed";
    const CHANGE_STORE = DataTablesUtil.const.DATA_STORE_CHG || "changeData";
    const pk = $table.attr("data-pk-column") || "extId";

    const rows = dt.rows();
    const dataArr = rows.data().toArray();
    const nodeArr = rows.nodes().toArray();
    const changeData = $table.data(CHANGE_STORE) || [];
    const changedPkSet = new Set(changeData.map(function (x) {
      return x && x[pk];
    }).filter(Boolean));

    const result = [];

    function setInputValue(input, value) {
      if (!input) {
        return;
      }
      input.value = value;
      input.setAttribute("value", value);
    }

    function setSelectValue(select, value) {
      if (!select) {
        return false;
      }
      select.value = value;
      $(select).val(value);
      return true;
    }

    dataArr.forEach(function (rowData, i) {
      if (!rowData) {
        return;
      }

      const tr = nodeArr[i];
      const planDate = rowData.planDate != null && rowData.planDate !== ""
        ? String(rowData.planDate)
        : "";

      const nextValues = {
        finishRate: "100",
        realTime: planDate,
        isNeedDo: "0",
        isState: "50",
        memo: ""
      };

      const hasChanged =
        String(rowData.finishRate ?? "") !== nextValues.finishRate ||
        String(rowData.realTime ?? "") !== nextValues.realTime ||
        String(rowData.isNeedDo ?? "") !== nextValues.isNeedDo ||
        String(rowData.isState ?? "") !== nextValues.isState ||
        String(rowData.memo ?? "") !== nextValues.memo;

      if (!hasChanged) {
        result.push({
          row: i + 1,
          extName: rowData.extName,
          skipped: true
        });
        return;
      }

      Object.assign(rowData, nextValues);

      rowData["6"] = nextValues.finishRate;
      rowData["10"] = nextValues.realTime;
      rowData["12"] = nextValues.isNeedDo;
      rowData["13"] = nextValues.memo;
      rowData["16"] = nextValues.isState;

      if (tr && tr.cells) {
        setInputValue(tr.cells[6] && tr.cells[6].querySelector("input"), nextValues.finishRate);
        setInputValue(tr.cells[10] && tr.cells[10].querySelector("input"), nextValues.realTime);
        setSelectValue(tr.cells[12] && tr.cells[12].querySelector("select"), nextValues.isNeedDo);
        setInputValue(tr.cells[13] && tr.cells[13].querySelector("input,textarea"), nextValues.memo);
        setSelectValue(tr.cells[16] && tr.cells[16].querySelector("select"), nextValues.isState);

        tr.classList.add(CHANGED);
      }

      const rowPk = rowData[pk];
      if (rowPk && !changedPkSet.has(rowPk)) {
        changeData.push(rowData);
        changedPkSet.add(rowPk);
      }

      result.push({
        row: i + 1,
        extId: rowData.extId,
        extName: rowData.extName,
        finishRate: rowData.finishRate,
        realTime: rowData.realTime,
        isNeedDo: rowData.isNeedDo,
        isState: rowData.isState
      });
    });

    $table.data(CHANGE_STORE, changeData);

    const modifyData = DataTablesUtil.data.getModifyData(tableId);
    const updateCount = modifyData && modifyData.update ? modifyData.update.length : 0;

    console.table(result);
    console.log("即将提交的数据:", modifyData);

    if (updateCount <= 0) {
      console.warn("没有可提交的 update 数据，取消自动保存");
      return {
        updateCount: 0,
        result: result,
        skipped: true
      };
    }

    console.log("检测到 " + updateCount + " 条 update，开始自动保存...");
    WkFormJS.saveAll();

    return {
      updateCount: updateCount,
      result: result,
      skipped: false
    };
  }

  function run() {
    if (running) {
      post("CW_BATCH_WORK_RUNNING", "已有批量报工任务运行中");
      return;
    }

    running = true;

    try {
      post("CW_BATCH_WORK_RUNNING", "批量填充中");
      const result = runBatchWork();

      if (result.skipped) {
        post("CW_BATCH_WORK_DONE", "没有可提交的 update 数据");
        return;
      }

      post("CW_BATCH_WORK_DONE", "已触发保存，update " + result.updateCount + " 条");
    } catch (error) {
      post("CW_BATCH_WORK_ERROR", "批量报工失败: " + (error && error.message ? error.message : String(error)));
      throw error;
    } finally {
      running = false;
    }
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window) {
      return;
    }
    const data = event.data;
    if (!data || data.source !== SOURCE_CONTENT) {
      return;
    }

    if (data.type === "CW_BATCH_WORK_START") {
      try {
        run();
      } catch (error) {
        console.error("[cw-batch-work]", error);
      }
    }
  });
})();
