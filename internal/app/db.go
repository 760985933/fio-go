package app

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"fio-go/internal/executor"

	_ "modernc.org/sqlite"
)

type HostRecord struct {
	ID       int    `json:"id"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	User     string `json:"user"`
	Password string `json:"password"`
}

func openDB() (*sql.DB, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("获取用户目录失败: %v", err)
	}
	dbDir := filepath.Join(home, ".nettopo_test")
	if err := os.MkdirAll(dbDir, 0700); err != nil {
		return nil, fmt.Errorf("创建数据目录失败: %v", err)
	}
	dbPath := filepath.Join(dbDir, "hosts.db")
	db, err := sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, fmt.Errorf("打开数据库失败: %v", err)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("连接数据库失败: %v", err)
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

func initDB(db *sql.DB) error {
	_, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS hosts (
			id       INTEGER PRIMARY KEY AUTOINCREMENT,
			host     TEXT NOT NULL,
			port     INTEGER NOT NULL DEFAULT 22,
			user     TEXT NOT NULL DEFAULT 'root',
			password TEXT NOT NULL DEFAULT '',
			UNIQUE(host, port, user)
		)
	`)
	if err != nil {
		return err
	}
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS script_configs (
			script_name TEXT PRIMARY KEY,
			config      TEXT NOT NULL
		)
	`)
	if err != nil {
		return err
	}
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS execution_tasks (
			id   INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			data TEXT NOT NULL
		)
	`)
	if err != nil {
		return err
	}
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS key_value (
			key   TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)
	`)
	if err != nil {
		return err
	}
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS audit_log (
			id        INTEGER PRIMARY KEY AUTOINCREMENT,
			action    TEXT NOT NULL,
			details   TEXT NOT NULL DEFAULT '',
			timestamp TEXT NOT NULL
		)
	`)
	if err != nil {
		return err
	}
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS task_timestamps (
			task_id    TEXT PRIMARY KEY,
			started_at TEXT NOT NULL DEFAULT '',
			finished_at TEXT NOT NULL DEFAULT ''
		)
	`)
	if err != nil {
		return err
	}
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS iperf_configs (
			id         TEXT PRIMARY KEY,
			name       TEXT NOT NULL,
			config_json TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return err
	}
	_, err = db.Exec(`
		CREATE TABLE IF NOT EXISTS iperf_tasks (
			id                TEXT PRIMARY KEY,
			name              TEXT NOT NULL,
			config_json       TEXT NOT NULL,
			server_host_json  TEXT NOT NULL,
			client_hosts_json TEXT NOT NULL,
			status            TEXT DEFAULT 'pending',
			created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		return err
	}
	return nil
}

func dbAddHost(db *sql.DB, cfg executor.HostConfig) (int64, error) {
	res, err := db.Exec(
		`INSERT OR IGNORE INTO hosts (host, port, user, password) VALUES (?, ?, ?, ?)`,
		cfg.Host, cfg.Port, cfg.User, cfg.Password,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func dbGetHosts(db *sql.DB) ([]HostRecord, error) {
	rows, err := db.Query(`SELECT id, host, port, user, password FROM hosts ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var hosts []HostRecord
	for rows.Next() {
		var h HostRecord
		if err := rows.Scan(&h.ID, &h.Host, &h.Port, &h.User, &h.Password); err != nil {
			return nil, err
		}
		hosts = append(hosts, h)
	}
	return hosts, rows.Err()
}

func dbDeleteHost(db *sql.DB, id int) error {
	res, err := db.Exec(`DELETE FROM hosts WHERE id = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("主机记录不存在 (id=%d)", id)
	}
	return nil
}

func dbUpdateHost(db *sql.DB, id int, cfg executor.HostConfig) error {
	res, err := db.Exec(
		`UPDATE hosts SET host=?, port=?, user=?, password=? WHERE id=?`,
		cfg.Host, cfg.Port, cfg.User, cfg.Password, id,
	)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("主机记录不存在 (id=%d)", id)
	}
	return nil
}

func dbSaveScriptConfig(db *sql.DB, scriptName, configJSON string) error {
	_, err := db.Exec(
		`INSERT OR REPLACE INTO script_configs (script_name, config) VALUES (?, ?)`,
		scriptName, configJSON,
	)
	return err
}

func dbGetScriptConfig(db *sql.DB, scriptName string) (string, error) {
	var config string
	err := db.QueryRow(`SELECT config FROM script_configs WHERE script_name = ?`, scriptName).Scan(&config)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return config, err
}

func dbDeleteScriptConfig(db *sql.DB, scriptName string) error {
	_, err := db.Exec(`DELETE FROM script_configs WHERE script_name = ?`, scriptName)
	return err
}

func dbGetAllScriptNames(db *sql.DB) ([]string, error) {
	rows, err := db.Query(`SELECT script_name FROM script_configs ORDER BY script_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var names []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		names = append(names, n)
	}
	return names, rows.Err()
}

func dbSaveExecutionTasks(db *sql.DB, tasks []ExecutionTaskConfig) error {
	data, err := json.Marshal(tasks)
	if err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM execution_tasks`); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO execution_tasks (name, data) VALUES (?, ?)`, "_all_", string(data)); err != nil {
		return err
	}
	return tx.Commit()
}

func dbGetExecutionTasks(db *sql.DB) ([]ExecutionTaskConfig, error) {
	var data string
	err := db.QueryRow(`SELECT data FROM execution_tasks WHERE name = ?`, "_all_").Scan(&data)
	if err == sql.ErrNoRows {
		return []ExecutionTaskConfig{}, nil
	}
	if err != nil {
		return nil, err
	}
	var tasks []ExecutionTaskConfig
	if err := json.Unmarshal([]byte(data), &tasks); err != nil {
		return nil, err
	}
	if len(tasks) > 0 {
		ids := make([]interface{}, len(tasks))
		placeholders := ""
		for i, t := range tasks {
			if i > 0 {
				placeholders += ","
			}
			placeholders += "?"
			ids[i] = t.ID
		}
		rows, err := db.Query(
			fmt.Sprintf(`SELECT task_id, started_at, finished_at FROM task_timestamps WHERE task_id IN (%s)`, placeholders),
			ids...,
		)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		type ts struct{ started, finished string }
		tsMap := make(map[string]ts)
		for rows.Next() {
			var tid, s, f string
			if err := rows.Scan(&tid, &s, &f); err != nil {
				return nil, err
			}
			tsMap[tid] = ts{started: s, finished: f}
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
		for i := range tasks {
			if t, ok := tsMap[tasks[i].ID]; ok {
				tasks[i].StartedAt = t.started
				tasks[i].FinishedAt = t.finished
			}
		}
	}
	return tasks, nil
}

func dbSetKV(db *sql.DB, key, value string) error {
	_, err := db.Exec(`INSERT OR REPLACE INTO key_value (key, value) VALUES (?, ?)`, key, value)
	return err
}

func dbGetKV(db *sql.DB, key string) (string, error) {
	var value string
	err := db.QueryRow(`SELECT value FROM key_value WHERE key = ?`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}

func dbUpdateTaskTimestamp(db *sql.DB, taskID, field, value string) error {
	switch field {
	case "startedAt":
		_, err := db.Exec(`
			INSERT INTO task_timestamps (task_id, started_at, finished_at) VALUES (?, ?, '')
			ON CONFLICT(task_id) DO UPDATE SET started_at = excluded.started_at, finished_at = ''
		`, taskID, value)
		return err
	case "finishedAt":
		_, err := db.Exec(`
			INSERT INTO task_timestamps (task_id, started_at, finished_at) VALUES (?, '', ?)
			ON CONFLICT(task_id) DO UPDATE SET finished_at = excluded.finished_at
		`, taskID, value)
		return err
	default:
		return fmt.Errorf("unknown timestamp field: %s", field)
	}
}

func dbDeleteTaskTimestamp(db *sql.DB, taskID string) error {
	_, err := db.Exec(`DELETE FROM task_timestamps WHERE task_id = ?`, taskID)
	return err
}

func dbSaveIperfConfig(db *sql.DB, id, name, configJSON string) error {
	_, err := db.Exec(
		`INSERT OR REPLACE INTO iperf_configs (id, name, config_json) VALUES (?, ?, ?)`,
		id, name, configJSON,
	)
	return err
}

func dbGetIperfConfigs(db *sql.DB) ([]string, error) {
	rows, err := db.Query(`SELECT id FROM iperf_configs ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func dbGetIperfConfig(db *sql.DB, id string) (string, string, error) {
	var name, configJSON string
	err := db.QueryRow(`SELECT name, config_json FROM iperf_configs WHERE id = ?`, id).Scan(&name, &configJSON)
	if err == sql.ErrNoRows {
		return "", "", nil
	}
	return name, configJSON, err
}

func dbDeleteIperfConfig(db *sql.DB, id string) error {
	_, err := db.Exec(`DELETE FROM iperf_configs WHERE id = ?`, id)
	return err
}

func dbSaveIperfTask(db *sql.DB, id, name, configJSON, serverHostJSON, clientHostsJSON, status string) error {
	_, err := db.Exec(
		`INSERT OR REPLACE INTO iperf_tasks (id, name, config_json, server_host_json, client_hosts_json, status) VALUES (?, ?, ?, ?, ?, ?)`,
		id, name, configJSON, serverHostJSON, clientHostsJSON, status,
	)
	return err
}

func dbGetIperfTasks(db *sql.DB) ([]string, error) {
	rows, err := db.Query(`SELECT id FROM iperf_tasks ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func dbGetIperfTask(db *sql.DB, id string) (string, string, string, string, string, error) {
	var name, configJSON, serverHostJSON, clientHostsJSON, status string
	err := db.QueryRow(
		`SELECT name, config_json, server_host_json, client_hosts_json, status FROM iperf_tasks WHERE id = ?`, id,
	).Scan(&name, &configJSON, &serverHostJSON, &clientHostsJSON, &status)
	if err == sql.ErrNoRows {
		return "", "", "", "", "", nil
	}
	return name, configJSON, serverHostJSON, clientHostsJSON, status, err
}

func dbUpdateIperfTaskStatus(db *sql.DB, id, status string) error {
	_, err := db.Exec(`UPDATE iperf_tasks SET status = ? WHERE id = ?`, status, id)
	return err
}

func dbDeleteIperfTask(db *sql.DB, id string) error {
	_, err := db.Exec(`DELETE FROM iperf_tasks WHERE id = ?`, id)
	return err
}

func dbAddAuditLog(db *sql.DB, action, details, timestamp string) error {
	_, err := db.Exec(`INSERT INTO audit_log (action, details, timestamp) VALUES (?, ?, ?)`, action, details, timestamp)
	return err
}

func dbGetAuditLogs(db *sql.DB) ([]AuditEntry, error) {
	rows, err := db.Query(`SELECT action, details, timestamp FROM audit_log ORDER BY id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var entries []AuditEntry
	for rows.Next() {
		var e AuditEntry
		if err := rows.Scan(&e.Action, &e.Details, &e.Timestamp); err != nil {
			return nil, err
		}
		entries = append(entries, e)
	}
	return entries, rows.Err()
}
