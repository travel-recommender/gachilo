import test from 'node:test';
import assert from 'node:assert/strict';
import {placePhoto} from './place_photo.mjs';
const record={place:{place_id:'shop',name:'一蘭 道頓堀店',latitude:34.67,longitude:135.5}};
const links=[{place_id:'shop',status:'linked',google_place_id:'GID'}];
const ok=value=>({ok:true,json:async()=>value});
const detail={id:'GID',googleMapsUri:'https://maps.google.com/place',photos:[{name:'places/GID/photos/PHOTO',authorAttributions:[{displayName:'Photographer',uri:'//maps.google.com/maps/contrib/1',photoUri:'//lh3.googleusercontent.com/author'}]}]};
test('photo lookup forwards key only to Google API and preserves attribution',async()=>{
 const calls=[];const result=await placePhoto(record,{key:'private',links,fetchImpl:async(url,init)=>{
  calls.push(url);assert.ok(url.startsWith('https://places.googleapis.com/v1/'));assert.equal(init.redirect,'error');assert.equal(init.headers['X-Goog-Api-Key'],'private');
  return ok(calls.length===1?detail:{photoUri:'https://lh3.googleusercontent.com/photo'});
 }});
 assert.equal(result.status,'ready');assert.equal(calls.length,2);assert.match(calls[1],/skipHttpRedirect=true/);
 assert.deepEqual(result.photo.authors,[{name:'Photographer',url:'https://maps.google.com/maps/contrib/1',avatar:'https://lh3.googleusercontent.com/author'}]);
 assert.ok(!JSON.stringify(result).includes('private'));
});
test('unmatched chain branch, ambiguous match and remote coordinates never fetch photos',async()=>{
 for(const places of [[{id:'wrong',displayName:{text:'一蘭 別館'},location:{latitude:34.67,longitude:135.5}}],
  [1,2].map(i=>({id:String(i),displayName:{text:record.place.name},location:{latitude:34.67,longitude:135.5}})),
  [{id:'far',displayName:{text:record.place.name},location:{latitude:35,longitude:135.5}}]]){
  let calls=0;const result=await placePhoto(record,{key:'private',links:[],fetchImpl:async()=>{calls++;return ok({places});}});
  assert.equal(result.status,'no_match');assert.equal(calls,1);
 }
});
test('missing key, failed lookup, absent image and unsafe media URL have no fabricated photo',async()=>{
 assert.equal((await placePhoto(record,{key:'',fetchImpl:()=>{throw Error('must not request');}})).status,'unavailable');
 for(const variant of ['missing','error','evil']){
  let calls=0;const result=await placePhoto(record,{key:'private',links,fetchImpl:async()=>{
   calls++;if(variant==='error')throw Error('private upstream error');
   return ok(calls===1?(variant==='missing'?{id:'GID'}:detail):{photoUri:'https://evil.example/picture'});
  }});
  assert.equal(result.photo,null);assert.ok(!JSON.stringify(result).includes('private'));
 }
});
