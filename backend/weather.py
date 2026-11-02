"""Bounded, cached Osaka forecasts. No keys, member data or stale forecasts are sent/used."""
import json
import math
import os
import ssl
import sys
from pathlib import Path
import threading
import time
from datetime import datetime, timedelta
from urllib.parse import urlencode
from urllib.request import urlopen
from zoneinfo import ZoneInfo

API = 'https://api.open-meteo.com/v1/forecast'
TOKYO = ZoneInfo('Asia/Tokyo')
PARAMS = dict(latitude=34.6937, longitude=135.5023,
              daily='precipitation_probability_max,temperature_2m_max', temperature_unit='celsius',
              timezone='Asia/Tokyo', forecast_days=16)


def open_forecast(url, timeout):
    # Python.org macOS builds can lack their own CA bundle. Use the system trust
    # bundle, preserving TLS verification and explicit SSL_CERT_FILE overrides.
    cafile = None
    if sys.platform == 'darwin' and not os.environ.get('SSL_CERT_FILE') and not ssl.get_default_verify_paths().cafile:
        if Path('/etc/ssl/cert.pem').is_file():
            cafile = '/etc/ssl/cert.pem'
    return urlopen(url, timeout=timeout, context=ssl.create_default_context(cafile=cafile))


class WeatherClient:
    def __init__(self, opener=open_forecast, clock=lambda: datetime.now(TOKYO), monotonic=time.monotonic, timeout=3):
        self.opener, self.clock, self.monotonic = opener, clock, monotonic
        self.lock = threading.Lock()
        self.cached = None
        self.until = 0
        self.cache_day = None
        self.timeout = timeout
        self.flight = None

    def snapshot(self, start, end):
        now = self.clock().astimezone(TOKYO)
        today = now.date()
        first, last = datetime.fromisoformat(start).date(), datetime.fromisoformat(end).date()
        if last < first or (last-first).days >= 30:
            raise ValueError('weather date range must contain 1–30 days')
        dates = [first+timedelta(days=i) for i in range((last-first).days+1)]
        available = any(today <= d <= today+timedelta(days=15) for d in dates)
        data, fetched, status = {}, None, 'outside_forecast_range'
        if os.environ.get('WEATHER_ENABLED', '1') == '0':
            status = 'disabled'
        elif available:
            launch = False
            with self.lock:
                valid = self.cached is not None and self.monotonic() < self.until and self.cache_day == today
                if valid:
                    data, fetched, status = self.cached
                    flight = None
                else:
                    if self.flight is None:
                        self.flight = dict(done=threading.Event(), deadline=time.monotonic()+self.timeout,
                                           result=None, day=today)
                        launch = True
                    flight = self.flight
            if flight is not None:
                # Slow/trickling I/O holds no global lock. At most one worker is
                # alive; all callers share its deadline and never use stale data.
                if launch:
                    threading.Thread(target=self._refresh, args=(now, flight), daemon=True).start()
                flight['done'].wait(max(0, flight['deadline']-time.monotonic()))
                with self.lock:
                    result = flight['result'] if flight['day'] == today else None
                    data, fetched, status = result or ({}, None, 'unavailable')
        rows = []
        for day in dates:
            values = data.get(day.isoformat(), {}) if today <= day <= today+timedelta(days=15) else {}
            probability, temperature = values.get('probability'), values.get('max_temperature_c')
            day_status = ('forecast' if probability is not None or temperature is not None else
                          'outside_forecast_range' if not today <= day <= today+timedelta(days=15) else
                          'missing_weather' if status == 'forecast' else status)
            rows.append(dict(date=day.isoformat(), probability=probability,
                             max_temperature_c=temperature, status=day_status))
        return dict(source='Open-Meteo', source_url=API, timezone='Asia/Tokyo',
                    location='Osaka city forecast grid', fetched_at=fetched, status=status, days=rows)

    def _refresh(self, now, flight):
        try:
            result = self._fetch(now)
        except Exception:
            result = {}, None, 'unavailable'
        with self.lock:
            if time.monotonic() >= flight['deadline']:
                result = {}, None, 'unavailable'
            flight['result'] = result
            self.cached, self.cache_day = result, flight['day']
            self.until = self.monotonic() + (1800 if result[2] == 'forecast' else 60)
            self.flight = None
            flight['done'].set()

    def _fetch(self, now):
        try:
            with self.opener(API+'?'+urlencode(PARAMS), timeout=self.timeout) as response:
                raw = response.read(262145)
            if len(raw) > 262144:
                raise ValueError('oversized forecast')
            data = json.loads(raw)
            if not isinstance(data, dict) or not isinstance(data.get('daily'), dict):
                raise ValueError('invalid forecast object')
            daily = data['daily']
            if data.get('daily_units', {}).get('precipitation_probability_max') != '%':
                raise ValueError('unexpected probability unit')
            dates, values = daily['time'], daily['precipitation_probability_max']
            if data.get('timezone') != 'Asia/Tokyo' or data.get('utc_offset_seconds') != 32400:
                raise ValueError('unexpected forecast timezone')
            if not isinstance(dates, list) or not isinstance(values, list) or len(dates) != len(values) or not 1 <= len(dates) <= 16:
                raise ValueError('invalid forecast shape')
            # Rain and heat are independent. Missing/invalid temperature must not
            # invent a cool day or discard an otherwise valid rain forecast.
            temperatures = daily.get('temperature_2m_max')
            if (data.get('daily_units', {}).get('temperature_2m_max') != '°C'
                    or not isinstance(temperatures, list) or len(temperatures) != len(dates)):
                temperatures = [None] * len(dates)
            result = {}
            for date, value, temperature in zip(dates, values, temperatures):
                parsed = datetime.strptime(date, '%Y-%m-%d').date()
                if parsed.isoformat() != date or date in result:
                    raise ValueError('invalid forecast date')
                result[date] = dict(
                    probability=value/100 if type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 100 else None,
                    max_temperature_c=temperature if type(temperature) in (int, float)
                    and math.isfinite(temperature) and -90 <= temperature <= 60 else None)
            return result, now.isoformat(timespec='seconds'), 'forecast'
        except (OSError, ValueError, KeyError, TypeError, OverflowError):
            # Errors are cached briefly; an expired forecast is never relabelled current.
            return {}, None, 'unavailable'


client = WeatherClient()


def with_weather(snapshot):
    try:
        forecast = client.snapshot(snapshot.get('startDate'), snapshot.get('endDate'))
    except (ValueError, TypeError):
        # Engine/API validation owns invalid trips; weather must not mask that error.
        forecast = dict(source='Open-Meteo', fetched_at=None, status='invalid_dates', days=[])
    return {**snapshot, 'weather': forecast}
