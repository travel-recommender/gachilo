"""Shared P3 precedence and validation for pool and co-pick readers."""
import json


def saved_longlist(row):
    try:
        if row['ids'] is not None:
            value, source = json.loads(row['ids']), 'p3'
        elif row['payload'] is not None:
            value, source = json.loads(row['payload'])['longlist'], 'submissionFallback'
        else:
            return None, None
        if not (isinstance(value, list) and len(value) <= 30
                and all(isinstance(x, str) and 1 <= len(x) <= 100 for x in value)):
            raise ValueError()
    except (ValueError, TypeError, KeyError):
        raise ValueError('저장된 P3 목록 형식이 잘못되었습니다.') from None
    return list(dict.fromkeys(value)), source
