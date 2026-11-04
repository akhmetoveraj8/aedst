package application_test

import (
	"context"
	"testing"

	"github.com/aedst/server/internal/modules/search/application"
	"github.com/aedst/server/internal/modules/search/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

type fakeRepo struct {
	hits      []domain.Hit
	got       application.SearchParams
	counted   bool
	suggested string
	limit     int
}

func (f *fakeRepo) Search(_ context.Context, p application.SearchParams) ([]domain.Hit, error) {
	f.got = p
	if len(f.hits) > p.Limit {
		return f.hits[:p.Limit], nil
	}
	return f.hits, nil
}

func (f *fakeRepo) CountMatches(context.Context, application.SearchParams, int) (int, error) {
	f.counted = true
	return 42, nil
}

func (f *fakeRepo) Suggest(_ context.Context, _ ids.ID, prefix string, limit int) ([]string, error) {
	f.suggested, f.limit = prefix, limit
	return []string{"x"}, nil
}

func hits(n int) []domain.Hit {
	out := make([]domain.Hit, n)
	for i := range out {
		out[i] = domain.Hit{EntityID: ids.New(), Score: float64(n - i)}
	}
	return out
}

func TestSearch_PagesWithAKeysetCursorBoundToTheQuery(t *testing.T) {
	repo := &fakeRepo{hits: hits(5)}
	svc := application.NewService(repo)
	owner := ids.New()

	res, err := svc.Search(context.Background(), owner, "  rent  ", nil, 2, "")
	if err != nil {
		t.Fatal(err)
	}
	if repo.got.Query != "rent" || repo.got.Limit != 3 || repo.got.OwnerID != owner {
		t.Errorf("repo saw %+v, want the trimmed query, limit+1 and the caller", repo.got)
	}
	if len(res.Hits) != 2 || res.Next == nil || res.Total != 42 || !repo.counted {
		t.Fatalf("page = %+v", res)
	}
	token := res.Next.Encode()

	repo.counted = false
	if _, err := svc.Search(context.Background(), owner, "rent", nil, 2, token); err != nil {
		t.Fatal(err)
	}
	if repo.got.After == nil || repo.got.After.ID != res.Hits[1].EntityID || repo.counted {
		t.Errorf("second page saw %+v (counted=%v), want the cursor and no count", repo.got.After, repo.counted)
	}
	if _, err := svc.Search(context.Background(), owner, "other", nil, 2, token); sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Errorf("token replayed for another query: err = %v", err)
	}
}

func TestSearch_LastPageAndValidation(t *testing.T) {
	repo := &fakeRepo{hits: hits(2)}
	svc := application.NewService(repo)
	res, err := svc.Search(context.Background(), ids.New(), "x", nil, 0, "")
	if err != nil || res.Next != nil || res.Total != 2 || repo.counted {
		t.Fatalf("res = %+v, %v (a short first page needs no count query)", res, err)
	}
	if repo.got.Limit != domain.DefaultPageSize+1 {
		t.Errorf("default page size not applied: %d", repo.got.Limit)
	}
	if _, err := svc.Search(context.Background(), ids.New(), "   ", nil, 0, ""); sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Errorf("blank query: %v", err)
	}
	if _, err := svc.Search(context.Background(), ids.New(), "x", nil, 0, "garbage"); sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Errorf("garbage token: %v", err)
	}
}

func TestSuggest(t *testing.T) {
	repo := &fakeRepo{}
	svc := application.NewService(repo)
	if _, err := svc.Suggest(context.Background(), ids.New(), " pa ", 500); err != nil {
		t.Fatal(err)
	}
	if repo.suggested != "pa" || repo.limit != domain.MaxSuggest {
		t.Errorf("repo saw %q limit %d", repo.suggested, repo.limit)
	}
	if _, err := svc.Suggest(context.Background(), ids.New(), "", 1); sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Errorf("empty prefix: %v", err)
	}
}
