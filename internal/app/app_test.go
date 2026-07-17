package app

import (
	"os"
	"path/filepath"
	"testing"
)

func setupTestDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	orig, _ := os.Getwd()
	os.Chdir(dir)
	t.Cleanup(func() { os.Chdir(orig) })
	return dir
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

	scripts, _ := app.GetScripts()
	found := false
	for _, s := range scripts {
		if s == "myscript.fio" {
			found = true
		}
	}
	if !found {
		t.Errorf("expected myscript.fio in scripts list, got: %v", scripts)
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

	scripts, _ := app.GetScripts()
	for _, s := range scripts {
		if s == "to_delete.fio" {
			t.Error("script should have been deleted")
		}
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

func TestGetScripts(t *testing.T) {
	setupTestDir(t)
	app := NewApp()

	os.MkdirAll("scripts", 0755)
	os.WriteFile("scripts/a.fio", []byte("a"), 0644)
	os.WriteFile("scripts/b.fio", []byte("b"), 0644)
	os.WriteFile("scripts/c.txt", []byte("c"), 0644) // should be excluded

	scripts, err := app.GetScripts()
	if err != nil {
		t.Fatalf("GetScripts error: %v", err)
	}
	if len(scripts) != 2 {
		t.Errorf("expected 2 scripts, got %d: %v", len(scripts), scripts)
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
	rawDir := filepath.Join("data", "tasks", sanitizeTaskID(taskID), "raw")
	reportDir := filepath.Join("output", "tasks", sanitizeTaskID(taskID))

	absRaw, _ := filepath.Abs(rawDir)
	absReport, _ := filepath.Abs(reportDir)
	absBase, _ := filepath.Abs(".")

	if len(absRaw) <= len(absBase) || absRaw[:len(absBase)] != absBase {
		t.Errorf("rawDir escapes base: %s", absRaw)
	}
	if len(absReport) <= len(absBase) || absReport[:len(absBase)] != absBase {
		t.Errorf("reportDir escapes base: %s", absReport)
	}
}
