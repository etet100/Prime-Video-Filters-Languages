# Releasing

The version is a single number (1, 2, 3...), in `manifest.json` and in the tag (`v1`, `v2`...). Chrome accepts a one-number version and treats `1` as newer than the earlier `0.2.0`.

Pushing a version tag builds a release: GitHub Actions ([.github/workflows/release.yml](../.github/workflows/release.yml)) packs `manifest.json`, `content.js`, `content.css` and `icons/` into a ZIP and attaches it to a GitHub Release. The tag must match `version` in `manifest.json`, otherwise the build fails.

The [Makefile](../Makefile) has two targets for this (`make` alone lists them):

```bash
make bump-version    # raises "version" in manifest.json by one (does not commit)
git commit -am "..." # commit the change yourself
make create-release  # tags the current commit as v<version> and pushes only that tag
```

`create-release` stops if the working tree is not clean or the tag already exists. It does not push the branch. The same by hand:

```bash
git tag v2
git push origin v2
```

A new file the extension needs at runtime must also be added to the `zip` command in the workflow. `images/` and `docs/` are not part of the extension and are not zipped.
