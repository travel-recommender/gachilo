"""Build a reproducible review dataset from existing Osaka CSV sources.

No network access, source mutation, or assumed opening hours/prices.
"""
import argparse
import csv
import hashlib
import json
import math
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

QUOTAS = {"명소": 20, "문화": 25, "자연": 20, "쇼핑": 25, "카페": 25, "식사": 35}
FIELDS = "place_id name name_ko category area address latitude longitude opening_hours cost stay_min bag_load covered website opening_hours_source verified_at".split()


def normalize(value):
    return "".join(unicodedata.normalize("NFKC", value).casefold().split())


def coordinates(row):
    try:
        lat, lon = float(row["latitude"]), float(row["longitude"])
        if math.isfinite(lat) and math.isfinite(lon) and -90 <= lat <= 90 and -180 <= lon <= 180:
            return lat, lon
    except (ValueError, KeyError, TypeError):
        pass
    raise ValueError("invalid coordinates")


def distance(a, b):
    lat1, lon1 = map(math.radians, coordinates(a))
    lat2, lon2 = map(math.radians, coordinates(b))
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 6371000 * 2 * math.asin(min(1, math.sqrt(h)))


def duplicate(a, b):
    # Identical names at different branches remain separate. This is conservative:
    # aliases and facilities nested inside a larger venue still require review.
    return normalize(a["name"]) == normalize(b["name"]) and distance(a, b) <= 75


def read_rows(path):
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        return [{k: (v or "").strip() for k, v in row.items()} for row in reader]


def typed(row):
    result = {key: row.get(key) or None for key in FIELDS}
    for key in ("latitude", "longitude", "cost", "stay_min", "bag_load"):
        if result[key] is not None:
            value = float(result[key])
            if not math.isfinite(value) or (key in ("cost", "stay_min", "bag_load") and value < 0):
                raise ValueError(f"Invalid {key}: {result[key]}")
            result[key] = value
    if result["covered"] is not None:
        if result["covered"].lower() not in ("true", "false"):
            raise ValueError("covered must be true, false, or empty")
        result["covered"] = result["covered"].lower() == "true"
    return result


def build(data_dir, output_dir):
    seed_path = data_dir / "osaka_places_schema.csv"
    candidate_path = data_dir / "osaka_place_candidates.csv"
    seeds, candidates = read_rows(seed_path), read_rows(candidate_path)
    ids = [row["place_id"] for row in seeds]
    if len(ids) != len(set(ids)) or not all(ids):
        raise ValueError("Seed place IDs must be present and unique")
    if any(row["category"] not in QUOTAS or not row["name"] for row in seeds):
        raise ValueError("Invalid seed name/category")
    for row in seeds:
        coordinates(row)
    if any(count > QUOTAS[cat] for cat, count in Counter(r['category'] for r in seeds).items()):
        raise ValueError("Seed count exceeds category quota")
    chosen = list(seeds)
    records = []
    for index, row in enumerate(seeds, 2):
        records.append({"place": typed(row), "review": {
            "status": "existing_not_reverified", "source_file": seed_path.name,
            "source_row": index, "notes": ["기존 값 보존. 이번 작업에서 공식 정보 재검증하지 않음."],
        }})

    rejected = Counter()
    pools = defaultdict(list)
    for index, row in enumerate(candidates, 2):
        try:
            lat, lon = coordinates(row)
        except ValueError:
            rejected["invalid_coordinates"] += 1
            continue
        if not row["name"] or row["category"] not in QUOTAS:
            rejected["invalid_name_or_category"] += 1
            continue
        # Matches the broad central-Osaka scope of the existing collection script.
        if not (34.60 <= lat <= 34.75 and 135.40 <= lon <= 135.60):
            rejected["outside_scope"] += 1
            continue
        pools[row["category"]].append((index, row))

    for category, target in QUOTAS.items():
        # Prefer records with traceable websites, then hours and Korean labels.
        # Cycle through ~1 km coordinate cells to avoid selecting one district only.
        cells = defaultdict(list)
        for index, row in pools[category]:
            lat, lon = coordinates(row)
            cells[(math.floor(lat*100), math.floor(lon*100))].append((index, row))
        def quality(item):
            _, row = item
            return (-bool(row["website"]), -bool(row["opening_hours"]), -bool(row["name_ko"]), normalize(row["name"]), row["latitude"], row["longitude"])
        for bucket in cells.values():
            bucket.sort(key=quality)
        count = sum(row["category"] == category for row in chosen)
        while count < target and cells:
            for cell in sorted(cells, key=lambda c: (quality(cells[c][0]), c)):
                if count >= target:
                    break
                index, row = cells[cell].pop(0)
                if not cells[cell]:
                    del cells[cell]
                if any(duplicate(row, previous) for previous in chosen):
                    rejected["same_name_within_75m"] += 1
                    continue
                key = f"{normalize(row['name'])}|{float(row['latitude']):.7f}|{float(row['longitude']):.7f}"
                prepared = dict(row, place_id="osaka_draft_" + hashlib.sha256(key.encode()).hexdigest()[:12])
                chosen.append(prepared)
                records.append({"place": typed(prepared), "review": {
                    "status": "needs_verification", "source_file": candidate_path.name,
                    "source_row": index, "notes": ["기존 OSM 후보에서 자동 선별. 지점·운영 여부·관광 적합성·영업시간 확인 필요."],
                }})
                count += 1
        if count < target:
            raise ValueError(f"Not enough eligible candidates for {category}: {count}/{target}")

    # Existing source descriptions explicitly reference a branch that must be
    # matched against its coordinate before use; do not silently replace values.
    for record in records:
        row = record["place"]
        record["review"]["missing_fields"] = [key for key, value in row.items() if value is None]
        if row["place_id"] in ("osaka_029", "osaka_030"):
            record["review"]["notes"].append("영업시간 설명의 본점/NAMBA 지점과 좌표가 같은 지점인지 우선 확인.")
        if row["place_id"] == "osaka_006":
            record["review"]["notes"].append("후보 원본의 한국어명·웹사이트와 상점가 이름의 대응 관계 확인.")

    counts = Counter(r["place"]["category"] for r in records)
    missing = {key: sum(r["place"][key] is None for r in records) for key in FIELDS}
    source_hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (seed_path, candidate_path)}
    result = {"dataset_status": "draft_for_review", "schema_version": 1,
              "source_sha256": source_hashes, "category_quotas": QUOTAS,
              "selection_policy": "Preserve seeds; website/hours/name availability; coordinate-cell rotation; same-name duplicates within 75m skipped. Not a popularity ranking.",
              "places": records}
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "osaka_places_week5_draft.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = ["# 5주차 오사카 장소 데이터 점검", "",
             f"기존 후보 {len(candidates):,}개에서 기존 스키마 {len(seeds)}개를 보존하고 총 {len(records)}개 검토용 초안을 구성했다.",
             "신규 장소는 검증 완료가 아니다. 기존 장소도 이번 작업에서 재검증하지 않았다.", "",
             "## 카테고리 구성", "", "| 카테고리 | 장소 수 |", "| --- | ---: |"]
    lines.extend(f"| {cat} | {counts[cat]} |" for cat in QUOTAS)
    lines.extend(["", "## 누락 항목", "", "| 항목 | 누락 수 |", "| --- | ---: |"])
    lines.extend(f"| {key} | {count} |" for key, count in missing.items() if count)
    lines.extend(["", "## 선별 방법과 한계", "",
                  "- 카테고리별 개수는 MVP 테스트용 임시 배분이다. 인기·추천 순위가 아니다.",
                  "- 웹사이트·영업시간·한국어명 보유 여부를 우선하고 좌표 구역을 순회하여 선별했다.",
                  "- 이름이 같고 75m 이내인 장소만 중복 후보로 제외한다. 별칭·건물 내부 시설은 추가 검토가 필요하다.",
                  "- 원래 추출 코드가 이름만으로 중복 제거했으므로 이미 빠진 지점은 이 CSV로 복원할 수 없다.",
                  "- 좌표는 원본을 보존했다. 건물 도형 평균 좌표는 실제 출입구와 다를 수 있다.",
                  "- 한국어명·주소·비용·체류시간·짐·실내 여부의 미확인 값은 null로 유지했다. 원본 영업시간은 문자열이며 자동 일정 판정에 바로 사용할 수 없다.",
                  "- 원본 CSV에는 OSM 객체 ID와 수집일이 없어 파일 해시와 원본 행 번호를 기록했다. 새 수집기에서는 객체 ID·태그·수집일 보존이 필요하다.",
                  "", "## 우선 검토", "",
                  "1. osaka_029, osaka_030: 영업시간의 지점 설명과 좌표 일치 여부 확인.",
                  "2. osaka_006: 이름과 웹사이트의 대응 관계 확인.",
                  "3. 신규 120개: 관광 적합성·운영 여부·지점·공식 링크 확인 후 유지/교체 결정.",
                  "4. 비용·체류시간·짐 지표 기준은 데이터 사전 초안을 바탕으로 팀에서 확정."])
    (output_dir / "week5_data_review.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return {"total": len(records), "categories": dict(counts), "missing": missing, "skipped_during_selection": dict(rejected)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-dir", type=Path, default=Path(__file__).resolve().parents[1] / "data")
    parser.add_argument("--output-dir", type=Path, default=Path(__file__).resolve().parents[1] / "data" / "week5")
    args = parser.parse_args()
    print(json.dumps(build(args.data_dir, args.output_dir), ensure_ascii=False, indent=2))
