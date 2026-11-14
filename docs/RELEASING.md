# Releasing

Pushing a version tag builds a release: GitHub Actions ([.github/workflows/release.yml](../.github/workflows/release.yml)) packs `manifest.json`, `content.js`, `content.css` and `icons/` into a ZIP and attaches it to a GitHub Release. The tag must match `version` in `manifest.json`, otherwise the build fails.

```bash
# after setting "version": "0.2.0" in manifest.json and committing
git tag v0.2.0
git push origin v0.2.0
```

A new file the extension needs at runtime must also be added to the `zip` command in the workflow. `images/` and `docs/` are not part of the extension and are not zipped.
