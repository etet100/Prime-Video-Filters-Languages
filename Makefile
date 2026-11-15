# Release helpers. The version is a single number (1, 2, 3...), see docs/RELEASING.md.

VERSION := $(shell sed -nE 's/^ *"version": "([0-9]+)",?$$/\1/p' manifest.json)

.PHONY: help bump-version create-release check-version

# Default target: lists the targets.
help:
	@echo "make bump-version    raise the version in manifest.json by one (does not commit)"
	@echo "make create-release  tag the current commit as v<version> and push only the tag"
	@echo "Current version: $(VERSION)"

check-version:
	@test -n "$(VERSION)" || { echo "No single-number \"version\" found in manifest.json"; exit 1; }

# Raises the version in manifest.json by one. Does not commit.
bump-version: check-version
	@next=$$(($(VERSION) + 1)); \
	sed -i -E "s/^( *\"version\": )\"$(VERSION)\"/\1\"$$next\"/" manifest.json; \
	echo "manifest.json version: $(VERSION) -> $$next"

# Tags the current commit as v<version> and pushes only the tag,
# which starts the GitHub Actions release workflow.
create-release: check-version
	@test -z "$$(git status --porcelain)" || { echo "Working tree is not clean, commit your changes first"; exit 1; }
	@! git rev-parse -q --verify "refs/tags/v$(VERSION)" >/dev/null || { echo "Tag v$(VERSION) already exists"; exit 1; }
	git tag v$(VERSION)
	git push origin v$(VERSION)
