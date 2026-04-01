/**
 :param cfg:         FioConfig 配置对象
 :return:            {status,msg,data}
*/
function refreshPreview(cfg) {
  if (state.isEditingFio) return;
  const r = generateFio(cfg);
  if (r.status === 0) {
    el.fioPreview.textContent = r.data.text;
    return r;
  } else {
    el.fioPreview.textContent = `错误: ${r.msg}\n` + (r.data?.error || "");
    return r;
  }
}

/**
 :param cfg:         FioConfig
 :return:            {status,msg,data}
*/
function exportJson(cfg) {
  try {
    const text = JSON.stringify(cfg, null, 2);
    recordAuditLog("导出 JSON 配置", `导出了当前的 FIO 配置为 JSON`);
    return downloadTextFile("fio_config.json", text);
  } catch (e) {
    return wrapErr("导出JSON失败", { error: String(e) });
  }
}

/**
 :param file:        File 对象
 :return:            Promise<{status,msg,data}>
*/
async function importJsonFile(file) {
  try {
    const text = await file.text();
    const obj = JSON.parse(text);
    if (!obj || !obj.global || !Array.isArray(obj.jobs)) {
      return wrapErr("JSON结构无效，请检查global/jobs字段");
    }
    // 兼容旧结构：如果存在字符串bs，尝试解析为bs_k
    obj.jobs = (obj.jobs || []).map((j) => {
      if (j.bs_k === undefined) {
        const n = parseBsToNumber(j.bs);
        if (Number.isFinite(n)) j.bs_k = n;
      }
      return j;
    });
    state.config = obj;
    // 导入后重置文件名，防止覆盖现有文件
    const newName = "imported_" + file.name.replace(/\.[^/.]+$/, "") + ".fio";
    el.configFilename.value = newName;
    if (el.currentFilenameDisplay) el.currentFilenameDisplay.textContent = newName;
    localStorage.setItem("fio_config_filename", newName);
    recordAuditLog("导入 JSON 配置", `从文件 "${file.name}" 导入了配置`);
    saveState(state.config);
    renderAll();
    refreshPreview(state.config);
    return wrapOk({}, "imported");
  } catch (e) {
    return wrapErr("导入JSON失败", { error: String(e) });
  }
}

/**
 :param idx:         任务索引
 :return:            删除操作结果
*/
function deleteJob(idx) {
  const jobName = state.config.jobs[idx].name || `任务 ${idx + 1}`;
  state.config.jobs.splice(idx, 1);
  recordAuditLog("删除 FIO 任务", `从配置中删除了任务 "${jobName}"`);
  saveState(state.config);
  renderAll();
  refreshPreview(state.config);
  return wrapOk();
}

/**
 :param idx:         任务索引
 :return:            复制操作结果
*/
function duplicateJob(idx) {
  const j = state.config.jobs[idx];
  const copy = JSON.parse(JSON.stringify(j));
  copy.name = `${j.name || "job"}_copy`;
  state.config.jobs.splice(idx + 1, 0, copy);
  recordAuditLog("复制 FIO 任务", `复制了任务 "${j.name || "job"}" 并命名为 "${copy.name}"`);
  saveState(state.config);
  renderAll();
  refreshPreview(state.config);
  return wrapOk();
}

/**
 :return:            添加一个新任务
*/
function addJob() {
  const newIdx = state.config.jobs.length;
  state.config.jobs.push({
    name: `job_${state.config.jobs.length}`,
    bs_k: 4,
    rw: "randread",
    rwmixread: 70,
    iodepth: 64,
    numjobs: 2,
    extras: {},
  });
  state.justAddedIndex = newIdx;
  recordAuditLog("添加 FIO 任务", `在配置中添加了新任务 "${state.config.jobs[newIdx].name}"`);
  saveState(state.config);
  renderAll();
  refreshPreview(state.config);
  return wrapOk();
}

/**
 :param container:   容器元素
 :param list:        键值对列表Record<string,string|number>
 :param onChange:    (key, value, i) => void
 :return:            创建KV编辑器
*/
function renderKVEditor(container, list, onChange) {
  container.innerHTML = "";
  const entries = Object.entries(list || {});
  entries.forEach(([k, v], i) => {
    const row = document.createElement("div");
    row.className = "kv-item";
    const keyInput = document.createElement("input");
    keyInput.placeholder = "键";
    keyInput.value = String(k);
    const valInput = document.createElement("input");
    valInput.placeholder = "值";
    valInput.value = String(v);
    const delBtn = document.createElement("button");
    delBtn.className = "btn danger small";
    delBtn.textContent = "删除";
    delBtn.onclick = () => {
      delete list[k];
      onChange("__delete__", null, i);
    };
    keyInput.oninput = () => onChange(keyInput.value, valInput.value, i);
    valInput.oninput = () => onChange(keyInput.value, valInput.value, i);
    row.appendChild(keyInput);
    row.appendChild(valInput);
    row.appendChild(delBtn);
    container.appendChild(row);
  });
}

/** 渲染全局设置表单 */
// 全局可视化配置已移除；相关渲染与事件函数删除，逻辑保留在默认模板与 FIO 文本生成中。

/** 渲染所有Job卡片 */
function renderJobs() {
  el.jobsContainer.innerHTML = "";
  state.config.jobs.forEach((job, idx) => {
    const card = document.createElement("div");
    card.className = "job-card";
    const details = document.createElement("details");
    details.className = "job-details";
    const summary = document.createElement("summary");
    const summaryWrap = document.createElement("div"); summaryWrap.className = "job-summary";
    const summaryTitle = document.createElement("div"); summaryTitle.className = "job-summary-title"; summaryTitle.textContent = buildJobName(idx, job);
    const summaryMeta = document.createElement("div"); summaryMeta.className = "job-actions";
    const metaText = document.createElement("span"); metaText.textContent = `${getBsText(job)}, ${job.rw || "rw"}, iodepth=${job.iodepth ?? ""}, numjobs=${job.numjobs ?? ""}`;
    const dupBtn = document.createElement("button"); dupBtn.className = "btn small"; dupBtn.textContent = "复制"; dupBtn.onclick = (e) => { e.preventDefault(); duplicateJob(idx); };
    const delBtn = document.createElement("button"); delBtn.className = "btn danger small"; delBtn.textContent = "删除"; delBtn.onclick = (e) => { e.preventDefault(); deleteJob(idx); };
    summaryMeta.appendChild(metaText); summaryMeta.appendChild(dupBtn); summaryMeta.appendChild(delBtn);
    summaryWrap.appendChild(summaryTitle); summaryWrap.appendChild(summaryMeta);
    summary.appendChild(summaryWrap);
    details.appendChild(summary);

    const grid = document.createElement("div"); grid.className = "job-grid";
    const addField = (label, value, oninput, type = "text", options) => {
      const wrap = document.createElement("div"); wrap.className = "form-item";
      const lab = document.createElement("label"); lab.textContent = label;
      if (options && Array.isArray(options)) {
        const sel = document.createElement("select"); options.forEach((opt) => { const o = document.createElement("option"); o.value = opt; o.textContent = opt; sel.appendChild(o); });
        sel.value = value ?? options[0]; sel.oninput = oninput.bind(sel);
        wrap.appendChild(lab); wrap.appendChild(sel);
      } else {
        const inp = document.createElement("input"); inp.type = type; inp.value = value ?? ""; inp.oninput = oninput.bind(inp);
        wrap.appendChild(lab); wrap.appendChild(inp);
      }
      grid.appendChild(wrap);
      return wrap;
    };

    // 名称字段移除：名称由配置自动生成并显示在折叠标题中
    // bs（单位固定k，仅填写数字）
    addField("bs（单位:k）", job.bs_k, function () { job.bs_k = Number(this.value); saveState(state.config); summaryTitle.textContent = buildJobName(idx, job); refreshPreview(state.config); }, "number");
    // rw
    let mixWrap = null;
    addField("rw", job.rw, function () {
      job.rw = this.value;
      // 切换 rwmixread 可见性：仅在 rw=rw/readwrite/randrw 时显示
      const needMix = (job.rw === "rw" || job.rw === "readwrite" || job.rw === "randrw");
      if (mixWrap) mixWrap.style.display = needMix ? "" : "none";
      saveState(state.config);
      summaryTitle.textContent = buildJobName(idx, job);
      refreshPreview(state.config);
    }, "text", ["read","write","readwrite","randread","randwrite","randrw"]);
    // rwmixread（仅在顺序混合读写时显示）
    mixWrap = addField("rwmixread", job.rwmixread, function () { job.rwmixread = Number(this.value); saveState(state.config); refreshPreview(state.config); }, "number");
    mixWrap.style.display = (job.rw === "rw" || job.rw === "readwrite" || job.rw === "randrw") ? "" : "none";
    // iodepth
    addField("iodepth", job.iodepth, function () { job.iodepth = Number(this.value); saveState(state.config); summaryTitle.textContent = buildJobName(idx, job); refreshPreview(state.config); }, "number");
    // numjobs
    addField("numjobs", job.numjobs, function () { job.numjobs = Number(this.value); saveState(state.config); refreshPreview(state.config); }, "number");

    details.appendChild(grid);
    card.appendChild(details);
    el.jobsContainer.appendChild(card);

    // 新添加的任务默认展开
    if (state.justAddedIndex === idx) {
      details.open = true;
    }
  });
  // 重置标志
  state.justAddedIndex = null;
}

/** 渲染整个页面 */
function renderAll() {
  renderJobs();
}
