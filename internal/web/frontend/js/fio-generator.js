import { buildJobName, buildLogPaths, getBsText, wrapErr, wrapOk } from './utils.js';

/**
 :param cfg:         FioConfig 配置对象
 :param includeJson: 是否在末尾附加 JSON 注释
 :return:            {status,msg,data:{ text: string }}
*/
export function generateFio(cfg, includeJson = false) {
  try {
    const lines = [];
    lines.push("[global]");
    const g = cfg.global || {};
    // 按需求：global 仅输出固定项
    const globalOrder = [
      "runtime",
      "ramp_time",
      "filename",
    ];
    for (const key of globalOrder) {
      if (g[key] !== undefined && g[key] !== null && g[key] !== "") {
        lines.push(`${key}=${g[key]}`);
      } else if (key === "runtime") {
        lines.push("runtime=180");
      } else if (key === "ramp_time") {
        lines.push("ramp_time=10");
      }
    }
    // 其余 global 默认项不在 [global] 输出，改为在每个 job 中补充

    (cfg.jobs || []).forEach((job, idx) => {
      lines.push("");
      const jobName = buildJobName(idx, job);
      lines.push(`[${jobName}]`);
      const order = [
        // 按要求仅输出核心字段，bs单位固定为k
        "bs",
        "rw",
        "rwmixread",
        "iodepth",
        "numjobs",
      ];
      // bs按k单位输出
      const bsValue = getBsText(job);
      lines.push(`bs=${bsValue}`);
      // 其他核心字段
      if (job.rw) lines.push(`rw=${job.rw}`);
      // 仅在混合读写场景输出 rwmixread（rw/readwrite/randrw）
      if ((job.rw === "rw" || job.rw === "readwrite" || job.rw === "randrw") && job.rwmixread !== undefined && job.rwmixread !== null) {
        lines.push(`rwmixread=${job.rwmixread}`);
      }
      if (job.iodepth !== undefined && job.iodepth !== null) lines.push(`iodepth=${job.iodepth}`);
      if (job.numjobs !== undefined && job.numjobs !== null) lines.push(`numjobs=${job.numjobs}`);

      // 补充默认内容（来自 xpxv.fio 14-26 行）：在 job 级别输出
      lines.push("thread=1");
      lines.push("direct=1");
      lines.push("overwrite=1");
      lines.push("ioengine=libaio");
      lines.push("time_based=1");
      lines.push("norandommap=1");
      lines.push("randrepeat=0");
      lines.push("log_avg_msec=500");
      lines.push("stonewall=1");
      lines.push("group_reporting=1");
      lines.push("cpus_allowed_policy=split");

      // 自动生成日志路径
      const logs = buildLogPaths(idx, job);
      lines.push(`write_bw_log=${logs.bw}`);
      lines.push(`write_lat_log=${logs.lat}`);
      lines.push(`write_iops_log=${logs.iops}`);
    });
    
    if (includeJson) {
      lines.push("");
      lines.push("# FIO_CONFIG_JSON: " + JSON.stringify(cfg));
    }
    return wrapOk({ text: lines.join("\n") });
  } catch (e) {
    return wrapErr("生成配置失败", { error: String(e) });
  }
}
