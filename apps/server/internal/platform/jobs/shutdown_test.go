package jobs_test

import (
	"testing"
	"time"

	"github.com/aedst/server/internal/platform/jobs"
)

func TestRescueAfterExceedsTheLongestJob(t *testing.T) {
	if got := jobs.RescueAfter(jobs.MaxJobTimeout); got <= jobs.MaxJobTimeout {
		t.Fatalf("RescueAfter = %v, must exceed MaxJobTimeout %v or healthy long jobs are rescued and run twice", got, jobs.MaxJobTimeout)
	}
}

func TestSoftStopStaysInsideTheShutdownBudget(t *testing.T) {
	tests := []struct {
		budget, want time.Duration
	}{
		{15 * time.Second, 13 * time.Second},
		{20 * time.Second, 18 * time.Second},
		{2 * time.Second, time.Second},
		{0, time.Second},
	}
	for _, tt := range tests {
		got := jobs.SoftStopFor(tt.budget)
		if got != tt.want {
			t.Errorf("SoftStopFor(%v) = %v, want %v", tt.budget, got, tt.want)
		}
		if tt.budget > time.Second && got >= tt.budget {
			t.Errorf("SoftStopFor(%v) = %v leaves no time to persist cancelled jobs", tt.budget, got)
		}
	}
}
