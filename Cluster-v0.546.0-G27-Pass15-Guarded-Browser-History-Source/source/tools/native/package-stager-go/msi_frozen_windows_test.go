//go:build windows

package main

import (
    "os"
    "testing"
)

// Executable only on a Windows test host. Cross-compilation alone does not
// exercise Windows sharing semantics and must never be reported as such.
func TestMSIFrozenSourceDeniesConcurrentOverwriteAndDeleteOnWindows(t *testing.T) {
    seed, path := frozenFixture(t)
    hash := seed.sha256
    if err := seed.close(); err != nil { t.Fatal(err) }
    held, err := acquireMSIFrozenSource(path, hash)
    if err != nil { t.Fatal(err) }
    if err := held.verify(); err != nil { t.Fatal(err) }
    if f, err := os.OpenFile(path, os.O_WRONLY, 0600); err == nil {
        f.Close()
        held.close()
        t.Fatal("protected MSI allowed a competing writer")
    }
    if err := os.Remove(path); err == nil {
        held.close()
        t.Fatal("protected MSI allowed deletion while held")
    }
    if err := held.close(); err != nil { t.Fatal(err) }
    if err := os.Remove(path); err != nil { t.Fatalf("MSI source lock leaked: %v", err) }
}
