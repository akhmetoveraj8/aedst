package modulekit

import (
	"strings"
	"testing"
)

func noop(*Env, RemoteTarget) error { return nil }

func units() map[string]Module {
	return map[string]Module{
		"tasks":       {Name: "tasks", Remote: noop},
		"media":       {Name: "media", Requires: []string{"tasks"}},
		"admin":       {Name: "admin", Requires: []string{"tasks", "media"}},
		"social":      {Name: "social"},
		"social/like": {Name: "social/like", Requires: []string{"social/comment"}, Remote: noop},
		"social/comment": {
			Name: "social/comment", Remote: noop,
		},
	}
}

func TestSelect_EmptyMeansTheWholeMonolith(t *testing.T) {
	plan, err := selectUnits(units(), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Local) != len(units()) || len(plan.Remote) != 0 {
		t.Fatalf("plan = %v local, %v remote; want everything local", names(plan.Local), names(plan.Remote))
	}
}

func TestSelect_AModuleEnablesItsFeaturesAndAFeatureOnlyItself(t *testing.T) {
	plan, err := selectUnits(units(), []string{"social"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(names(plan.Local), ","); got != "social,social/comment,social/like" {
		t.Fatalf("hosting the module: %s", got)
	}

	plan, err = selectUnits(units(), []string{"social/comment"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(names(plan.Local), ","); got != "social/comment" {
		t.Fatalf("hosting one feature: %s", got)
	}
}

func TestSelect_ARequirementThatIsNotHostedNeedsAURL(t *testing.T) {
	_, err := selectUnits(units(), []string{"media"}, nil)
	if err == nil || !strings.Contains(err.Error(), "AEDST_MODULE_TASKS_URL") {
		t.Fatalf("err = %v, want the fix named (AEDST_MODULE_TASKS_URL)", err)
	}

	plan, err := selectUnits(units(), []string{"media"}, map[string]string{"tasks": "http://tasks:8080"})
	if err != nil {
		t.Fatal(err)
	}
	if names(plan.Local)[0] != "media" || names(plan.Remote)[0] != "tasks" {
		t.Fatalf("local %v remote %v", names(plan.Local), names(plan.Remote))
	}
}

func TestSelect_FeatureNamesAreAddressableInTheEnvironment(t *testing.T) {
	plan, err := selectUnits(units(), []string{"social/like"}, map[string]string{"social/comment": "http://c:8080"})
	if err != nil {
		t.Fatal(err)
	}
	if got := names(plan.Remote); len(got) != 1 || got[0] != "social/comment" {
		t.Fatalf("remote = %v", got)
	}
	if envName("social/comment") != "SOCIAL__COMMENT" {
		t.Fatalf("envName = %s", envName("social/comment"))
	}
}

func TestSelect_Refusals(t *testing.T) {
	cases := map[string]struct {
		enabled []string
		urls    map[string]string
		want    string
	}{
		"unknown enabled name":     {[]string{"chat"}, nil, `"chat"`},
		"url for an unknown unit":  {[]string{"media"}, map[string]string{"nope": "http://x"}, "names no registered unit"},
		"remote without a hook":    {[]string{"tasks"}, map[string]string{"media": "http://x"}, "no Remote hook"},
		"hosted and remote":        {[]string{"tasks"}, map[string]string{"tasks": "http://x"}, "pick one"},
		"url for a hosted by name": {[]string{"social"}, map[string]string{"social/like": "http://x"}, "pick one"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := selectUnits(units(), tc.enabled, tc.urls)
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("err = %v, want it to contain %q", err, tc.want)
			}
		})
	}
}

func TestSelect_AllUnitsLocalExceptTheRemoteOnes(t *testing.T) {
	// An empty AEDST_MODULES with one URL set: everything but that unit is hosted.
	plan, err := selectUnits(units(), nil, map[string]string{"tasks": "http://t"})
	if err != nil {
		t.Fatal(err)
	}
	if plan.Hosts("tasks") || !plan.Hosts("media") || !plan.Hosts("admin") {
		t.Fatalf("hosted = %v", plan.Names())
	}
	if got := names(plan.Remote); len(got) != 1 || got[0] != "tasks" {
		t.Fatalf("remote = %v", got)
	}
}

func TestParent(t *testing.T) {
	if Parent("social/like") != "social" || Parent("tasks") != "" {
		t.Fatalf("Parent: %q %q", Parent("social/like"), Parent("tasks"))
	}
}
