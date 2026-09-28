import json
import csv
from pathlib import Path


# =========================================================
# 1. 파일 경로 설정
# =========================================================

DATA_FOLDER = Path(__file__).parent.parent / "data"

geojson_files = list(DATA_FOLDER.glob("*.geojson"))

if not geojson_files:
    raise FileNotFoundError("data 폴더에서 GeoJSON 파일을 찾을 수 없습니다.")

geojson_path = geojson_files[0]

print("찾은 GeoJSON 파일:", geojson_path)


# =========================================================
# 2. GeoJSON 파일 읽기
# =========================================================

with open(geojson_path, "r", encoding="utf-8") as file:
    data = json.load(file)

print("GeoJSON 타입:", data["type"])
print("전체 데이터 개수:", len(data["features"]))


# =========================================================
# 3. 장소의 대표 좌표 계산
# =========================================================

def get_representative_coordinates(geometry):
    if not geometry:
        return None

    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")

    if not coordinates:
        return None

    # Point는 원래 좌표 그대로 사용
    if geometry_type == "Point":
        return coordinates[0], coordinates[1]

    # LineString / MultiPolygon 등의 좌표를 모두 모으기
    def collect_points(coords):
        points = []

        if (
            isinstance(coords, list)
            and len(coords) >= 2
            and isinstance(coords[0], (int, float))
            and isinstance(coords[1], (int, float))
        ):
            points.append(coords)

        elif isinstance(coords, list):
            for item in coords:
                points.extend(collect_points(item))

        return points

    points = collect_points(coordinates)

    if not points:
        return None

    # 여러 좌표의 평균값을 대표 위치로 사용
    longitude = sum(point[0] for point in points) / len(points)
    latitude = sum(point[1] for point in points) / len(points)

    return longitude, latitude


# =========================================================
# 4. OSM 태그 → 여행 서비스 카테고리 분류
# =========================================================

def get_category(properties):
    tourism = properties.get("tourism")
    amenity = properties.get("amenity")
    shop = properties.get("shop")
    leisure = properties.get("leisure")
    historic = properties.get("historic")
    brand = properties.get("brand")
    man_made = properties.get("man_made")

    name = properties.get("name", "")
    name_en = properties.get("name:en", "")

    # -------------------------------------------------
    # 제외할 장소
    # -------------------------------------------------

    # 동물원 내부의 개별 동물 제외
    if properties.get("attraction") == "animal":
        return None

    # 편의점 제외
    excluded_convenience_names = [
        "ファミリーマート",
        "FamilyMart",
        "セブン-イレブン",
        "7-Eleven",
        "ローソン",
        "Lawson"
    ]

    if (
        brand in ["FamilyMart", "7-Eleven", "Lawson"]
        or name in excluded_convenience_names
        or name_en in excluded_convenience_names
    ):
        return None

    # -------------------------------------------------
    # 식사
    # -------------------------------------------------

    if amenity == "restaurant":
        return "식사"

    # -------------------------------------------------
    # 카페
    # -------------------------------------------------

    if amenity == "cafe":
        return "카페"

    # -------------------------------------------------
    # 쇼핑
    # -------------------------------------------------

    if shop in ["mall", "department_store"]:
        return "쇼핑"

    # -------------------------------------------------
    # 문화
    # -------------------------------------------------

    # 박물관 / 미술관
    if tourism in ["museum", "gallery"]:
        return "문화"

    # 성
    if historic == "castle":
        return "문화"

    # 신사 / 사찰 / 종교 시설
    if amenity == "place_of_worship":
        return "문화"

    # -------------------------------------------------
    # 자연
    # -------------------------------------------------

    if leisure in ["park", "garden"]:
        return "자연"

    # -------------------------------------------------
    # 명소
    # -------------------------------------------------

    # 관광 명소 / 전망대
    if tourism in ["attraction", "viewpoint"]:
        return "명소"

    # 전망탑 등
    if man_made == "tower":
        return "명소"

    return None


# =========================================================
# 5. 여행 장소 후보 추출
# =========================================================

target_categories = [
    "명소",
    "문화",
    "자연",
    "쇼핑",
    "카페",
    "식사"
]

places_by_category = {
    category: []
    for category in target_categories
}


for feature in data["features"]:
    properties = feature.get("properties", {})
    geometry = feature.get("geometry")

    # 이름 없는 장소 제외
    name = properties.get("name")

    if not name:
        continue

    # 여행 카테고리 판별
    category = get_category(properties)

    if category is None:
        continue

    # 대표 좌표 계산
    coordinates = get_representative_coordinates(geometry)

    if coordinates is None:
        continue

    longitude, latitude = coordinates

    # OSM에 한국어 이름이 있으면 같이 저장
    name_ko = properties.get("name:ko", "")

    # website와 contact:website 둘 다 확인
    website = (
        properties.get("website")
        or properties.get("contact:website")
        or ""
    )

    place = {
        "name": name,
        "name_ko": name_ko,
        "category": category,
        "latitude": latitude,
        "longitude": longitude,
        "opening_hours": properties.get("opening_hours", ""),
        "website": website
    }

    places_by_category[category].append(place)


# =========================================================
# 6. 카테고리별 전체 후보 개수 확인
# =========================================================

print("\n전체 여행 장소 후보:")

for category in target_categories:
    print(category, ":", len(places_by_category[category]))


# =========================================================
# 7. 카테고리별 최대 30곳씩 후보 선택
# =========================================================

selected_places = []

for category in target_categories:
    selected_places.extend(places_by_category[category])

print("\n전체 후보 합계:", len(selected_places))

# =========================================================
# 8. 같은 이름의 장소 중복 제거
# =========================================================

unique_places = []
seen_names = set()

for place in selected_places:
    name = place["name"]

    if name in seen_names:
        continue

    seen_names.add(name)
    unique_places.append(place)


selected_places = unique_places

print("중복 제거 후 장소 개수:", len(selected_places))


# =========================================================
# 9. 카테고리별 선택 결과 확인
# =========================================================

print("\n카테고리별 선택 결과:")

for category in target_categories:
    count = sum(
        1
        for place in selected_places
        if place["category"] == category
    )

    print(category, ":", count)


# =========================================================
# 10. 대표 관광지가 분류되는지 확인
# =========================================================

print("\n대표 관광지 분류 확인:")

check_places = [
    "大阪城",
    "梅田スカイビル",
    "通天閣",
    "大阪天満宮"
]

for target_name in check_places:
    found_categories = set()

    for feature in data["features"]:
        properties = feature.get("properties", {})

        if properties.get("name") != target_name:
            continue

        category = get_category(properties)

        if category is not None:
            found_categories.add(category)

    if found_categories:
        print(target_name, "→", ", ".join(found_categories))
    else:
        print(target_name, "→ 분류되지 않음")


# =========================================================
# 11. 후보 CSV 저장
# =========================================================

csv_path = DATA_FOLDER / "osaka_place_candidates.csv"

fieldnames = [
    "name",
    "name_ko",
    "category",
    "latitude",
    "longitude",
    "opening_hours",
    "website"
]


with open(
    csv_path,
    "w",
    newline="",
    encoding="utf-8-sig"
) as file:

    writer = csv.DictWriter(
        file,
        fieldnames=fieldnames
    )

    writer.writeheader()
    writer.writerows(selected_places)


print("\nCSV 저장 완료!")
print("저장 위치:", csv_path)