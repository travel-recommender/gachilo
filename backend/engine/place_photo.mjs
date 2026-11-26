import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {searchCandidates} from './live_check.mjs';

const BASE = 'https://places.googleapis.com/v1';
function httpsUrl(value, image = false) {
  try {
    const url = new URL(value?.startsWith('//') ? 'https:' + value : value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const hosts = image ? ['googleusercontent.com', 'ggpht.com'] : ['google.com', 'google.co.jp', 'maps.app.goo.gl'];
    return hosts.some(h => url.hostname === h || url.hostname.endsWith('.' + h)) ? url.href : null;
  } catch { return null; }
}
export async function placePhoto(record, {key = process.env.GOOGLE_PLACES_API_KEY, fetchImpl = fetch, links} = {}) {
  const p = record.place, empty = status => ({placeId: p.place_id, status, photo: null});
  if (!key) return empty('unavailable');
  const get = async (path, mask) => {
    const r = await fetchImpl(BASE + path, {redirect: 'error', signal: AbortSignal.timeout(6000),
      headers: {'X-Goog-Api-Key': key, ...(mask ? {'X-Goog-FieldMask': mask} : {})}});
    if (!r.ok) throw Error('PHOTO_UNAVAILABLE');
    return r.json();
  };
  try {
    links ??= JSON.parse(fs.readFileSync(new URL('../../data/google_place_links.json', import.meta.url), 'utf8')).links;
    let id = links.find(l => l.place_id === p.place_id && l.status === 'linked')?.google_place_id;
    if (!id) {
      if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) return empty('no_match');
      // Exact official name + <=150m only. Never substitute a nearby shop or another branch.
      const found = await searchCandidates(fetchImpl, key, p);
      const same = (found ?? []).filter(x => x.id && x.exact && !x.address && x.d <= 150);
      if (same.length !== 1) return empty(found ? 'no_match' : 'unavailable');
      id = same[0].id;
    }
    const data = await get('/places/' + encodeURIComponent(id), 'id,photos,googleMapsUri');
    if (data.id !== id) return empty('no_match');
    const raw = data.photos?.[0];
    const prefix = `places/${id}/photos/`;
    if (!raw?.name?.startsWith(prefix) || !/^[A-Za-z0-9_-]+$/.test(raw.name.slice(prefix.length))) return empty('no_photo');
    const media = await get('/' + raw.name + '/media?maxWidthPx=800&skipHttpRedirect=true');
    const url = httpsUrl(media.photoUri, true);
    if (!url) return empty('unavailable');
    return {placeId: p.place_id, status: 'ready', photo: {url,
      mapsUrl: httpsUrl(data.googleMapsUri) ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name)}&query_place_id=${encodeURIComponent(id)}`,
      authors: (raw.authorAttributions ?? []).map(a => ({name: String(a.displayName ?? ''),
        url: httpsUrl(a.uri), avatar: httpsUrl(a.photoUri, true)}))}};
  } catch { return empty('unavailable'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  try { process.stdout.write(JSON.stringify(await placePhoto(JSON.parse(input)))); }
  catch { process.exitCode = 1; }
}
