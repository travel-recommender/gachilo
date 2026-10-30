import io
import json
import os
import unittest
from datetime import datetime, timedelta
from unittest.mock import patch
from weather import WeatherClient, TOKYO, with_weather

TODAY = datetime(2026,10,30,9,tzinfo=TOKYO)
def body(values=(100,0,None)):
    return dict(timezone='Asia/Tokyo',utc_offset_seconds=32400,
        daily_units={'precipitation_probability_max':'%'},daily=dict(
        time=[(TODAY+timedelta(days=i)).date().isoformat() for i in range(len(values))],
        precipitation_probability_max=list(values)))

class WeatherTests(unittest.TestCase):
    def setUp(self):
        env=patch.dict(os.environ,{'WEATHER_ENABLED':'1'});env.start();self.addCleanup(env.stop)
        self.now=TODAY;self.seconds=0;self.calls=[];self.payload=body()
        def open_(url,timeout):
            self.calls.append((url,timeout))
            if isinstance(self.payload,Exception):raise self.payload
            return io.BytesIO(json.dumps(self.payload).encode())
        self.client=WeatherClient(open_,lambda:self.now,lambda:self.seconds)
    def get(self,start='2026-10-30',end='2026-11-01'):return self.client.snapshot(start,end)
    def test_zero_missing_and_percent_conversion_are_distinct(self):
        r=self.get();self.assertEqual([d['probability'] for d in r['days']],[1,0,None])
        self.assertEqual(r['days'][2]['status'],'missing_weather')
        self.assertEqual(self.calls[0][1],3);self.assertIn('forecast_days=16',self.calls[0][0])
    def test_horizon_and_disabled_make_no_requests(self):
        for a,b in [('2026-10-01','2026-10-02'),('2026-11-15','2026-11-16')]:
            self.assertEqual(self.get(a,b)['status'],'outside_forecast_range')
        with patch.dict(os.environ,{'WEATHER_ENABLED':'0'}):self.assertEqual(self.get()['status'],'disabled')
        self.assertFalse(self.calls)
    def test_partial_horizon_preserves_unknown_dates(self):
        r=self.get('2026-10-29','2026-10-31');self.assertEqual([d['probability'] for d in r['days']],[None,1,0])
    def test_invalid_units_shape_timezone_dates_fail_closed(self):
        cases=[None,[],{},dict(body(),timezone='UTC'),dict(body(),daily_units={}),dict(body(),daily=None)]
        broken=body();broken['daily']['time'][1]='2026-10-30';cases.append(broken)
        broken=body();broken['daily']['time'].pop();cases.append(broken)
        for value in cases:
            self.payload=value;self.client.until=0
            with self.subTest(value=value):self.assertEqual(self.get()['status'],'unavailable')
    def test_invalid_probability_is_unknown_not_zero(self):
        self.payload=body((-1,101,True,float('nan'),'50'))
        self.assertTrue(all(d['probability'] is None for d in self.get(end='2026-11-03')['days']))
    def test_cached_forecast_expires_and_never_relabels_stale(self):
        self.get();self.get();self.assertEqual(len(self.calls),1)
        self.seconds=1801;self.payload=TimeoutError();r=self.get()
        self.assertEqual(r['status'],'unavailable');self.assertIsNone(r['fetched_at'])
        self.get();self.assertEqual(len(self.calls),2)
        self.seconds+=61;self.payload=body();self.assertEqual(self.get()['status'],'forecast')
    def test_new_japan_day_invalidates_cache(self):
        self.get();self.now+=timedelta(days=1);self.get();self.assertEqual(len(self.calls),2)
    def test_server_overwrites_untrusted_forecast_input_without_mutating_snapshot(self):
        snapshot=dict(startDate='2026-10-30',endDate='2026-11-01',weather={'fake':True})
        with patch('weather.client',self.client):r=with_weather(snapshot)
        self.assertEqual(r['weather']['source'],'Open-Meteo');self.assertEqual(snapshot['weather'],{'fake':True})
    def test_response_size_bound(self):
        self.payload={'padding':'a'*262145};self.assertEqual(self.get()['status'],'unavailable')
    def test_range_validation(self):
        for end in ['2026-10-29','2026-11-30']:
            with self.assertRaises(ValueError):self.get(end=end)

    def test_heat_forecast_is_independent_of_rain_and_never_assumes_missing_means_cool(self):
        self.payload=body((0,None,0))
        self.payload['daily']['temperature_2m_max']=[35,38,None]
        self.payload['daily_units']['temperature_2m_max']='°C'
        r=self.get()
        self.assertEqual([d['max_temperature_c'] for d in r['days']],[35,38,None])
        self.assertEqual(r['days'][1]['status'],'forecast')
        self.assertIsNone(r['days'][1]['probability'])
        self.assertIn('temperature_2m_max',self.calls[0][0])
        self.assertIn('temperature_unit=celsius',self.calls[0][0])
    def test_invalid_temperature_unit_values_or_shape_do_not_create_heat_forecast(self):
        for unit,values in [('°F',[100,100,100]),('°C',[35]),('°C',[True,100,float('nan')])]:
            self.payload=body();self.payload['daily']['temperature_2m_max']=values
            self.payload['daily_units']['temperature_2m_max']=unit;self.client.until=0
            r=self.get()
            self.assertTrue(all(d['max_temperature_c'] is None for d in r['days']))
            self.assertEqual(r['days'][0]['probability'],1)
