import csv
import re
import requests
from pathlib import Path


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
# 2. 짐 증가 점수 계산
# =========================================================

LIGHT_SHOPPING_PLACES = [
    "구로몬시장",
    "신사이바시스지 상점가",
    "아메리카무라",
    "신세카이"
]


def get_luggage_score(place):

    # 백화점, 쇼핑몰
    if place["category"] == "쇼핑":
        return 2

    # 시장, 상점가 등
    if place["name_ko"] in LIGHT_SHOPPING_PLACES:
        return 1

    return 0

# =========================================================
# 영업 시작시간 계산
# =========================================================

def get_opening_time(place):

    opening_hours = place["opening_hours"]

    # 24시간 또는 상시 이용 장소
    if (
        "상시" in opening_hours
        or "24시간" in opening_hours
    ):
        return 0

    # 점포별로 시간이 다른 장소는
    # MVP에서는 시간 제한을 두지 않음
    if "점포별 상이" in opening_hours:
        return 0

    # 09:00-18:00 같은 시간 범위 찾기
    time_ranges = re.findall(
        r"(\d{1,2}:\d{2})-(\d{1,2}:\d{2})",
        opening_hours
    )

    if not time_ranges:
        return 0

    opening_times = []

    for start_time, end_time in time_ranges:

        hour, minute = map(
            int,
            start_time.split(":")
        )

        opening_minutes = hour * 60 + minute

        opening_times.append(opening_minutes)

    # 여러 시간이 있으면 가장 이른 시작시간 사용
    return min(opening_times)
# =========================================================
# 3. 영업 종료시간 계산
# =========================================================

def get_closing_time(place):

    opening_hours = place["opening_hours"]

    # 상시 접근 장소
    if (
        "상시" in opening_hours
        or "점포별 상이" in opening_hours
        or "24시간" in opening_hours
    ):
        return 24 * 60

    # 09:00-18:00 형식 찾기
    time_ranges = re.findall(
        r"(\d{1,2}:\d{2})-(\d{1,2}:\d{2})",
        opening_hours
    )

    if not time_ranges:
        return 24 * 60

    closing_times = []

    for start_time, end_time in time_ranges:

        hour, minute = map(
            int,
            end_time.split(":")
        )

        closing_minutes = hour * 60 + minute

        closing_times.append(closing_minutes)

    # 여러 종료시간이 있으면 보수적으로 가장 빠른 시간 사용
    return min(closing_times)


# =========================================================
# 4. 장소 이름으로 찾기
# =========================================================

def find_place(name_ko):

    for place in places:

        if place["name_ko"] == name_ko:
            return place

    return None


# =========================================================
# 5. 두 장소 사이 도보 이동시간
# =========================================================

def get_walking_minutes(start, end):

    url = (
        "https://routing.openstreetmap.de/routed-foot/route/v1/driving/"
        f"{start['longitude']},{start['latitude']};"
        f"{end['longitude']},{end['latitude']}"
        "?overview=false"
    )

    try:

        response = requests.get(
            url,
            timeout=10
        )

        if response.status_code != 200:
            return None

        data = response.json()

        duration_seconds = (
            data["routes"][0]["duration"]
        )

        return duration_seconds / 60

    except requests.RequestException:

        return None


# =========================================================
# 6. 사용자가 선택했다고 가정할 장소
# =========================================================

SELECTED_PLACE_NAMES = [
    "오사카성",
    "오사카 역사박물관",
    "도톤보리 글리코 사인",
    "신사이바시 PARCO",
    "다이마루 신사이바시점"
]


selected_places = []

for name in SELECTED_PLACE_NAMES:

    place = find_place(name)

    if place:
        selected_places.append(place)


print("선택된 장소 개수:", len(selected_places))


# =========================================================
# 7. 첫 장소 선택
# =========================================================

# 쇼핑이 아닌 장소부터 시작
non_shopping_places = [
    place
    for place in selected_places
    if get_luggage_score(place) == 0
]

# 쇼핑이 아닌 장소 중 가장 빨리 닫는 장소
current_place = min(
    non_shopping_places,
    key=get_closing_time
)

itinerary = [current_place]

remaining_places = [
    place
    for place in selected_places
    if place != current_place
]


# 오전 10시 시작
current_time = 10 * 60

# 한 장소에서 머무는 시간: 60분
VISIT_TIME = 60

# 첫 장소 관람
current_time += VISIT_TIME

# 현재 짐
current_luggage = get_luggage_score(
    current_place
)


# =========================================================
# 8. 다음 장소 추천
# =========================================================

while remaining_places:

    candidates = []

    for candidate in remaining_places:

        travel_time = get_walking_minutes(
            current_place,
            candidate
        )

        if travel_time is None:
            continue

        arrival_time = (
                current_time
                + travel_time
        )

        opening_time = get_opening_time(
            candidate
        )

        # 너무 일찍 도착하면 문 열 때까지 기다림
        if arrival_time < opening_time:
            arrival_time = opening_time

        finish_time = (
                arrival_time
                + VISIT_TIME
        )

        closing_time = get_closing_time(
            candidate
        )

        # 관람이 끝나기 전에 문을 닫으면 제외
        if finish_time > closing_time:
            continue

        # 폐점까지 남은 여유시간
        slack_time = (
            closing_time
            - finish_time
        )

        candidates.append(
            {
                "place": candidate,
                "travel_time": travel_time,
                "slack_time": slack_time,
                "luggage_score": get_luggage_score(
                    candidate
                )
            }
        )


    if not candidates:

        print(
            "\n더 이상 영업시간 안에 "
            "방문 가능한 장소가 없습니다."
        )

        break


    # =====================================================
    # 8-1. 곧 문을 닫는 장소 확인
    # =====================================================

    urgent_places = [
        item
        for item in candidates
        if item["slack_time"] <= 90
    ]


    if urgent_places:

        # 폐점까지 시간이 가장 적은 장소
        best = min(
            urgent_places,
            key=lambda x: (
                x["slack_time"],
                x["travel_time"]
            )
        )

    else:

        # =================================================
        # 8-2. 아직 급하지 않다면
        #      쇼핑 아닌 장소 먼저
        # =================================================

        non_shopping_candidates = [
            item
            for item in candidates
            if item["luggage_score"] == 0
        ]


        if non_shopping_candidates:

            # 비쇼핑 장소 중 가까운 곳
            best = min(
                non_shopping_candidates,
                key=lambda x: (
                    x["travel_time"],
                    x["slack_time"]
                )
            )

        else:

            # =================================================
            # 8-3. 비쇼핑 장소를 모두 갔다면 쇼핑 장소
            # =================================================

            best = min(
                candidates,
                key=lambda x: (
                    x["travel_time"],
                    x["slack_time"]
                )
            )


    best_place = best["place"]
    best_travel_time = best["travel_time"]

    # 이동
    current_time += best_travel_time

    # 관람
    current_time += VISIT_TIME

    # 짐 누적
    current_luggage += get_luggage_score(
        best_place
    )

    itinerary.append(best_place)

    remaining_places.remove(
        best_place
    )

    current_place = best_place


# =========================================================
# 9. 추천 일정 시간표 출력
# =========================================================

def format_time(minutes):
    hour = int(minutes // 60)
    minute = int(minutes % 60)

    return f"{hour:02d}:{minute:02d}"


print("\n==============================================")
print("추천 여행 일정")
print("==============================================")

# 여행 시작시간
schedule_time = 10 * 60

# 누적 짐
luggage = 0

previous_place = None


for index, place in enumerate(itinerary, start=1):

    # -----------------------------------------------------
    # 이동시간 계산
    # -----------------------------------------------------

    if previous_place is None:
        travel_time = 0
    else:
        travel_time = get_walking_minutes(
            previous_place,
            place
        )

        if travel_time is None:
            travel_time = 0

        schedule_time += travel_time


    # -----------------------------------------------------
    # 영업 시작시간 확인
    # -----------------------------------------------------

    opening_time = get_opening_time(place)

    waiting_time = 0

    # 너무 일찍 도착했다면 오픈할 때까지 대기
    if schedule_time < opening_time:

        waiting_time = (
            opening_time
            - schedule_time
        )

        schedule_time = opening_time


    visit_start = schedule_time

    # 한 장소에서 60분 체류
    visit_end = (
        visit_start
        + VISIT_TIME
    )

    schedule_time = visit_end


    # -----------------------------------------------------
    # 짐 증가
    # -----------------------------------------------------

    increase = get_luggage_score(place)

    luggage += increase


    # -----------------------------------------------------
    # 추천 이유
    # -----------------------------------------------------

    if index == 1:

        reason = "영업 종료가 빠른 장소를 먼저 방문"

    elif increase == 0:

        reason = "쇼핑 전에 방문하여 짐 부담 최소화"

    else:

        reason = "쇼핑 장소를 일정 후반에 배치"


    # -----------------------------------------------------
    # 출력
    # -----------------------------------------------------

    print()
    print(f"{index}. {place['name_ko']}")

    if travel_time > 0:
        print(
            f"   이동: 도보 약 {travel_time:.0f}분"
        )

    if waiting_time > 0:
        print(
            f"   오픈 대기: 약 {waiting_time:.0f}분"
        )

    print(
        f"   방문: "
        f"{format_time(visit_start)}"
        f" ~ "
        f"{format_time(visit_end)}"
    )

    print(
        f"   짐: +{increase}"
        f" / 누적 {luggage}"
    )

    print(
        f"   추천 이유: {reason}"
    )

    previous_place = place
