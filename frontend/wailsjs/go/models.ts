export namespace app {
	
	export class ActionResult {
	    host: string;
	    error?: string;
	    msg: string;
	    running: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ActionResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.error = source["error"];
	        this.msg = source["msg"];
	        this.running = source["running"];
	    }
	}
	export class AnalysisSummary {
	    id: string;
	    name: string;
	    scripts: string[];
	    hasData: boolean;
	    hasReport: boolean;
	    logAvailable: boolean;
	    dataDir: string;
	    reportDir: string;
	    reportHtmlUrl: string;
	    downloadUrl: string;
	    startedAt?: string;
	    finishedAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new AnalysisSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.scripts = source["scripts"];
	        this.hasData = source["hasData"];
	        this.hasReport = source["hasReport"];
	        this.logAvailable = source["logAvailable"];
	        this.dataDir = source["dataDir"];
	        this.reportDir = source["reportDir"];
	        this.reportHtmlUrl = source["reportHtmlUrl"];
	        this.downloadUrl = source["downloadUrl"];
	        this.startedAt = source["startedAt"];
	        this.finishedAt = source["finishedAt"];
	    }
	}
	export class AuditEntry {
	    action: string;
	    details: string;
	    timestamp: string;
	
	    static createFrom(source: any = {}) {
	        return new AuditEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.action = source["action"];
	        this.details = source["details"];
	        this.timestamp = source["timestamp"];
	    }
	}
	export class CheckResult {
	    host: string;
	    running: boolean;
	    residual: boolean;
	    msg: string;
	
	    static createFrom(source: any = {}) {
	        return new CheckResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.running = source["running"];
	        this.residual = source["residual"];
	        this.msg = source["msg"];
	    }
	}
	export class ConnectivityResult {
	    ok: boolean;
	    msg: string;
	
	    static createFrom(source: any = {}) {
	        return new ConnectivityResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ok = source["ok"];
	        this.msg = source["msg"];
	    }
	}
	export class ExecutionTaskConfig {
	    id: string;
	    name: string;
	    scripts: string[];
	    hosts: executor.HostConfig[];
	    startedAt?: string;
	    finishedAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new ExecutionTaskConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.scripts = source["scripts"];
	        this.hosts = this.convertValues(source["hosts"], executor.HostConfig);
	        this.startedAt = source["startedAt"];
	        this.finishedAt = source["finishedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HostRecord {
	    id: number;
	    host: string;
	    port: number;
	    user: string;
	    password: string;
	
	    static createFrom(source: any = {}) {
	        return new HostRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.password = source["password"];
	    }
	}
	export class OrchestrationConfig {
	    sequence: string[];
	    interval: number;
	
	    static createFrom(source: any = {}) {
	        return new OrchestrationConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sequence = source["sequence"];
	        this.interval = source["interval"];
	    }
	}
	export class OrchestrationProgress {
	    taskId: string;
	    taskName: string;
	    step: string;
	    status: string;
	    error?: string;
	    results?: ActionResult[];
	    current: number;
	    total: number;
	
	    static createFrom(source: any = {}) {
	        return new OrchestrationProgress(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.taskId = source["taskId"];
	        this.taskName = source["taskName"];
	        this.step = source["step"];
	        this.status = source["status"];
	        this.error = source["error"];
	        this.results = this.convertValues(source["results"], ActionResult);
	        this.current = source["current"];
	        this.total = source["total"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace executor {
	
	export class ExecutionResult {
	    host: string;
	    error?: string;
	    msg: string;
	    running: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ExecutionResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.error = source["error"];
	        this.msg = source["msg"];
	        this.running = source["running"];
	    }
	}
	export class HostConfig {
	    host: string;
	    port?: number;
	    user?: string;
	    password?: string;
	
	    static createFrom(source: any = {}) {
	        return new HostConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.port = source["port"];
	        this.user = source["user"];
	        this.password = source["password"];
	    }
	}

}

export namespace iperf {
	
	export class IperfAnalysisSummary {
	    taskId: string;
	    taskName: string;
	    serverHost: string;
	    clientCount: number;
	    status: string;
	    hasData: boolean;
	    hasReport: boolean;
	    createdAt: string;
	    avgBandwidth: number;
	    maxBandwidth: number;
	
	    static createFrom(source: any = {}) {
	        return new IperfAnalysisSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.taskId = source["taskId"];
	        this.taskName = source["taskName"];
	        this.serverHost = source["serverHost"];
	        this.clientCount = source["clientCount"];
	        this.status = source["status"];
	        this.hasData = source["hasData"];
	        this.hasReport = source["hasReport"];
	        this.createdAt = source["createdAt"];
	        this.avgBandwidth = source["avgBandwidth"];
	        this.maxBandwidth = source["maxBandwidth"];
	    }
	}
	export class IperfConfig {
	    id: string;
	    name: string;
	    protocol: string;
	    bandwidth: string;
	    duration: number;
	    parallel: number;
	    blockSize: string;
	    windowSize: string;
	    reverse: boolean;
	    bidir: boolean;
	    extraFlags: string;
	    serverTestIP: string;
	    serverBindIP: string;
	
	    static createFrom(source: any = {}) {
	        return new IperfConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.protocol = source["protocol"];
	        this.bandwidth = source["bandwidth"];
	        this.duration = source["duration"];
	        this.parallel = source["parallel"];
	        this.blockSize = source["blockSize"];
	        this.windowSize = source["windowSize"];
	        this.reverse = source["reverse"];
	        this.bidir = source["bidir"];
	        this.extraFlags = source["extraFlags"];
	        this.serverTestIP = source["serverTestIP"];
	        this.serverBindIP = source["serverBindIP"];
	    }
	}
	export class IperfInterval {
	    timestamp: number;
	    streamID: number;
	    duration: number;
	    bytes: number;
	    bitsPerSecond: number;
	    jitterMs: number;
	    lostPackets: number;
	    totalPackets: number;
	    retransmits: number;
	    cpuUser: number;
	    cpuSys: number;
	
	    static createFrom(source: any = {}) {
	        return new IperfInterval(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.timestamp = source["timestamp"];
	        this.streamID = source["streamID"];
	        this.duration = source["duration"];
	        this.bytes = source["bytes"];
	        this.bitsPerSecond = source["bitsPerSecond"];
	        this.jitterMs = source["jitterMs"];
	        this.lostPackets = source["lostPackets"];
	        this.totalPackets = source["totalPackets"];
	        this.retransmits = source["retransmits"];
	        this.cpuUser = source["cpuUser"];
	        this.cpuSys = source["cpuSys"];
	    }
	}
	export class IperfTask {
	    id: string;
	    name: string;
	    config: IperfConfig;
	    serverHost: executor.HostConfig;
	    clientHosts: executor.HostConfig[];
	    status: string;
	    createdAt: string;
	    startedAt?: string;
	    finishedAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new IperfTask(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.config = this.convertValues(source["config"], IperfConfig);
	        this.serverHost = this.convertValues(source["serverHost"], executor.HostConfig);
	        this.clientHosts = this.convertValues(source["clientHosts"], executor.HostConfig);
	        this.status = source["status"];
	        this.createdAt = source["createdAt"];
	        this.startedAt = source["startedAt"];
	        this.finishedAt = source["finishedAt"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

