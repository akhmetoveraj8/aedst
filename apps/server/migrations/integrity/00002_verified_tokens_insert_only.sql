-- +goose Up
-- A verified-token row is replay evidence: it may be inserted and, by retention,
-- deleted once the token is too old to verify anyway, but never changed (changing
-- verified_at would re-open the freshness window of a spent token).
-- +goose StatementBegin
CREATE FUNCTION integrity.verified_tokens_no_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'integrity.verified_tokens is insert-only: updates are not allowed'
        USING ERRCODE = 'insufficient_privilege';
END;
$$;
-- +goose StatementEnd

CREATE TRIGGER verified_tokens_no_update BEFORE UPDATE ON integrity.verified_tokens
    FOR EACH ROW EXECUTE FUNCTION integrity.verified_tokens_no_update();

-- +goose Down
DROP TRIGGER verified_tokens_no_update ON integrity.verified_tokens;
DROP FUNCTION integrity.verified_tokens_no_update();
