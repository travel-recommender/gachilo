import requests


# =========================================================
# 1. 오사카 좌표
# =========================================================

LATITUDE = 34.6937
LONGITUDE = 135.5023


# =========================================================
# 2. 날씨 코드를 한글로 변환
# =========================================================

def get_weather_description(code):
    if code == 0:
        return "맑음"
    elif code in [1, 2]:
        return "대체로 맑음"
    elif code == 3:
        return "흐림"
    elif code in [45, 48]:
        return "안개"
    elif code in [51, 53, 55, 56, 57]:
        return "이슬비"
    elif code in [61, 63, 65, 66, 67]:
        return "비"
    elif code in [71, 73, 75, 77]:
        return "눈"
    elif code in [80, 81, 82]:
        return "소나기"
    elif code in [85, 86]:
        return "눈 소나기"
    elif code in [95, 96, 99]:
        return "뇌우"
    else:
        return "알 수 없음"


# =========================================================
# 3. Open-Meteo 날씨 API 요청
# =========================================================

url = "https://api.open-meteo.com/v1/forecast"

params = {
    "latitude": LATITUDE,
    "longitude": LONGITUDE,
    "daily": [
        "weather_code",
        "temperature_2m_max",
        "temperature_2m_min",
        "precipitation_probability_max"
    ],
    "timezone": "Asia/Tokyo",
    "forecast_days": 7
}

response = requests.get(url, params=params)

print("날씨 API 상태 코드:", response.status_code)


# =========================================================
# 4. 날씨 결과 출력
# =========================================================

if response.status_code == 200:
    data = response.json()
    daily = data["daily"]

    print("\n오사카 7일 날씨")

    for i in range(len(daily["time"])):

        weather = get_weather_description(
            daily["weather_code"][i]
        )

        print(
            daily["time"][i],
            "| 날씨:", weather,
            "| 최고:", daily["temperature_2m_max"][i], "℃",
            "| 최저:", daily["temperature_2m_min"][i], "℃",
            "| 강수확률:", daily["precipitation_probability_max"][i], "%"
        )

else:
    print("날씨 정보를 불러오지 못했습니다.")