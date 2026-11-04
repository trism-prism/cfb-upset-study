"""CollegeFootballData REST client with exponential-backoff retry and a disk cache."""
import json
import os
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

BASE_URL = "https://api.collegefootballdata.com"
ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
MAX_TRIES = 5
TIMEOUT_SECONDS = 60


def cache_path(endpoint, params):
    name = endpoint.strip("/").replace("/", "-")
    parts = "_".join(f"{key}-{params[key]}" for key in sorted(params))
    return RAW_DIR / f"{name}_{parts}.json"


def get(endpoint, **params):
    """GET endpoint with params; returns parsed JSON. Cached on disk, so reruns need no key."""
    path = cache_path(endpoint, params)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))

    load_dotenv()
    key = os.environ.get("CFBD_API_KEY", "").strip()
    if not key or key == "your_key_here":
        raise RuntimeError(
            "CFBD_API_KEY is not set. Copy .env.example to .env and put your "
            "CollegeFootballData key in it (https://collegefootballdata.com/key)."
        )
    headers = {"Authorization": f"Bearer {key}"}

    for attempt in range(MAX_TRIES):
        last_try = attempt == MAX_TRIES - 1
        try:
            resp = requests.get(BASE_URL + endpoint, params=params, headers=headers, timeout=TIMEOUT_SECONDS)
        except requests.RequestException:
            if last_try:
                raise
            time.sleep(2 ** attempt)
            continue
        retryable = resp.status_code == 429 or resp.status_code >= 500
        if retryable and not last_try:
            delay = 2 ** attempt
            retry_after = resp.headers.get("Retry-After") if resp.status_code == 429 else None
            if retry_after:
                try:
                    delay = max(delay, float(retry_after))
                except ValueError:
                    pass  # HTTP-date form: keep the backoff delay
            time.sleep(delay)
            continue
        resp.raise_for_status()
        data = resp.json()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")
        return data
    raise RuntimeError("unreachable")
