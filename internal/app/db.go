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
	dbDir := filepath.Join(home, ".fio-gui")
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
	return err
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
	_, err = db.Exec(`DELETE FROM execution_tasks`)
	if err != nil {
		return err
	}
	_, err = db.Exec(`INSERT INTO execution_tasks (name, data) VALUES (?, ?)`, "_all_", string(data))
	return err
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
	return tasks, nil
}
