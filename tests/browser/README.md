# Browser tests

Playwright tests that drive the organizer in a real ComfyUI, on seven core/frontend pairings (legs A-G, listed in `run_legs.py`). Windows, local only.

Needs Node, uv, git and Microsoft Edge. From the repo root:

```
uv run --no-project tests/browser/run_legs.py        # all legs
uv run --no-project tests/browser/run_legs.py A G    # some legs
```

The first run installs `@playwright/test` (`npm ci`), then for each leg makes a shallow ComfyUI clone and a Python 3.12 venv with CPU torch under `%LOCALAPPDATA%\subgraph-io-organizer-e2e` (override with `SIO_E2E_DIR`; delete the folder to start over). Reruns reuse them. The organizer's runtime files are copied into each clone's `custom_nodes`.

Each run starts `main.py --cpu` on a free port with `--front-end-version` (1.49.6 has no GitHub release, so leg C uses v0.34.0's pip pin), sets the run's settings over the settings API (Vue renderer, `Comfy.Workflow.NamedValuesRestore`), runs `organizer.spec.js`, then stops the server. Server logs and JSON reports land in the work dir. The final table prints each test's status; the run fails if any gating leg (all but G) fails.

To run the spec against a server you started yourself:

```
cd tests/browser
set COMFY_URL=http://127.0.0.1:8190
npx playwright test
```

`fixtures/shared.json` was built with the frontend's own API on leg A (frontend 1.48.6) by `node make_fixture.js http://127.0.0.1:<port>`.
