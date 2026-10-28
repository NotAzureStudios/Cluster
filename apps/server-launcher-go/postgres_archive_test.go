package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var postgresFixtureFiles = []string{
	"pgsql/bin/postgres.exe", "pgsql/bin/pg_ctl.exe", "pgsql/bin/initdb.exe", "pgsql/bin/psql.exe", "pgsql/bin/createdb.exe", "pgsql/share/cluster-test.txt",
}

func writePostgresTestArchive(t *testing.T, entries []string) string {
	t.Helper()
	dest := filepath.Join(t.TempDir(), "postgres-binaries.zip")
	f, err := os.Create(dest)
	if err != nil {
		t.Fatal(err)
	}
	writer := zip.NewWriter(f)
	for _, entry := range entries {
		file, err := writer.Create(entry)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := file.Write([]byte("test-payload")); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	return dest
}
func TestPostgresPortableBinariesExtractWithoutRunningExecutable(t *testing.T) {
	archive := writePostgresTestArchive(t, postgresFixtureFiles)
	output := filepath.Join(t.TempDir(), "private", "postgresql")
	if err := extractPostgresBinaries(archive, output); err != nil {
		t.Fatal(err)
	}
	for _, entry := range postgresFixtureFiles {
		out := filepath.Join(output, filepath.FromSlash(strings.TrimPrefix(entry, "pgsql/")))
		if contents, err := os.ReadFile(out); err != nil || string(contents) != "test-payload" {
			t.Fatalf("bad output %s: %s, %v", out, contents, err)
		}
	}
}
func TestPostgresArchiveSHA256RejectsTampering(t *testing.T) {
	archive := writePostgresTestArchive(t, postgresFixtureFiles)
	data, err := os.ReadFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(data)
	expected := hex.EncodeToString(digest[:])
	if err := verifySHA256(archive, expected); err != nil {
		t.Fatal(err)
	}
	if err := verifySHA256(archive, postgresBinariesSHA256); err == nil {
		t.Fatal("mismatched PostgreSQL distribution accepted")
	}
}
func TestPostgresArchiveRejectsMalformedMembers(t *testing.T) {
	cases := map[string][]string{
		"path traversal":                append(append([]string{}, postgresFixtureFiles...), "pgsql/../../outside.txt"),
		"absolute member":               append(append([]string{}, postgresFixtureFiles...), "/windows/system32/hijack.exe"),
		"unexpected root":               append(append([]string{}, postgresFixtureFiles...), "evil/setup.exe"),
		"duplicate file":                append(append([]string{}, postgresFixtureFiles...), "pgsql/bin/postgres.exe"),
		"missing PostgreSQL executable": {"pgsql/bin/pg_ctl.exe", "pgsql/bin/initdb.exe", "pgsql/bin/psql.exe", "pgsql/bin/createdb.exe"},
	}
	for label, entries := range cases {
		t.Run(label, func(t *testing.T) {
			archive := writePostgresTestArchive(t, entries)
			dest := filepath.Join(t.TempDir(), "runtime")
			if err := extractPostgresBinaries(archive, dest); err == nil {
				t.Fatal("unsafe PostgreSQL archive accepted")
			}
		})
	}
}
