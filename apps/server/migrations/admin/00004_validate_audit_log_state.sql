-- +goose Up
ALTER TABLE admin.audit_log VALIDATE CONSTRAINT audit_log_state_check;

-- +goose Down
-- Nothing to undo: the constraint stays declared (NOT VALID semantics are only a
-- build-time property); 00003's Down drops it.
SELECT 1;
