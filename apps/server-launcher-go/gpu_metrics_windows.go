//go:build windows

package main

import (
	"context"
	"encoding/csv"
	"fmt"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Native GPU sampling is asynchronous and cached. No driver probe runs on the Win32 message thread.
// The detailed hardware engine lives in the authenticated server Operations API.
type nativeGpuSampler struct {
	mu      sync.Mutex
	last    time.Time
	pending bool
	summary string
	utilization int
	available bool
}

func (sampler *nativeGpuSampler) poll() {
	sampler.mu.Lock()
	if sampler.pending || (!sampler.last.IsZero() && time.Since(sampler.last) < 30*time.Second) {
		sampler.mu.Unlock()
		return
	}
	sampler.pending = true
	sampler.last = time.Now()
	sampler.mu.Unlock()
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 2500*time.Millisecond)
		defer cancel()
		cmd := exec.CommandContext(ctx, "nvidia-smi", "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits")
		output, err := cmd.Output()
		label := "GPU metrics unavailable"
		usage, available := 0, false
		if err == nil && len(output) <= 16*1024 {
			reader := csv.NewReader(strings.NewReader(string(output)))
			rows, parseErr := reader.ReadAll()
			if parseErr == nil && len(rows) > 0 && len(rows[0]) >= 5 {
				fields := rows[0]
				name := strings.TrimSpace(fields[0])
				if len(name) > 45 {
					name = name[:45]
				}
				load, loadErr := strconv.Atoi(strings.TrimSpace(fields[1]))
				used, usedErr := strconv.Atoi(strings.TrimSpace(fields[2]))
				total, totalErr := strconv.Atoi(strings.TrimSpace(fields[3]))
				temp, tempErr := strconv.Atoi(strings.TrimSpace(fields[4]))
				if name != "" {
					label = name
					if loadErr == nil && load >= 0 && load <= 100 {
						usage, available = load, true
						label += fmt.Sprintf(" | GPU %d%%", load)
					} else {
						label += " | Load --"
					}
					if usedErr == nil && totalErr == nil && used >= 0 && total > 0 && used <= total {
						label += fmt.Sprintf(" | VRAM %d/%d MiB", used, total)
					} else {
						label += " | VRAM --"
					}
					if tempErr == nil && temp >= 0 && temp <= 150 {
						label += fmt.Sprintf(" | %d°C", temp)
					}
					if len(rows) > 1 {
						label += fmt.Sprintf(" | %d GPUs", len(rows))
					}
				}
			}
		}
		sampler.mu.Lock()
		sampler.summary = label
		sampler.utilization = usage
		sampler.available = available
		sampler.pending = false
		sampler.mu.Unlock()
	}()
}
func (sampler *nativeGpuSampler) snapshot() string {
	sampler.mu.Lock()
	defer sampler.mu.Unlock()
	if sampler.summary == "" {
		return "GPU detecting..."
	}
	return sampler.summary
}

// The progress bar shares the cached 30-second GPU observation.
func (sampler *nativeGpuSampler) usageSnapshot() (int, bool) {
	sampler.mu.Lock()
	defer sampler.mu.Unlock()
	return sampler.utilization, sampler.available
}
