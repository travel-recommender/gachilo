"""Two-request Google Places smoke test. No key or API results are saved.

Run in the terminal holding GOOGLE_PLACES_API_KEY. --run sends at most two
Text Search Enterprise requests (opening hours field), without retries/pages.
"""
import argparse
import json
import os
import urllib.error
import urllib.request

ENDPOINT = 'https://places.googleapis.com/v1/places:searchText'
QUERIES = (
    '丸福珈琲店 千日前本店 大阪市中央区千日前1-9-1',
    'Brooklyn Roasting Company Namba 大阪市浪速区敷津東1-1-21',
)
FIELDS = ','.join('places.' + field for field in (
    'id', 'displayName', 'formattedAddress', 'businessStatus',
    'regularOpeningHours', 'googleMapsUri', 'attributions'))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward the API key to another endpoint.


def run(key, opener=None):
    if not key or not key.strip():
        print('API 키가 없습니다. 키를 설정했던 같은 터미널에서 실행하세요.')
        return 1
    opener = opener or urllib.request.build_opener(NoRedirect())
    print('Google Maps 조회 — 최대 2회 요청, 자동 재시도/파일 저장 없음.')
    print('영업시간 포함 Text Search Enterprise 과금 항목. 무료 범위 초과 시 요금 발생 가능.')
    for query in QUERIES:
        body = {'textQuery': query, 'languageCode':'ko', 'regionCode':'JP', 'pageSize':3}
        request = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(),
            headers={'Content-Type':'application/json', 'X-Goog-Api-Key':key.strip(), 'X-Goog-FieldMask':FIELDS})
        try:
            with opener.open(request, timeout=30) as response:
                data = json.load(response)
        except urllib.error.HTTPError as error:
            hints = {400:'요청 형식 또는 키를 확인하세요.', 401:'키 인증을 확인하세요.',
                     403:'결제 연결, API 사용 설정, 키의 API/IP 제한을 확인하세요.',
                     429:'할당량 초과입니다. 자동 재시도하지 않습니다.'}
            print(f'HTTP {error.code}: ' + hints.get(error.code,'요청 실패. 재시도하지 않고 종료합니다.'))
            return 1  # Do not print headers, raw error bodies or credentials.
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            print('연결 또는 응답 처리 실패. 자동 재시도하지 않고 종료합니다.')
            return 1
        print('\n검색:',query)
        places = data.get('places', [])
        if not places:
            print('검색 결과 없음.'); continue
        for i, place in enumerate(places[:3],1):
            print(f"후보 {i}: {place.get('displayName',{}).get('text','이름 없음')}")
            print('주소:',place.get('formattedAddress','미제공'))
            print('영업 상태:',place.get('businessStatus','미제공'))
            hours = place.get('regularOpeningHours',{}).get('weekdayDescriptions',[])
            print('일반 영업시간:', '\n  '.join(hours) if hours else '미제공 (휴무/24시간으로 추정하지 않음)')
            print('Google Maps:',place.get('googleMapsUri','미제공'))
            print('Place ID:',place.get('id','미제공'))
            for credit in place.get('attributions',[]):
                print('추가 출처:',credit.get('provider',''),credit.get('providerUri',''))
        print('후보 결과입니다. 지점 일치 및 특별 영업시간은 별도 확인하세요.')
    print('\n조회 완료. 기존 장소 데이터는 변경하지 않았습니다.')
    return 0


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true', help='카페 2곳 실제 조회 (최대 2회 유료 대상 요청)')
    args = parser.parse_args()
    if args.run:
        raise SystemExit(run(os.environ.get('GOOGLE_PLACES_API_KEY')))
    print('준비 완료. 같은 터미널에서 --run을 붙이면 카페 2곳만 조회합니다.')
