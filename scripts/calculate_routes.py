import csv
from pathlib import Path
import requests


# =========================================================
# 1. 장소 데이터 불러오기
# =========================================================

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CSV_PATH = DATA_DIR / "osaka_places.csv"

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

    start_lon = start["longitude"]
    start_lat = start["latitude"]

    end_lon = end["longitude"]
    end_lat = end["latitude"]

    url = (
        "https://routing.openstreetmap.de/routed-foot/route/v1/driving/"
        f"{start_lon},{start_lat};"
        f"{end_lon},{end_lat}"
        "?overview=false"
    )

    response = requests.get(url)

    if response.status_code != 200:
        print("경로를 불러오지 못했습니다.")
        return

    data = response.json()
    route = data["routes"][0]

    distance_km = route["distance"] / 1000
    duration_min = route["duration"] / 60

    print()
    print(f"{start['name_ko']} → {end['name_ko']}")
    print(f"도보 거리: {distance_km:.2f} km")
    print(f"예상 시간: {duration_min:.0f}분")
    return distance_km, duration_min

# =========================================================
# 4. 테스트
# =========================================================

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