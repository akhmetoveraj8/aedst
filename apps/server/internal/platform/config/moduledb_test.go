package config

import (
	"reflect"
	"testing"
)

func TestModuleDatabases(t *testing.T) {
	got := moduleDatabases([]string{
		"AEDST_DATABASE_URL=postgres://shared",
		"AEDST_DATABASE_URL_INTEGRITY=postgres://integrity",
		"AEDST_DATABASE_URL_INTEGRITY_JOBS=postgres://integrity-direct",
		"AEDST_DATABASE_URL_APPATTEST=postgres://appattest",
		"AEDST_DATABASE_URL_EMPTY=",
		"AEDST_DATABASE_URL_=postgres://nameless",
		"AEDST_DATABASE_READ_URL=postgres://replica",
	})
	want := map[string]ModuleDatabase{
		"integrity": {DSN: "postgres://integrity", JobsDSN: "postgres://integrity-direct"},
		"appattest": {DSN: "postgres://appattest"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("moduleDatabases = %#v, want %#v", got, want)
	}
}

func TestValidateModuleDatabasesRejectsTypos(t *testing.T) {
	c := Config{DB: DatabaseConfig{Modules: map[string]ModuleDatabase{"integrty": {DSN: "x"}}}}
	if err := c.ValidateModuleDatabases([]string{"integrity", "tasks"}); err == nil {
		t.Fatal("a database override for an unknown module must fail startup")
	}
	c.DB.Modules = map[string]ModuleDatabase{"integrity": {DSN: "x"}}
	if err := c.ValidateModuleDatabases([]string{"integrity", "tasks"}); err != nil {
		t.Fatalf("known module: %v", err)
	}
}
