package app

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func setupTestDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	orig, _ := os.Getwd()
	os.Chdir(dir)
	t.Cleanup(func() { os.Chdir(orig) })
	return dir
}

func setupTestDB(t *testing.T) *App {
	t.Helper()
	app := NewApp()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	if err := initDB(db); err != nil {
		t.Fatalf("init db: %v", err)
	}
	app.db = db
	t.Cleanup(func() { db.Close() })
	return app
}

func TestSanitizeScriptName(t *testing.T) {
	tests := []struct {
		input   string
		want    string
		wantErr bool
	}{
		{"test.fio", "test.fio", false},
		{"../etc/passwd", "", true},
		{"../../etc/shadow", "", true},
		{"foo/bar/test.fio", "", true},
		{"..\\..\\windows\\system32", "", true},
		{"", "", true},
		{"  ", "", true},
		{".", "", true},
		{"..", "", true},
		{"test.fio", "test.fio", false},
		{"sub/dir/../../../etc/passwd", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, err := sanitizeScriptName(tt.input)
			if (err != nil) != tt.wantErr {
				t.Errorf("sanitizeScriptName(%q) error = %v, wantErr %v", tt.input, err, tt.wantErr)
				return
			}
			if got != tt.want {
				t.Errorf("sanitizeScriptName(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestSaveAndGetScript(t *testing.T) {
	setupTestDir(t)
	app := NewApp()

	err := app.SaveScript("test.fio", "[job1]\nbs=4k\nrw=read\n")
	if err != nil {
		t.Fatalf("SaveScript error: %v", err)
	}

	content, err := app.GetScriptContent("test.fio")
	if err != nil {
		t.Fatalf("GetScriptContent error: %v", err)
	}
	if content != "[job1]\nbs=4k\nrw=read\n" {
		t.Errorf("content mismatch: %q", content)
	}
}

func TestSaveScriptAddsFioSuffix(t *testing.T) {
	setupTestDir(t)
	app := NewApp()

	err := app.SaveScript("myscript", "content")
	if err != nil {
		t.Fatalf("SaveScript error: %v", err)
	}

	// Verify file exists with .fio suffix
	if _, err := os.Stat(filepath.Join("scripts", "myscript.fio")); err != nil {
		t.Errorf("expected myscript.fio to exist: %v", err)
	}
}

func TestDeleteScript(t *testing.T) {
	setupTestDir(t)
	app := NewApp()

	app.SaveScript("to_delete.fio", "data")
	err := app.DeleteScript("to_delete.fio")
	if err != nil {
		t.Fatalf("DeleteScript error: %v", err)
	}

	if _, err := os.Stat(filepath.Join("scripts", "to_delete.fio")); !os.IsNotExist(err) {
		t.Error("script file should have been deleted")
	}
}

func TestPathTraversalBlocked(t *testing.T) {
	setupTestDir(t)
	app := NewApp()

	// Create a file outside scripts/
	os.MkdirAll("secret", 0755)
	os.WriteFile("secret/data.txt", []byte("sensitive"), 0644)

	// Try to read via path traversal
	_, err := app.GetScriptContent("../../../secret/data.txt")
	if err == nil {
		t.Error("GetScriptContent should block path traversal")
	}

	// Try to write via path traversal
	err = app.SaveScript("../../../secret/evil.fio", "bad")
	if err == nil {
		t.Error("SaveScript should block path traversal")
	}

	// Try to delete via path traversal
	err = app.DeleteScript("../../../secret/data.txt")
	if err == nil {
		t.Error("DeleteScript should block path traversal")
	}

	// Verify original file untouched
	data, err := os.ReadFile("secret/data.txt")
	if err != nil || string(data) != "sensitive" {
		t.Error("original file was modified!")
	}
}

func TestGetScriptsFromDB(t *testing.T) {
	app := setupTestDB(t)

	// Add configs via SaveScriptConfig
	if err := app.SaveScriptConfig("model_a", `{"global":{"filename":"/dev/sda"}}`); err != nil {
		t.Fatalf("SaveScriptConfig error: %v", err)
	}
	if err := app.SaveScriptConfig("model_b", `{"global":{"filename":"/dev/sdb"}}`); err != nil {
		t.Fatalf("SaveScriptConfig error: %v", err)
	}

	scripts, err := app.GetScripts()
	if err != nil {
		t.Fatalf("GetScripts error: %v", err)
	}
	if len(scripts) != 2 {
		t.Errorf("expected 2 scripts, got %d: %v", len(scripts), scripts)
	}
}

func TestGetScriptsEmpty(t *testing.T) {
	app := setupTestDB(t)

	scripts, err := app.GetScripts()
	if err != nil {
		t.Fatalf("GetScripts error: %v", err)
	}
	if len(scripts) != 0 {
		t.Errorf("expected 0 scripts, got %d: %v", len(scripts), scripts)
	}
}

func TestScriptConfigRoundTrip(t *testing.T) {
	app := setupTestDB(t)

	err := app.SaveScriptConfig("test_model", `{"global":{"filename":"/dev/vdb"},"jobs":[{"bs":4}]}`)
	if err != nil {
		t.Fatalf("SaveScriptConfig error: %v", err)
	}

	got, err := app.GetScriptConfig("test_model")
	if err != nil {
		t.Fatalf("GetScriptConfig error: %v", err)
	}
	if got != `{"global":{"filename":"/dev/vdb"},"jobs":[{"bs":4}]}` {
		t.Errorf("config mismatch: %q", got)
	}

	err = app.DeleteScriptConfig("test_model")
	if err != nil {
		t.Fatalf("DeleteScriptConfig error: %v", err)
	}

	scripts, _ := app.GetScripts()
	if len(scripts) != 0 {
		t.Errorf("expected 0 scripts after delete, got %d", len(scripts))
	}
}

func TestSanitizeTaskID(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"task-1", "task-1"},
		{"../../../etc", "etc"},
		{"normal_task_123", "normal_task_123"},
		{"", "default-task"},
		{"  ", "default-task"},
		{"task/with/slashes", "task-with-slashes"},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := sanitizeTaskID(tt.input)
			if got != tt.want {
				t.Errorf("sanitizeTaskID(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestTaskPathConsistency(t *testing.T) {
	setupTestDir(t)

	// Verify paths don't escape base directories
	taskID := "test-task"
	rawDir := taskRawDataDir(taskID)
	reportDir := taskReportDir(taskID)

	absRaw, _ := filepath.Abs(rawDir)
	absReport, _ := filepath.Abs(reportDir)
	absBase, _ := filepath.Abs(dataBaseDir())

	if len(absRaw) <= len(absBase) || absRaw[:len(absBase)] != absBase {
		t.Errorf("rawDir escapes base: %s", absRaw)
	}
	if len(absReport) <= len(absBase) || absReport[:len(absBase)] != absBase {
		t.Errorf("reportDir escapes base: %s", absReport)
	}
}

func TestGenerateFioText(t *testing.T) {
	cfg := &FioConfig{}
	cfg.Global.Filename = "/dev/vdb"
	cfg.Global.Runtime = 180
	cfg.Global.RampTime = 30
	cfg.Global.Ioengine = "libaio"
	cfg.Jobs = []FioJob{
		{Bs: 4, Rw: "randread", Iodepth: 32, Numjobs: 4, Direct: true},
		{Bs: 8, Rw: "randwrite", Iodepth: 16, Numjobs: 2, Direct: true},
	}

	text := generateFioText(cfg)

	if !strings.Contains(text, "[global]") {
		t.Error("missing [global] section")
	}
	if !strings.Contains(text, "filename=/dev/vdb") {
		t.Error("missing filename")
	}
	if !strings.Contains(text, "runtime=180") {
		t.Error("missing runtime")
	}
	if !strings.Contains(text, "[sec0_4k_randread_iodepth32]") {
		t.Error("missing job 0 section")
	}
	if !strings.Contains(text, "bs=4k") {
		t.Error("missing bs for job 0")
	}
	if !strings.Contains(text, "numjobs=4") {
		t.Error("missing numjobs for job 0")
	}
	if !strings.Contains(text, "[sec1_8k_randwrite_iodepth16]") {
		t.Error("missing job 1 section")
	}
	if !strings.Contains(text, "direct=1") {
		t.Error("missing direct=1")
	}
}
