"""Show the same forecast snapshot used by the service, without calling the API on import."""
import argparse
import json
import sys
from pathlib import Path
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from weather import client


def main():
    parser = argparse.ArgumentParser()
    today = datetime.now(ZoneInfo('Asia/Tokyo')).date()
    parser.add_argument('--start', default=today.isoformat())
    parser.add_argument('--end', default=(today+timedelta(days=6)).isoformat())
    args = parser.parse_args()
    print(json.dumps(client.snapshot(args.start, args.end), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
