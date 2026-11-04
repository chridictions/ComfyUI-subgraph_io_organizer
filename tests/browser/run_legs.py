"""Run the Playwright suite against ComfyUI core/frontend pairings.

uv run --no-project tests/browser/run_legs.py [LEG...]

Each leg gets a shallow ComfyUI clone and a uv venv under SIO_E2E_DIR
(default %LOCALAPPDATA%\\subgraph-io-organizer-e2e); both are reused on reruns.
"""

import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
WORK = Path(os.environ.get("SIO_E2E_DIR") or Path(os.environ["LOCALAPPDATA"]) / "subgraph-io-organizer-e2e")
CORE = "https://github.com/Comfy-Org/ComfyUI"

DEFAULT = {"Comfy.VueNodes.Enabled": False, "Comfy.Workflow.NamedValuesRestore": False}
VUE = {**DEFAULT, "Comfy.VueNodes.Enabled": True}
NAMED = {**DEFAULT, "Comfy.Workflow.NamedValuesRestore": True}

# leg: (core ref, frontend, runs, gating)
LEGS = {
    "A": ("88fec4b605a576bb74a679ccd9a4001807be96d5", "1.48.6", {"canvas": DEFAULT}, True),
    "B": ("v0.31.0", "1.48.7", {"canvas": DEFAULT}, True),
    "C": ("v0.34.0", "1.49.6", {"canvas": DEFAULT}, True),
    "D": ("v0.38.0", "1.53.6", {"canvas": DEFAULT}, True),
    "E": ("v0.43.0", "1.57.4", {"canvas": DEFAULT, "vue": VUE}, True),
    "F": ("master", "1.58.5", {"canvas": DEFAULT}, True),
    "G": ("master", "1.60.0", {"canvas": DEFAULT, "vue": VUE, "named": NAMED}, False),
}
# 1.49.6 is on PyPI but has no GitHub release, so it is served from v0.34.0's own pip pin.
PIP_ONLY = {"1.49.6"}


def run(cmd, cwd=None, **kw):
    print(">", " ".join(str(c) for c in cmd), flush=True)
    return subprocess.run(cmd, cwd=cwd, check=True, **kw)


def clone(ref, dest):
    if (dest / "main.py").exists():
        return
    dest.mkdir(parents=True, exist_ok=True)
    run(["git", "init", "-q"], dest)
    run(["git", "fetch", "-q", "--depth", "1", CORE, ref], dest)
    run(["git", "checkout", "-q", "FETCH_HEAD"], dest)


def venv(dest):
    py = dest / ".venv" / "Scripts" / "python.exe"
    if py.exists():
        return py
    run(["uv", "venv", "-q", "--python", "3.12", ".venv"], dest)
    env = {**os.environ, "VIRTUAL_ENV": str(dest / ".venv")}
    run(["uv", "pip", "install", "-q", "torch", "torchvision", "torchaudio", "--index-url", "https://download.pytorch.org/whl/cpu"], dest, env=env)
    run(["uv", "pip", "install", "-q", "-r", "requirements.txt"], dest, env=env)
    return py


def install_organizer(dest):
    target = dest / "custom_nodes" / "subgraph_io_organizer"
    shutil.rmtree(target, ignore_errors=True)
    shutil.copytree(REPO / "js", target / "js")
    for name in ("__init__.py", "organizer.py"):
        shutil.copy2(REPO / name, target / name)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def start(py, dest, port, frontend, log):
    cmd = [py, "main.py", "--cpu", "--listen", "127.0.0.1", "--port", str(port)]
    if frontend not in PIP_ONLY:
        cmd += ["--front-end-version", f"Comfy-Org/ComfyUI_frontend@{frontend}"]
    proc = subprocess.Popen(cmd, cwd=dest, stdout=log, stderr=subprocess.STDOUT)
    for _ in range(600):
        if proc.poll() is not None:
            raise RuntimeError(f"server exited with {proc.returncode}, see {log.name}")
        if reachable(port):
            return proc
        time.sleep(1)
    proc.kill()
    raise RuntimeError(f"server did not start, see {log.name}")


def reachable(port):
    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/system_stats", timeout=2)
        return True
    except OSError:
        return False


def set_settings(port, settings):
    for key, value in settings.items():
        req = urllib.request.Request(f"http://127.0.0.1:{port}/settings/{key}", data=json.dumps(value).encode(), method="POST")
        urllib.request.urlopen(req, timeout=10)


def playwright(port, frontend, report):
    env = {**os.environ, "COMFY_URL": f"http://127.0.0.1:{port}", "EXPECT_FRONTEND": frontend, "PLAYWRIGHT_JSON_OUTPUT_NAME": str(report)}
    subprocess.run(["npx.cmd", "playwright", "test", "--reporter=list,json"], cwd=HERE, env=env)


def collect(suite, out):
    for spec in suite.get("specs", []):
        for t in spec["tests"]:
            out[spec["title"]] = (t["status"], t["annotations"])
    for child in suite.get("suites", []):
        collect(child, out)
    return out


def summarize(report):
    if not report.exists():
        return {}
    data = json.loads(report.read_text(encoding="utf-8"))
    out = {}
    for suite in data["suites"]:
        collect(suite, out)
    return out


def served(results):
    for status, notes in results.values():
        for note in notes:
            if note["type"] == "frontend":
                return note["description"]
    return "?"


def run_leg(name):
    ref, frontend, runs, gating = LEGS[name]
    dest = WORK / name
    clone(ref, dest)
    py = venv(dest)
    install_organizer(dest)
    rows = []
    for label, settings in runs.items():
        t0 = time.time()
        port = free_port()
        log = open(WORK / f"{name}-{label}.log", "w", encoding="utf-8")
        proc = start(py, dest, port, frontend, log)
        try:
            set_settings(port, settings)
            report = WORK / f"{name}-{label}.json"
            report.unlink(missing_ok=True)
            playwright(port, frontend, report)
        finally:
            proc.kill()
            proc.wait()
            log.close()
        results = summarize(report)
        rows.append((name, ref[:10], served(results), label, results, round(time.time() - t0), gating))
    return rows


def main():
    if not (HERE / "node_modules").exists():
        run(["npm.cmd", "ci"], HERE)
    WORK.mkdir(parents=True, exist_ok=True)
    rows = []
    for name in sys.argv[1:] or LEGS:
        try:
            rows += run_leg(name)
        except (subprocess.CalledProcessError, RuntimeError) as e:
            rows.append((name, LEGS[name][0][:10], "?", "setup", {"setup": ("failed", [])}, 0, LEGS[name][3]))
            print(f"Leg {name} setup failed: {e}", flush=True)
    failed = False
    print("\nleg  core        served                      run     secs  results")
    for name, ref, fe, label, results, secs, gating in rows:
        bad = [t for t, (s, _) in results.items() if s not in ("expected", "skipped")]
        failed = failed or (gating and (bad or not results))
        line = f"{len(results) - len(bad)}/{len(results)} passed" + (f"; failed: {', '.join(bad)}" if bad else "")
        print(f"{name:4} {ref:11} {fe:27} {label:7} {secs:5} {line}")
    print("\nFAILED" if failed else "\nPASSED")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
