import { el } from './dom.js';

/*
  FIO 配置生成器前端逻辑
  - 可视化编辑 Global 和 Jobs
  - 生成 .fio 配置文本并下载
  - 支持导入/导出 JSON
  - 本地持久化与预置模板
*/

/**
 :return:             {
                        "status": 0,
                        "msg": "",
                        "data": {}
                       }
*/
export function wrapOk(data = {}, msg = "") {
  return { status: 0, msg, data };
}

/**
 :param msg:         错误信息
 :param data:        附带数据（可选）
 :return:            { "status": 1, "msg": msg, "data": data }
*/
export function wrapErr(msg = "操作失败", data = {}) {
  return { status: 1, msg, data };
}

export function showResultsModal(data) {
  const { taskName, action, results, rawDir } = data;
  const actionNames = {
    "status": "状态检查",
    "pull": "数据收集",
    "killall": "终止任务",
    "deploy": "部署并执行",
    "clean_local": "清理服务器端",
    "clean_remote": "清理目标主机"
  };
  const actionName = actionNames[action] || action;
  
  el.resultsModalTitle.textContent = `任务 "${taskName}" ${actionName}结果`;
  el.resultsTableBody.innerHTML = "";
  
  results.forEach(res => {
    const tr = document.createElement("tr");
    
    const hostTd = document.createElement("td");
    hostTd.textContent = res.host;
    tr.appendChild(hostTd);
    
    const msgTd = document.createElement("td");
    if (res.error) {
      msgTd.textContent = res.error;
      msgTd.className = "status-error";
    } else {
      msgTd.textContent = res.msg;
      if (res.msg.includes("successfully") || res.msg.includes("Running") || res.msg.includes("files")) {
        msgTd.className = "status-success";
      }
    }
    tr.appendChild(msgTd);
    el.resultsTableBody.appendChild(tr);
  });
  
  el.resultsModalFooter.textContent = action === "pull" ? `任务数据本地目录: ${rawDir}` : "";
  
  el.resultsModal.style.display = "flex";
  el.resultsModalCloseBtn.onclick = () => {
    el.resultsModal.style.display = "none";
  };
}

let hostLogRefreshTimer = null;

export async function showHostLogModal(taskId, host) {
  el.hostLogModalTitle.textContent = `主机日志流 - ${host}`;
  el.hostLogViewer.textContent = "正在连接并拉取日志...";
  el.hostLogModal.style.display = "flex";
  el.hostLogAutoRefresh.checked = false;

  let abortController = new AbortController();

  const fetchLog = async () => {
    try {
      const res = await fetch(`/api/host-log?taskId=${taskId}&host=${encodeURIComponent(host)}`, {
        signal: abortController.signal
      });
      if (!res.ok) throw new Error(await res.text());
      const log = await res.text();
      el.hostLogViewer.textContent = log;
      el.hostLogViewer.scrollTop = el.hostLogViewer.scrollHeight;
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('Fetch aborted');
        return;
      }
      el.hostLogViewer.textContent = `拉取日志失败: ${err.message}`;
      // 如果报错了，自动关闭刷新
      if (hostLogRefreshTimer) {
        clearInterval(hostLogRefreshTimer);
        hostLogRefreshTimer = null;
        el.hostLogAutoRefresh.checked = false;
      }
    }
  };

  el.hostLogAutoRefresh.onchange = (e) => {
    if (e.target.checked) {
      if (hostLogRefreshTimer) clearInterval(hostLogRefreshTimer);
      hostLogRefreshTimer = setInterval(fetchLog, 3000);
    } else {
      if (hostLogRefreshTimer) {
        clearInterval(hostLogRefreshTimer);
        hostLogRefreshTimer = null;
      }
    }
  };

  el.hostLogCloseBtn.onclick = () => {
    abortController.abort(); // 中断正在进行的请求
    if (hostLogRefreshTimer) {
      clearInterval(hostLogRefreshTimer);
      hostLogRefreshTimer = null;
    }
    el.hostLogModal.style.display = "none";
  };

  fetchLog().catch(err => {
    console.error("Failed to fetch log initially:", err);
  });
}

/**
 * 显示二次确认弹窗
 */
export function showConfirmModal(title, contentHtml, isDanger = true) {
  return new Promise((resolve) => {
    el.confirmModalTitle.textContent = title;
    el.confirmModalBody.innerHTML = contentHtml;
    el.confirmModalOkBtn.className = isDanger ? "btn danger" : "btn primary";
    el.confirmModal.style.display = "flex";

    const cleanup = () => {
      el.confirmModal.style.display = "none";
      el.confirmModalOkBtn.onclick = null;
      el.confirmModalCancelBtn.onclick = null;
    };

    el.confirmModalOkBtn.onclick = () => {
      cleanup();
      resolve(true);
    };

    el.confirmModalCancelBtn.onclick = () => {
      cleanup();
      resolve(false);
    };
  });
}

/**
 * 自定义 Prompt 弹窗
 */
export function showCustomPrompt(title, defaultValue = "") {
  return new Promise((resolve) => {
    el.modalTitle.textContent = title;
    el.modalInput.value = defaultValue;
    el.customPromptModal.style.display = "flex";
    el.modalInput.focus();

    const cleanup = () => {
      el.customPromptModal.style.display = "none";
      el.modalConfirmBtn.onclick = null;
      el.modalCancelBtn.onclick = null;
      window.removeEventListener("keydown", handleKeydown);
    };

    const handleKeydown = (e) => {
      if (e.key === "Enter") el.modalConfirmBtn.click();
      if (e.key === "Escape") el.modalCancelBtn.click();
    };

    el.modalConfirmBtn.onclick = () => {
      const val = el.modalInput.value.trim();
      cleanup();
      resolve(val || null);
    };

    el.modalCancelBtn.onclick = () => {
      cleanup();
      resolve(null);
    };

    window.addEventListener("keydown", handleKeydown);
  });
}

/**
 :param key:         键名
 :param value:       键值
 :return:            安全键名（移除非法字符，只允许[a-zA-Z0-9_]+）
*/
export function sanitizeKey(key, value) {
  const safe = String(key || "").replace(/[^a-zA-Z0-9_]/g, "");
  return safe;
}

/**
 :param filename:    下载文件名
 :param content:     文本内容
 :return:            {status,msg,data}
*/
export function downloadTextFile(filename, content) {
  try {
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return wrapOk();
  } catch (e) {
    return wrapErr("下载失败", { error: String(e) });
  }
}

/**
 :param job:        JobOptions
 :return:           返回如"256k"的文本
*/
export function getBsText(job) {
  if (job && Number.isFinite(job.bs_k)) return `${job.bs_k}k`;
  if (job && job.bs) {
    const n = parseBsToNumber(job.bs);
    if (Number.isFinite(n)) return `${n}k`;
    // 原始字符串兜底
    return String(job.bs);
  }
  return "";
}

/**
 :param bs:        可能是"256"或"256k"等
 :return:          解析出数字部分
*/
export function parseBsToNumber(bs) {
  if (bs === undefined || bs === null) return NaN;
  const m = String(bs).match(/^(\d+)/);
  return m ? Number(m[1]) : NaN;
}

/**
 :param idx:       任务顺序索引（从0开始）
 :param job:       JobOptions
 :return:          { bw, lat, iops } 三个日志路径
*/
export function buildLogPaths(idx, job) {
  const base = "/tmp/fio/data/logs";
  const bsText = getBsText(job);
  const rwText = job.rw || "rw";
  const iodepthText = `iodepth${job.iodepth ?? ""}`;
  const prefix = `${base}/${idx}_${bsText}_${rwText}_${iodepthText}`;
  return {
    bw: `${prefix}_bw.log`,
    lat: `${prefix}_lat.log`,
    iops: `${prefix}_iops.log`,
  };
}

/**
 :param idx:       任务序号（从0开始）
 :param job:       JobOptions
 :return:          名称格式如：sec0_256k_read_iodepth32
*/
export function buildJobName(idx, job) {
  const bsText = getBsText(job) || "";
  const rwText = job?.rw || "";
  const iodepthText = (job && job.iodepth !== undefined && job.iodepth !== null) ? `iodepth${job.iodepth}` : "iodepth";
  // 组装名称
  const parts = [`sec${idx}`, bsText, rwText, iodepthText].filter(Boolean);
  return parts.join("_");
}
