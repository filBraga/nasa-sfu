"""Sync the large, gitignored data folders with a Supabase Storage bucket.

    python scripts/data_sync.py push   # upload data/raw, data/layers, data/external
    python scripts/data_sync.py pull   # download whatever is missing locally

Needs SUPABASE_URL and SUPABASE_SECRET_KEY in .env (see .env.example).
Files whose size already matches the other side are skipped, so both commands
can be re-run safely.
"""
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
FOLDERS = ["raw", "layers", "external"]
BUCKET = "data"
# ponytail: Supabase free plan caps a file at 50 MB. The one bigger file (the Moon NAC DEM)
# is re-downloaded by analog/sources.py anyway, so it is skipped. Raise this on a paid plan.
MAX_BYTES = 50 * 1024 * 1024


def load_env():
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"'))
    try:
        return os.environ["SUPABASE_URL"].rstrip("/"), os.environ["SUPABASE_SECRET_KEY"]
    except KeyError as missing:
        sys.exit(f"{missing} is not set. Copy .env.example to .env and fill it in.")


def remote_files(s, url, prefix=""):
    """Return {path: size} for every object under prefix, walking sub-folders."""
    out, offset = {}, 0
    while True:
        r = s.post(f"{url}/storage/v1/object/list/{BUCKET}",
                   json={"prefix": prefix, "limit": 1000, "offset": offset})
        r.raise_for_status()
        items = r.json()
        for item in items:
            path = f"{prefix}{item['name']}"
            if item.get("id") is None:  # a folder
                out.update(remote_files(s, url, path + "/"))
            else:
                out[path] = item["metadata"]["size"]
        if len(items) < 1000:
            return out
        offset += 1000


def push(s, url):
    r = s.post(f"{url}/storage/v1/bucket", json={"id": BUCKET, "name": BUCKET, "public": False})
    if r.status_code not in (200, 400, 409):  # 400/409: bucket already exists
        r.raise_for_status()
    remote = {}
    for folder in FOLDERS:
        remote.update(remote_files(s, url, folder + "/"))
    for folder in FOLDERS:
        for path in sorted((DATA / folder).rglob("*")):
            if not path.is_file() or path.name == ".DS_Store":
                continue
            key = path.relative_to(DATA).as_posix()
            size = path.stat().st_size
            if size > MAX_BYTES:
                print(f"skip (too big for bucket) {key}")
            elif remote.get(key) == size:
                continue
            else:
                print(f"upload {key} ({size / 1e6:.1f} MB)")
                with path.open("rb") as f:
                    r = s.post(f"{url}/storage/v1/object/{BUCKET}/{key}", data=f,
                               headers={"x-upsert": "true", "content-type": "application/octet-stream"})
                r.raise_for_status()


def pull(s, url):
    for folder in FOLDERS:
        for key, size in sorted(remote_files(s, url, folder + "/").items()):
            dest = DATA / key
            if dest.exists() and dest.stat().st_size == size:
                continue
            print(f"download {key} ({size / 1e6:.1f} MB)")
            dest.parent.mkdir(parents=True, exist_ok=True)
            r = s.get(f"{url}/storage/v1/object/{BUCKET}/{key}", stream=True)
            r.raise_for_status()
            tmp = dest.with_suffix(dest.suffix + ".part")  # no half-written files on failure
            with tmp.open("wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
            tmp.replace(dest)


def run(command):
    url, key = load_env()
    s = requests.Session()
    s.headers.update({"apikey": key, "Authorization": f"Bearer {key}"})
    (push if command == "push" else pull)(s, url)


def pull_if_configured():
    """Called by the pipeline on start: fetch missing data from Supabase when .env is set up."""
    if (ROOT / ".env").exists() or "SUPABASE_URL" in os.environ:
        run("pull")


if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in ("push", "pull"):
        sys.exit(__doc__)
    run(sys.argv[1])
    print("done")
