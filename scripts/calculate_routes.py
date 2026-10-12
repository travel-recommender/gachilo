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
        print("Node 24 이상을 설치하거나 NODE_BINARY를 설정하세요.")
        return None
    try:
        points = [{"lng": float(p["longitude"]), "lat": float(p["latitude"])} for p in (start, end)]
        script = Path(__file__).with_name("query_walking_route.mjs")
        result = subprocess.run([node, str(script)], input=json.dumps(points),
                                capture_output=True, text=True, encoding="utf-8", check=True, timeout=10)
        route = json.loads(result.stdout)
    except subprocess.CalledProcessError:
        print("경로 계산을 실행하지 못했습니다. Node 24 이상인지, 장소 좌표가 유효한지 확인하세요.")
        return None
    except subprocess.TimeoutExpired:
        print("경로 계산 시간이 초과됐습니다. Node 실행 환경을 확인하세요.")
        return None
    except OSError:
        print("Node 실행 파일을 열 수 없습니다. NODE_BINARY 경로를 확인하세요.")
        return None
    except (ValueError, TypeError, KeyError):
        print("장소 좌표 또는 경로 응답 형식을 확인하세요.")
        return None
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
            if result is None:
                print("전체 이동 합계 계산을 중단했습니다.")
                return
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
