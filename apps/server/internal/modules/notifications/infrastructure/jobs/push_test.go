package jobs_test

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/aedst/server/internal/modules/notifications/domain"
	"github.com/aedst/server/internal/modules/notifications/infrastructure/jobs"
	"github.com/aedst/server/internal/platform/push"
	"github.com/aedst/server/internal/shared/ids"
)

type store struct {
	notification domain.Notification
	prefs        domain.Preferences
	devices      []domain.Device
	deactivated  []ids.ID
	enqueued     []ids.ID
}

func (s *store) GetNotification(context.Context, ids.ID) (domain.Notification, error) {
	return s.notification, nil
}

func (s *store) GetPreferences(context.Context, ids.ID) (domain.Preferences, error) {
	return s.prefs, nil
}

func (s *store) ListActiveDevices(context.Context, ids.ID) ([]domain.Device, error) {
	return s.devices, nil
}

func (s *store) GetActiveDevice(_ context.Context, id ids.ID) (domain.Device, bool, error) {
	for _, d := range s.devices {
		if d.ID == id {
			return d, true, nil
		}
	}
	return domain.Device{}, false, nil
}

func (s *store) DeactivateDevice(_ context.Context, id ids.ID, _ time.Time) error {
	s.deactivated = append(s.deactivated, id)
	return nil
}

func (s *store) EnqueueDevicePushes(_ context.Context, _ ids.ID, devices []ids.ID) error {
	s.enqueued = devices
	return nil
}

type sender struct {
	err  error
	sent []push.Target
}

func (s *sender) Send(_ context.Context, t push.Target, _ push.Message) error {
	s.sent = append(s.sent, t)
	return s.err
}

func fixture() (*store, domain.Device) {
	user := ids.New()
	device := domain.Device{ID: ids.New(), UserID: user, Platform: domain.PlatformFCM, Address: "tok"}
	n := domain.Notification{ID: ids.New(), UserID: user, Kind: domain.KindTaskCompleted, Title: "t"}
	return &store{notification: n, prefs: domain.DefaultPreferences(), devices: []domain.Device{device}}, device
}

func TestFanOut_RespectsPreferences(t *testing.T) {
	s, device := fixture()
	w := jobs.NewFanOutWorker(s, slog.New(slog.DiscardHandler))
	job := &river.Job[jobs.PushArgs]{JobRow: &rivertype.JobRow{}, Args: jobs.PushArgs{NotificationID: s.notification.ID.String()}}

	if err := w.Work(context.Background(), job); err != nil {
		t.Fatal(err)
	}
	if len(s.enqueued) != 1 || s.enqueued[0] != device.ID {
		t.Fatalf("enqueued %v, want the active device", s.enqueued)
	}
	s.enqueued, s.prefs.TaskCompleted = nil, false
	if err := w.Work(context.Background(), job); err != nil || s.enqueued != nil {
		t.Fatalf("opted-out kind still fanned out: %v, %v", s.enqueued, err)
	}
}

func TestDeviceWorker_OutcomeHandling(t *testing.T) {
	tests := []struct {
		name           string
		sendErr        error
		wantErr        bool
		wantCancel     bool
		wantDeactivate bool
	}{
		{"delivered", nil, false, false, false},
		{"invalid token deactivates", push.ErrInvalidToken, false, false, true},
		{"disabled provider skips", push.ErrDisabled, false, false, false},
		{"permanent cancels", push.ErrPermanent, true, true, false},
		{"transient retries", errors.New("503"), true, false, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s, device := fixture()
			snd := &sender{err: tt.sendErr}
			w := jobs.NewDeviceWorker(s, snd, slog.New(slog.DiscardHandler))
			err := w.Work(context.Background(), &river.Job[jobs.PushDeviceArgs]{JobRow: &rivertype.JobRow{}, Args: jobs.PushDeviceArgs{
				NotificationID: s.notification.ID.String(), DeviceID: device.ID.String(),
			}})
			if (err != nil) != tt.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tt.wantErr)
			}
			var cancel *rivertype.JobCancelError
			if errors.As(err, &cancel) != tt.wantCancel {
				t.Errorf("cancel = %v, want %v", errors.As(err, &cancel), tt.wantCancel)
			}
			if (len(s.deactivated) == 1) != tt.wantDeactivate {
				t.Errorf("deactivated = %v", s.deactivated)
			}
			if len(snd.sent) != 1 || snd.sent[0].Token != "tok" {
				t.Errorf("sent = %+v", snd.sent)
			}
		})
	}
}

func TestDeviceWorker_SkipsDeviceThatChangedOwner(t *testing.T) {
	s, device := fixture()
	s.devices[0].UserID = ids.New()
	snd := &sender{}
	w := jobs.NewDeviceWorker(s, snd, slog.New(slog.DiscardHandler))
	err := w.Work(context.Background(), &river.Job[jobs.PushDeviceArgs]{JobRow: &rivertype.JobRow{}, Args: jobs.PushDeviceArgs{
		NotificationID: s.notification.ID.String(), DeviceID: device.ID.String(),
	}})
	if err != nil || len(snd.sent) != 0 {
		t.Fatalf("pushed to another account's device: %v %v", snd.sent, err)
	}
}

func TestTargetAndMessageMapping(t *testing.T) {
	d := domain.Device{Platform: domain.PlatformWebPush, Address: "https://push.example/x", P256dh: "p", AuthSecret: "a"}
	tgt := jobs.TargetOf(d)
	if tgt.Endpoint != "https://push.example/x" || tgt.Token != "" || tgt.P256dh != "p" || tgt.Auth != "a" {
		t.Errorf("target = %+v", tgt)
	}
	subject := ids.New()
	msg := jobs.MessageOf(domain.Notification{ID: ids.New(), Kind: domain.KindSystem, Title: "T", Link: "/x", SubjectID: &subject})
	if msg.Data["subject_id"] != subject.String() || msg.Link != "/x" || msg.Kind != "system" || msg.NotificationID == "" || msg.CollapseID == "" {
		t.Errorf("message = %+v", msg)
	}
}

func (s *store) CountUnread(context.Context, ids.ID, int) (int, error) { return 4, nil }
