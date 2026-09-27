"""Offline regression tests for provenance, identity and uncertainty handling."""
import json
import tempfile
import unittest
from pathlib import Path
from refresh_osaka_places import normalize, apply_checks, build, category


class DatasetTests(unittest.TestCase):
    def node(self, ident=1, **tags):
        return {'type':'node', 'id':ident, 'lat':34.67, 'lon':135.50,
                'tags':{'name':'Cafe', 'amenity':'cafe', **tags}}

    def test_unknowns_are_not_free_or_open(self):
        r = normalize(self.node(), '2026-09-23T00:00:00+00:00')
        for key in ('cost', 'opening_hours', 'covered', 'verified_at', 'stay_min'):
            self.assertIsNone(r['place'][key])
        self.assertEqual(r['source']['osm_ref'], 'node/1')

    def test_node_ids_are_not_shared_across_types(self):
        n = normalize(self.node(), 'now')
        e = self.node(); e['type']='way'; e['center']={'lat':34.67,'lon':135.50}
        w = normalize(e, 'now')
        self.assertNotEqual(n['place']['place_id'], w['place']['place_id'])
        self.assertEqual(w['source']['coordinate_method'], 'bounding_box_center_not_entrance')

    def test_partial_address_and_osm_fee_do_not_become_verified(self):
        r = normalize(self.node(**{'addr:city':'大阪市', 'charge':'700 JPY'}), 'now')
        self.assertIsNone(r['place']['address'])
        self.assertIsNone(r['place']['cost'])
        self.assertEqual(r['source']['address_components']['addr:city'], '大阪市')

    def test_private_facilities_excluded_but_external_sign_retained(self):
        self.assertIsNone(category({'amenity':'cafe','access':'private'}))
        self.assertEqual(category({'tourism':'attraction','access':'no','advertising':'billboard','visibility':'street'}), '명소')

    def test_official_override_retains_raw_disagreement(self):
        r = normalize(self.node(opening_hours='09:00-17:00'), 'now')
        apply_checks(r, [{'id':'test','osm_refs':['node/1'],'checked_at':'2026-09-23','urls':['https://example.org'],
                          'updates':{'opening_hours':'09:00-18:00','cost':1200}}])
        self.assertEqual(r['source']['tags']['opening_hours'], '09:00-17:00')
        self.assertEqual(r['place']['opening_hours'], '09:00-18:00')
        self.assertEqual(r['field_sources']['cost']['kind'], 'official_web_review')
        self.assertEqual(r['review']['status'], 'partially_verified')

    def test_nonfinite_coordinate_rejected(self):
        e = self.node(); e['lat']=float('nan')
        self.assertIsNone(normalize(e,'now'))

    def test_overpass_partial_response_rejected_before_other_inputs(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp); raw=root/'raw.json'
            raw.write_text(json.dumps({'remark':'runtime error: timeout','elements':[self.node()]}))
            with self.assertRaises(ValueError):
                build(raw,root/'query',root/'previous',root/'checks',root/'out')
            self.assertFalse((root/'out').exists())


if __name__ == '__main__': unittest.main()
