//go:build linux

package processjob

import "os/exec"

// Linux test/development builds do not emulate Windows Job Object guarantees.
// Windows is Cluster's only supported production native-server target.
type Job struct{}

func New() (*Job, error)                        { return &Job{}, nil }
func (j *Job) Assign(cmd *exec.Cmd) error       { return nil }
func (j *Job) Close() error                     { return nil }
func (j *Job) ActiveProcesses() (uint32, error) { return 0, nil }
