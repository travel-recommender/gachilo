"""Normalize a bounded Overpass response; preserve way/node evidence and unknown coverage."""
import argparse
import hashlib
import json
from pathlib import Path


def prepare(raw, query):
    if raw.get('remark') or not isinstance(raw.get('elements'), list):
        raise ValueError('incomplete Overpass response')
    ways = []
    for way in raw['elements']:
        tags = way.get('tags', {})
        if way.get('type') != 'way' or tags.get('highway') not in ('footway', 'pedestrian', 'path'):
            continue
        if tags.get('covered') not in ('yes', 'arcade', 'colonnade'):
            continue
        if any(tags.get(k) in ('no', 'private', 'customers', 'permit', 'delivery') for k in ('access', 'foot')):
            continue
        if any('conditional' in k or k in ('opening_hours', 'construction') for k in tags):
            continue  # Timed/restricted passage needs its own operating contract.
        nodes, geometry = way.get('nodes', []), way.get('geometry', [])
        if len(nodes) < 2 or len(nodes) != len(geometry):
            continue
        if any(type(n) is not int or n <= 0 for n in nodes):
            continue
        if any(type(p.get('lat')) not in (int,float) or type(p.get('lon')) not in (int,float)
               or not 34.5 < p['lat'] < 34.9 or not 135.3 < p['lon'] < 135.7 for p in geometry):
            continue
        ways.append(dict(osm_way_id=way['id'], source_url=f"https://www.openstreetmap.org/way/{way['id']}",
                         tags=tags, nodes=nodes, geometry=[dict(lat=p['lat'],lng=p['lon']) for p in geometry]))
    if not ways:
        raise ValueError('no supported sheltered pedestrian ways')
    return dict(schema_version=1, source='OpenStreetMap contributors via Overpass',
                license='ODbL-1.0', attribution_url='https://www.openstreetmap.org/copyright',
                osm_timestamp=raw.get('osm3s',{}).get('timestamp_osm_base'),
                query=query, query_sha256=hashlib.sha256(query.encode()).hexdigest(),
                semantics='OSM-tagged roof coverage of pedestrian way segments; not venue indoor status. Unmatched route edges stay unknown.',
                limitations=['Map evidence, not field inspection or live passage availability.',
                             'Bounded Osaka-area map extract; absence of a roof tag is unknown, not proof of exposure.',
                             'Restricted/timed ways omitted; ground access, closures and step-free access need on-site confirmation.'],
                ways=sorted(ways,key=lambda w:w['osm_way_id']))


def from_pbf(path, timestamp):
    # Optional acquisition dependency only; the service reads the checked-in JSON.
    import osmium
    class Collector(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.elements = []
        def way(self, way):
            tags = dict(way.tags)
            if tags.get('highway') not in ('footway', 'pedestrian', 'path') or tags.get('covered') not in ('yes', 'arcade', 'colonnade'):
                return
            self.elements.append(dict(type='way', id=way.id, tags=tags,
                nodes=[n.ref for n in way.nodes], geometry=[dict(lat=n.lat,lon=n.lon) for n in way.nodes]))
    collector = Collector()
    collector.apply_file(str(path), locations=True)
    result = prepare(dict(elements=collector.elements), 'local OSRM source PBF; pedestrian covered ways')
    result.update(source='OpenStreetMap contributors; Geofabrik Kansai extract used by local foot OSRM',
        source_url='https://download.geofabrik.de/asia/japan/kansai.html',
        osm_timestamp=timestamp, source_pbf_name=path.name,
        source_pbf_sha256=hashlib.file_digest(path.open('rb'), 'sha256').hexdigest())
    result.pop('query'); result.pop('query_sha256')
    return result


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--pbf', type=Path, required=True)
    parser.add_argument('--osm-timestamp', required=True, help='Original upstream PBF snapshot timestamp (not download time)')
    parser.add_argument('--output', type=Path, default=Path('data/sheltered_paths.json'))
    args=parser.parse_args()
    result=from_pbf(args.pbf, args.osm_timestamp)
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(f"{len(result['ways'])} supported covered ways")
