-- +goose Up
-- The audit trail is append-only. Updates are refused outright; deleting is only
-- for retention (the retention purge deletes old rows) and refuses anything newer
-- than the 30-day floor, which AEDST_RETENTION_AUDIT_DAYS may not go below
-- (config validation). A handler bug or a compromised credential therefore cannot
-- rewrite or erase recent history; truncation is refused too.
-- +goose StatementBegin
CREATE FUNCTION admin.audit_log_guard() RETURNS trigger
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

CREATE TRIGGER audit_log_guard_rows BEFORE UPDATE OR DELETE ON admin.audit_log
    FOR EACH ROW EXECUTE FUNCTION admin.audit_log_guard();
CREATE TRIGGER audit_log_guard_truncate BEFORE TRUNCATE ON admin.audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION admin.audit_log_guard();

-- +goose Down
DROP TRIGGER audit_log_guard_truncate ON admin.audit_log;
DROP TRIGGER audit_log_guard_rows ON admin.audit_log;
DROP FUNCTION admin.audit_log_guard();
