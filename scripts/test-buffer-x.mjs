import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { Script } from 'node:vm';
import { formatPost, weight } from '../supabase/functions/publish-buffer-x/format.mjs';
import { imageAssets } from '../supabase/functions/publish-buffer-x/artwork.mjs';

test('post artwork becomes a Buffer image attachment with alt text', () => {
  const assets = imageAssets({title:'Jackal season two',image_url:'https://artworks.thetvdb.com/banners/poster.jpg'});
  assert.deepEqual(assets,[{image:{url:'https://artworks.thetvdb.com/banners/poster.jpg',metadata:{altText:'Artwork accompanying Jackal season two'}}}]);
});
test('explicit artwork is preferred, with show poster fallback', () => {
  const show={name:'The Jackal',poster_url:'https://image.tmdb.org/t/p/w500/poster.jpg'};
  assert.equal(imageAssets({image_url:'https://burgrs.co.uk/upload.jpg'},show)[0].image.url,'https://burgrs.co.uk/upload.jpg');
  assert.equal(imageAssets({},show)[0].image.metadata.altText,'Poster for The Jackal');
});
test('missing or invalid artwork permits a text-only post', () => {
  for(const image_url of ['',null,'data:image/png;base64,abc','javascript:alert(1)','https://localhost/file','https://127.0.0.1/file','https://host.internal/file','https://user:secret@example.com/image.jpg']) {
    assert.deepEqual(imageAssets({image_url}),[]);
  }
  assert.equal(imageAssets({image_url:'invalid'},{poster_url:'https://image.tmdb.org/fallback.jpg'})[0].image.url,'https://image.tmdb.org/fallback.jpg');
});

test('news contains headline, attribution and existing public show link', () => {
  const result = formatPost({title:'Example renewed',body:'Season two confirmed.',is_auto_news:true,source_name:'Deadline',related_show_id:'abc-123'}, 'Burgrs TV');
  assert.match(result,/Example renewed/);
  assert.match(result,/Source: Deadline/);
  assert.match(result,/https:\/\/burgrs.co.uk\/show\/abc-123$/);
});
test('long Unicode news stays within X weighted character limit and keeps attribution/link', () => {
  for (const text of ['A'.repeat(2000), '🍔'.repeat(400), '漢字'.repeat(400)]) {
    const result = formatPost({title:text,body:text,is_auto_news:true,source_name:'The Hollywood Reporter',related_show_id:'abc'},'Burgrs TV');
    const withoutLink = result.replace(/https?:\/\/\S+$/,'');
    assert.ok(weight(withoutLink)+23<=280);
    assert.match(result,/Source: The Hollywood Reporter/);
  }
});
test('ordinary posts link to encoded profile; embedded URLs and HTML cannot inflate weight', () => {
  const result = formatPost({title:'<b>Hello</b>',body:'TV news https://example.com/'+'x'.repeat(1000)},'Burgrs TV');
  assert.match(result,/^Hello/);
  assert.match(result,/\/u\/Burgrs%20TV$/);
  assert.doesNotMatch(result,/example.com|<b>/);
});
test('empty media-only post is not accidentally submitted as an empty tweet', () => {
  assert.throws(()=>formatPost({body:'https://example.com'},'Burgrs TV'),/no text/);
});
test('deployed worker is syntactically valid after stripping TypeScript', () => {
  const source = readFileSync(new URL('../supabase/functions/publish-buffer-x/index.ts',import.meta.url),'utf8');
  const transformed = stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import .*;$/gm,'');
  assert.doesNotThrow(()=>new Script(transformed));
});
