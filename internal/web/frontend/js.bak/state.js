/**
 * @typedef {Object} GlobalOptions
 * @property {string} filename
 * @property {number} runtime
 * @property {number} ramp_time
 * @property {string} ioengine
 * @property {number} direct
 * @property {number} time_based
 * @property {number} norandommap
 * @property {number} randrepeat
 * @property {number} log_avg_msec
 * @property {number} group_reporting
 * @property {Record<string,string|number>} extras
 */

/**
 * @typedef {Object} JobOptions
 * @property {string} name
 * @property {string} bs
 * @property {string} rw
 * @property {number} rwmixread
 * @property {number} iodepth
 * @property {number} numjobs
 * @property {number} thread
 * @property {number} direct
 * @property {number} overwrite
 * @property {string} cpus_allowed_policy
 * @property {number} log_avg_msec
 * @property {string} write_bw_log
 * @property {string} write_lat_log
 * @property {string} write_iops_log
 * @property {Record<string,string|number>} extras
 */

/**
 * @typedef {Object} FioConfig
 * @property {GlobalOptions} global
 * @property {JobOptions[]} jobs
 */

/**
 :return:             默认配置对象
*/
function createDefaultConfig() {
  /** @type {FioConfig} */
  const cfg = {
    global: {
      filename: "/dev/vdb",
      runtime: 180,
      ramp_time: 10,
      ioengine: "libaio",
      direct: 1,
      time_based: 1,
      norandommap: 1,
      randrepeat: 0,
      log_avg_msec: 500,
      group_reporting: 1,
      extras: {},
    },
    jobs: [],
  };
  return cfg;
}

// 全局状态
const state = {
  /** @type {FioConfig} */ config: loadState() || createDefaultConfig(),
  /** 最近一次新添加任务的索引，用于默认展开 */
  justAddedIndex: null,
  /** 是否正在手动编辑预览 */
  isEditingFio: false,
};

// FIO 任务执行相关逻辑
const executionState = {
  tasks: [],
  scripts: [],
  logs: {},
  saveTimer: null,
  refreshTimers: {}, // taskId -> intervalId
};

const analysisState = {
  tasks: [],
  selectedTaskId: "",
};

// 编排状态
let orchestrationState = {
  sequence: [], // Array of task IDs
  interval: 10,
  isRunning: false,
  shouldStop: false
};

let autoSaveTimer = null;

/**
 * 显示主机实时日志弹窗
 */
let hostLogRefreshTimer = null;

/**
 :return:             从localStorage加载配置
*/
function loadState() {
  try {
    const s = localStorage.getItem("fio_config_state");
    if (!s) return null;
    const obj = JSON.parse(s);
    if (obj && obj.global && Array.isArray(obj.jobs)) return obj;
    return null;
  } catch (e) {
    console.warn("loadState error", e);
    return null;
  }
}

/**
 :param cfg:         要持久化的配置对象
 :return:            {status,msg,data}
*/
function saveState(cfg) {
  try {
    localStorage.setItem("fio_config_state", JSON.stringify(cfg));
    triggerAutoSave();
    return wrapOk({}, "saved");
  } catch (e) {
    return wrapErr("无法保存到本地存储", { error: String(e) });
  }
}
