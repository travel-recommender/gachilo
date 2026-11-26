import os
import json
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from place_photo import PhotoService
from api_errors import ApiError

class PhotoTests(unittest.TestCase):
    def setUp(self):
        self.service=PhotoService('node',[{'place':{'place_id':'one'}}])
    def test_unknown_place_and_invalid_body_never_call_worker(self):
        for body in ({'placeId':'missing'}, {'placeId':'one','url':'https://evil.example'}, None):
            with patch('subprocess.run') as run:
                with self.assertRaises(ApiError):self.service.get('room',body)
                run.assert_not_called()
    def test_absent_key_failure_and_rate_limit(self):
        with patch.dict(os.environ,{'GOOGLE_PLACES_API_KEY':''}),patch('subprocess.run') as run:
            self.assertEqual(self.service.get('room',{'placeId':'one'})['photo'],None);run.assert_not_called()
        with patch.dict(os.environ,{'GOOGLE_PLACES_API_KEY':'test_secret_that_must_not_be_an_argument'}),patch('subprocess.run',side_effect=OSError('redacted')):
            self.assertEqual(self.service.get('room',{'placeId':'one'})['status'],'unavailable')
        result=SimpleNamespace(stdout=json.dumps({'placeId':'one','status':'no_photo','photo':None}))
        with patch.dict(os.environ,{'GOOGLE_PLACES_API_KEY':'test_secret_that_must_not_be_an_argument'}),patch('subprocess.run',return_value=result) as run:
            for _ in range(19):self.service.get('room',{'placeId':'one'})
            with self.assertRaises(ApiError) as error:self.service.get('room',{'placeId':'one'})
            self.assertEqual(error.exception.status,429)
            self.assertNotIn('test_secret_that_must_not_be_an_argument',str(run.call_args))

if __name__=='__main__':unittest.main()
