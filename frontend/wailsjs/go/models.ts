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
	    script: string;
	    hasData: boolean;
	    hasReport: boolean;
	    logAvailable: boolean;
	    dataDir: string;
	    reportDir: string;
	    reportHtmlUrl: string;
	    downloadUrl: string;
	
	    static createFrom(source: any = {}) {
	        return new AnalysisSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.script = source["script"];
	        this.hasData = source["hasData"];
	        this.hasReport = source["hasReport"];
	        this.logAvailable = source["logAvailable"];
	        this.dataDir = source["dataDir"];
	        this.reportDir = source["reportDir"];
	        this.reportHtmlUrl = source["reportHtmlUrl"];
	        this.downloadUrl = source["downloadUrl"];
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
	export class ExecutionTaskConfig {
	    id: string;
	    name: string;
	    script: string;
	    hosts: executor.HostConfig[];
	
	    static createFrom(source: any = {}) {
	        return new ExecutionTaskConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.script = source["script"];
	        this.hosts = this.convertValues(source["hosts"], executor.HostConfig);
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

