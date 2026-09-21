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

print("오사카 장소 데이터를 요청합니다...")

for url in OVERPASS_URLS:
    print("현재 서버:", url)

    try:
        response = requests.post(
            url,
            data={"data": QUERY},
            timeout=60
        )

        print("응답 상태:", response.status_code)

        if response.status_code == 200:
            print("데이터 요청 성공!")
            break
        else:
            print("이 서버는 실패했습니다. 다음 서버를 시도합니다.")

    except requests.exceptions.RequestException:
        print("서버 연결에 실패했습니다. 다음 서버를 시도합니다.")