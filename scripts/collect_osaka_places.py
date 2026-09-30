"""Overpass 원본 JSON을 새 파일로 저장한다. 실패 시 종료 코드 1, 기존 파일은 덮어쓰지 않는다."""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
import requests

OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter"
]
QUERY = """
[out:json][timeout:30];

node["tourism"="attraction"]
(34.60, 135.40, 34.75, 135.60);

out;
"""

def collect(output):
    output = Path(output)
    if output.exists():
        raise FileExistsError(f"기존 파일은 덮어쓰지 않습니다: {output}")
    for url in OVERPASS_URLS:
        try:
            response = requests.post(url, data={"data": QUERY}, timeout=60)
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict) or not isinstance(payload.get("elements"), list):
                raise ValueError("Overpass elements 배열이 없습니다.")
        except (requests.exceptions.RequestException, ValueError):
            continue
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open("xb") as handle:
            handle.write(json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8"))
        return output
    raise RuntimeError("모든 Overpass 서버 요청이 실패했습니다. 파일을 저장하지 않았습니다.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent.parent / "data" / "raw" / f"osaka_{stamp}.json")
    args = parser.parse_args()
    try:
        print(f"원본 저장 완료: {collect(args.output)}")
    except (OSError, RuntimeError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()
