package architecturetest

import (
	"bufio"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// File-size policy for hand-written Go (repo-wide: green <= 300 lines, yellow
// 301-400, yellow-high 401-500, red > 500). Red fails the build; the rest is
// logged so `go test -v ./architecturetest` lists what to split next.
const (
	fileLinesGreen  = 300
	fileLinesYellow = 400
	fileLinesRed    = 500
)

func TestHandWrittenGoFilesStayUnderSizeLimit(t *testing.T) {
	var warn, high, red []string
	err := filepath.WalkDir("..", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			switch d.Name() {
			case "gen", "node_modules", ".git", "vendor", "bin":
				return filepath.SkipDir
			}
			return nil
		}
		if !strings.HasSuffix(path, ".go") {
			return nil
		}
		n, generated, err := countLines(path)
		if err != nil {
			return err
		}
		if generated {
			return nil
		}
		entry := path + " (" + strconv.Itoa(n) + ")"
		switch {
		case n > fileLinesRed:
			red = append(red, entry)
		case n > fileLinesYellow:
			high = append(high, entry)
		case n > fileLinesGreen:
			warn = append(warn, entry)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk: %v", err)
	}
	for _, list := range [][]string{warn, high, red} {
		sort.Strings(list)
	}
	for _, e := range warn {
		t.Logf("yellow (>%d lines): %s", fileLinesGreen, e)
	}
	for _, e := range high {
		t.Logf("yellow-high (>%d lines): %s", fileLinesYellow, e)
	}
	for _, e := range red {
		t.Errorf("red (>%d lines), split it: %s", fileLinesRed, e)
	}
}

// countLines returns the number of lines in a Go file and whether it is
// generated (the standard "Code generated ... DO NOT EDIT." header).
func countLines(path string) (n int, generated bool, err error) {
	f, err := os.Open(path)
	if err != nil {
		return 0, false, err
	}
	defer func() { _ = f.Close() }()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for sc.Scan() {
		n++
		if n <= 5 && strings.HasPrefix(sc.Text(), "// Code generated") && strings.Contains(sc.Text(), "DO NOT EDIT") {
			generated = true
		}
	}
	return n, generated, sc.Err()
}
