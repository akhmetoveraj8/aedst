package main

// The module list. Each line links one business module's registration
// (internal/modules/<name>/module, which calls modulekit.Register from init).
// Adding a module means adding its import here and nothing else in cmd/server:
// build order, workers, event consumers, retention, role policy and RPC mounting
// all come from the registry. architecturetest fails if a module directory is
// missing from this list or does not register itself.
import (
	_ "github.com/aedst/server/internal/modules/admin/module"
	_ "github.com/aedst/server/internal/modules/appattest/module"
	_ "github.com/aedst/server/internal/modules/capabilities/module"
	_ "github.com/aedst/server/internal/modules/integrity/module"
	_ "github.com/aedst/server/internal/modules/media/module"
	_ "github.com/aedst/server/internal/modules/notifications/module"
	_ "github.com/aedst/server/internal/modules/search/module"
	_ "github.com/aedst/server/internal/modules/tasks/module"
	_ "github.com/aedst/server/internal/modules/webhooks/module"
)
