import test from 'node:test';
import assert from 'node:assert/strict';
import {loadInputs,loadRuntimeInputs} from './validate_real_schedule.mjs';

test('service and historical audit inputs stay separate without local path settings',()=>{
  const {REAL_CATALOG_PATH:catalog,REAL_PROFILES_PATH:profiles}=process.env;
  try {
    delete process.env.REAL_CATALOG_PATH;delete process.env.REAL_PROFILES_PATH;
    assert.equal(loadInputs().dataset.places.length,150);
    const runtime=loadRuntimeInputs();
    assert.equal(runtime.dataset.places.length,205);
    for(const id of ['branch_ichiran_abeno','branch_ichiran_shinsaibashi']) {
      assert.ok(runtime.dataset.places.some(r=>r.place.place_id===id));
      assert.ok(runtime.profiles.places[id]);
    }
    process.env.REAL_CATALOG_PATH='custom.json';
    assert.throws(()=>loadRuntimeInputs(),/configured together/);
  } finally {
    if(catalog===undefined)delete process.env.REAL_CATALOG_PATH;else process.env.REAL_CATALOG_PATH=catalog;
    if(profiles===undefined)delete process.env.REAL_PROFILES_PATH;else process.env.REAL_PROFILES_PATH=profiles;
  }
});
