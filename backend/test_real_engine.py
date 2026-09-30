import json, os, sqlite3, unittest
from contextlib import closing
from unittest.mock import patch
import test_server
from server import Store, ApiError

FX={'JPY_TO_KRW':'9.5','JPY_TO_KRW_AS_OF':'2026-09-30',
    'JPY_TO_KRW_SOURCE':'하나은행 고시환율 형식 테스트용 가상값 (실제 고시 아님)'}

class RealRoomTests(unittest.TestCase):
    setUp=test_server.ApiTests.setUp
    tearDown=test_server.ApiTests.tearDown
    req=test_server.ApiTests.req

    def room(self, dataset='osaka_review_150', start='2026-10-01', end='2026-10-02', count=2):
        code, room, _=self.req('POST','/rooms',{'dataset':dataset,'startDate':start,'endDate':end,'memberNames':['개인'+str(i) for i in range(count)]})
        self.assertEqual(code,201)
        return room

    def save(self, room, member, picks, **extra):
        body={'longlist':picks,'picks':picks,'must':None,'veto':None,'budgetPerDay':100000,'stepLimit':20000,'activeMin':720,**extra}
        return self.req('PUT',f"/rooms/{room['roomId']}/submissions/{member['id']}",body,member['submissionToken'])

    def calculate(self,room,**kwargs):
        with patch.dict(os.environ,FX):
            return self.req('POST',f"/rooms/{room['roomId']}/calculate",{'strategy':'average',**kwargs},room['ownerToken'])

    def test_all_150_ids_can_be_saved_but_blocked_places_are_not_scheduled(self):
        room=self.room(count=6)
        places=self.req('GET','/api/places?limit=150')[1]['places']
        self.assertEqual(len(places),150)
        for i,m in enumerate(room['members']):
            self.assertEqual(self.save(room,m,[p['place_id'] for p in places[i*25:(i+1)*25]])[0],200)
        code,data,_=self.calculate(room)
        self.assertEqual(code,200);self.assertEqual(data['status'],'draft')
        self.assertEqual(data['planning']['catalog_count'],150)
        self.assertEqual(data['planning']['status'],'needs_review')
        ids={id for d in data['result']['days'] for id in d['placeIds']}
        self.assertTrue(ids);self.assertTrue(ids <= {p['place_id'] for p in places})
        blocked={p['place_id'] for p in places if 'google_maps_permanently_closed' in p['planning']['review_required']}
        self.assertFalse(ids & blocked)
        self.assertGreater(data['planning']['unplaced_count'],100)

    def test_saved_selection_only_and_private_inputs_never_leave_result(self):
        room=self.room();picked=['osaka_009','osaka_015']
        for m in room['members']:self.save(room,m,picked,must='osaka_009')
        code,data,_=self.calculate(room);self.assertEqual(code,200)
        self.assertEqual({id for d in data['result']['days'] for id in d['placeIds']},set(picked))
        self.assertTrue(data['planning']['must_satisfied'])
        text=json.dumps(data,ensure_ascii=False)
        for private in ('submissions','memberId','budgetPerDay','submissionToken',*[m['name'] for m in room['members']]):self.assertNotIn(private,text)
        for m in room['members']:self.assertNotIn(m['id'],text);self.assertNotIn(m['submissionToken'],text)
        persisted=Store(self.db).result(room['roomId'],room['ownerToken'])
        self.assertEqual(persisted,data)

    def test_free_exhibition_date_survives_http_calculation_and_saved_result(self):
        room=self.room(start='2026-10-03',end='2026-10-03')
        place_id='osaka_draft_ce3b8d452a0e'
        for member in room['members']:
            self.assertEqual(self.save(room,member,[place_id],budgetPerDay=0)[0],200)
        code,data,_=self.calculate(room)
        self.assertEqual(code,200)
        self.assertEqual(data['planning']['scheduled_count'],1)
        item=data['planning']['days'][0]['items'][0]
        self.assertEqual((item['place_id'],item['cost_jpy'],item['cost_krw']),(place_id,0,0))
        code,saved,_=self.req('GET',f"/rooms/{room['roomId']}/results",token=room['ownerToken'])
        self.assertEqual(code,200)
        self.assertEqual(saved,data)

    def test_catalogs_do_not_mix_in_either_direction(self):
        real=self.room();demo=self.room('prototype_demo_36')
        self.assertEqual(self.save(real,real['members'][0],['glico'])[0],400)
        self.assertEqual(self.save(demo,demo['members'][0],['osaka_009'])[0],400)

    def test_missing_or_wrong_fx_provenance_is_actionable_and_not_saved(self):
        room=self.room()
        for m in room['members']:self.save(room,m,['osaka_009'])
        path=f"/rooms/{room['roomId']}"
        for settings in ({},{'JPY_TO_KRW':'9.5'}, {**FX,'JPY_TO_KRW_SOURCE':'unidentified'}):
            with patch.dict(os.environ,settings,clear=True):
                code,data,_=self.req('POST',path+'/calculate',{'strategy':'average'},room['ownerToken'])
            self.assertEqual(code,503);self.assertIn('하나은행',data['error'])
        self.assertIsNone(self.req('GET',path+'/results',token=room['ownerToken'])[1]['result'])

    def test_veto_wins_must_is_flagged_and_daily_budget_is_never_exceeded(self):
        room=self.room(start='2026-10-01',end='2026-10-01');a,b=room['members']
        self.save(room,a,['osaka_009','osaka_015'],must='osaka_009',budgetPerDay=0)
        self.save(room,b,['osaka_015'],veto='osaka_009',budgetPerDay=0)
        code,data,_=self.calculate(room);self.assertEqual(code,200)
        self.assertEqual(data['result']['days'][0]['placeIds'],['osaka_015'])
        self.assertFalse(data['planning']['must_satisfied'])
        self.assertEqual(data['planning']['status'],'needs_review')
        self.assertEqual(data['planning']['days'][0]['totals']['selected_admission_and_menu_krw'],0)

    def test_input_change_invalidates_planning_and_rejects_stale_calculation(self):
        room=self.room()
        for m in room['members']:self.save(room,m,['osaka_009'])
        _,data,_=self.calculate(room);store=Store(self.db)
        self.save(room,room['members'][0],['osaka_015'])
        current=store.result(room['roomId'],room['ownerToken'])
        self.assertIsNone(current['result']);self.assertIsNone(current['planning'])
        with self.assertRaises(ApiError) as failure:
            store.save_result(room['roomId'],room['ownerToken'],{'revision':data['revision'],'result':data['result']},planning=data['planning'])
        self.assertEqual(failure.exception.status,409)

    def test_manual_results_and_member_calculation_are_rejected(self):
        room=self.room()
        for m in room['members']:self.save(room,m,['osaka_009'])
        path=f"/rooms/{room['roomId']}"
        body={'revision':2,'result':{'strategy':'average','days':[],'summary':'fake ready'}}
        self.assertEqual(self.req('POST',path+'/results',body,room['ownerToken'])[0],400)
        self.assertEqual(self.req('POST',path+'/calculate',{'strategy':'average'},room['members'][0]['submissionToken'])[0],403)
        self.assertEqual(self.calculate(room,strategy='fairness')[0],400)

    def test_shopping_is_explicitly_excluded_from_cost_not_free(self):
        room=self.room()
        for m in room['members']:self.save(room,m,['osaka_022'],budgetPerDay=0)
        code,data,_=self.calculate(room);self.assertEqual(code,200)
        item=next(item for d in data['planning']['days'] for item in d['items'])
        self.assertEqual(item['cost_status'],'not_applicable_shopping')
        self.assertIsNone(item['cost_jpy']);self.assertIsNone(item['cost_krw'])

    def test_empty_or_outside_calendar_is_review_required(self):
        for picks,start,end in [([], '2026-10-01','2026-10-01'),(['osaka_009'],'2026-12-01','2026-12-01')]:
            room=self.room(start=start,end=end)
            for m in room['members']:self.save(room,m,picks)
            code,data,_=self.calculate(room);self.assertEqual(code,200)
            self.assertEqual(data['planning']['scheduled_count'],0)
            self.assertEqual(data['planning']['status'],'needs_review')

    def test_legacy_database_migration_keeps_existing_results(self):
        path=self.db.parent/'legacy.sqlite3'
        with closing(sqlite3.connect(path)) as c, c:
            c.executescript("CREATE TABLE rooms(id TEXT PRIMARY KEY,start TEXT,end TEXT,owner_hash TEXT,revision INTEGER NOT NULL DEFAULT 0); CREATE TABLE results(room_id TEXT PRIMARY KEY,revision INTEGER,payload TEXT,updated TEXT);")
            c.execute("INSERT INTO rooms VALUES('legacy','2026-10-01','2026-10-01','hash',2)")
            c.execute("INSERT INTO results VALUES('legacy',2,'{}','now')")
        Store(path);Store(path)
        with closing(sqlite3.connect(path)) as c, c:
            self.assertEqual(c.execute('SELECT dataset FROM rooms').fetchone()[0],'prototype_demo_36')
            self.assertEqual(c.execute('SELECT payload,planning FROM results').fetchone(),('{}',None))

if __name__=='__main__':unittest.main()
