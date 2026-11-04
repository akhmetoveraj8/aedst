# Taskfile.yml is the only command runner (see ../../CLAUDE.md). This file is a
# shim so `make <target>` keeps working: every target is forwarded to
# `task <target>` in this directory. Do not add real recipes here.
.DEFAULT_GOAL := list

list:
	@task --list

%:
	@task $@

.PHONY: list
