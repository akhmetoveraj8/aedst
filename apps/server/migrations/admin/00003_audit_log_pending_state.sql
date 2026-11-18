-- +goose Up
-- Audit-first operator actions (docs/content/decisions/0020-location-transparent-units.md):
-- when the module that owns the target runs in another process, admin cannot write
-- the audit entry and the effect in one transaction. It writes the entry first, in
-- state 'pending', with a River job (admin.apply) in the same transaction; the job
-- performs the effect through the owner's API and resolves the entry to 'applied' or
-- 'failed'. Rows written by the in-process path are 'applied' from the start (the
-- DEFAULT), exactly as before.
ALTER TABLE admin.audit_log
    ADD COLUMN state       TEXT        NOT NULL DEFAULT 'applied',
    ADD COLUMN failure     TEXT        NOT NULL DEFAULT '',
    ADD COLUMN result      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN resolved_at TIMESTAMPTZ;

-- Validated in the next migration (NOT VALID first, so the table is not scanned
-- under a long lock).
ALTER TABLE admin.audit_log
    ADD CONSTRAINT audit_log_state_check CHECK (state IN ('pending', 'applied', 'failed')) NOT VALID;

-- The trail stays append-only with ONE exception: a 'pending' row may become
-- 'applied' or 'failed' once, by filling state, failure, result and resolved_at.
-- Every column that says who did what, to what and why is immutable, so the
-- exception cannot rewrite history. Deleting and truncating are unchanged.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION admin.audit_log_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.state = 'pending'
           AND NEW.state IN ('applied', 'failed')
           AND NEW.resolved_at IS NOT NULL
           AND NEW.id = OLD.id
           AND NEW.actor_id = OLD.actor_id
           AND NEW.actor_subject = OLD.actor_subject
           AND NEW.actor_issuer = OLD.actor_issuer
           AND NEW.action = OLD.action
           AND NEW.target_kind = OLD.target_kind
           AND NEW.target_id = OLD.target_id
           AND NEW.reason = OLD.reason
           AND NEW.metadata = OLD.metadata
           AND NEW.created_at = OLD.created_at THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'admin.audit_log is append-only: only a pending row may be resolved, and only its outcome may change'
            USING ERRCODE = 'insufficient_privilege';
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.created_at > now() - interval '30 days' THEN
            RAISE EXCEPTION 'admin.audit_log is append-only: rows younger than 30 days cannot be deleted'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'admin.audit_log is append-only: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
-- +goose StatementEnd

-- +goose Down
-- Rows still pending cannot be represented without the columns: resolve or accept
-- losing the outcome of pending entries before rolling back.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION admin.audit_log_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'admin.audit_log is append-only: updates are not allowed'
            USING ERRCODE = 'insufficient_privilege';
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.created_at > now() - interval '30 days' THEN
            RAISE EXCEPTION 'admin.audit_log is append-only: rows younger than 30 days cannot be deleted'
                USING ERRCODE = 'insufficient_privilege';
        END IF;
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'admin.audit_log is append-only: % is not allowed', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
-- +goose StatementEnd

ALTER TABLE admin.audit_log DROP CONSTRAINT audit_log_state_check;
ALTER TABLE admin.audit_log
    DROP COLUMN resolved_at,
    DROP COLUMN result,
    DROP COLUMN failure,
    DROP COLUMN state;
