import csv
from pathlib import Path
import json
import os
import shutil
import subprocess


# =========================================================
# 1. 장소 데이터 불러오기
# =========================================================

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CSV_PATH = DATA_DIR / "osaka_places_verified.csv"

places = []

with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)

    for row in reader:
        places.append(row)

print("불러온 장소 개수:", len(places))


# =========================================================
# 2. 장소 이름으로 찾기
# =========================================================

def find_place(name_ko):
    for place in places:
        if place["name_ko"] == name_ko:
            return place

    return None


# =========================================================
# 3. 두 장소 사이 도보 경로 계산
# =========================================================

def calculate_walking_route(start, end):

    node = os.environ.get("NODE_BINARY") or shutil.which("node")
    if not node:
        raise RuntimeError("Node 24 이상을 설치하거나 NODE_BINARY를 설정하세요.")
    points = [{"lng": float(p["longitude"]), "lat": float(p["latitude"])} for p in (start, end)]
    script = Path(__file__).with_name("query_walking_route.mjs")
    result = subprocess.run([node, str(script)], input=json.dumps(points),
                            capture_output=True, text=True, encoding="utf-8", check=True, timeout=10)
    route = json.loads(result.stdout)
    print(f"\n{start['name_ko']} → {end['name_ko']}")
    print(f"도보 거리: {route['km']:.2f} km / 예상 시간: {route['min']}분")
    print(f"계산 출처: {route['source']}" + (f" ({route['fallbackReason']})" if route.get('fallbackReason') else ''))
    return route["km"], route["min"]

# =========================================================
# 4. 테스트
# =========================================================

def main():
    itinerary_names = [
        "오사카성",
        "도톤보리 글리코 사인",
        "구로몬시장",
        "쓰텐카쿠"
    ]

    total_distance = 0
    total_duration = 0

    for i in range(len(itinerary_names) - 1):

        start = find_place(itinerary_names[i])
        end = find_place(itinerary_names[i + 1])

        if start and end:
            result = calculate_walking_route(start, end)

            if result:
                distance, duration = result

                total_distance += distance
                total_duration += duration

        else:
            print("장소를 찾지 못했습니다.")


    print("\n============================")
    print("하루 전체 이동 정보")
    print("============================")
    print(f"총 도보 거리: {total_distance:.2f} km")
    print(f"총 도보 시간: {total_duration:.0f}분")

if __name__ == "__main__":
    main()
