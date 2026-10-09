import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {stripTypeScriptTypes} from 'node:module';
import {Script} from 'node:vm';
import {reviewLinkParts} from '../src/lib/generatedReviewLinks.mjs';
import {safeSource,checkEvidence,parseResponse,responseSources,validateDraft,renderReview} from '../supabase/functions/publish-season-reviews/review.mjs';
const urls=['https://tvline.com/recaps/example-season-finale/','https://www.theguardian.com/tv-and-radio/2026/oct/09/example-review'];
const ctx={episodes:[{},{}],finale_date:'2026-10-09',release_mode:'weekly'};
const raw={same_show_and_season:true,season_complete:true,is_midseason_break:false,episode_count:2,finale_date:ctx.finale_date,release_mode:'weekly',completion_source_urls:[urls[0]],reason:'Confirmed',facts:Array.from({length:4},(_,i)=>({id:i+1,detail:'A substantial supported observation about the structure of this television season.',source_urls:[urls[i%2]],contains_spoilers:false}))};
const evidence=checkEvidence(raw,urls,ctx).evidence;
const paragraph='The season gives its characters competing goals instead of throwing another explosion at every problem. That structure earns its tension. It is an encouraging choice, although the careful rhythm can make the drama feel a little too comfortable.';
const draft={headline:'A confident season with something to argue about',verdict:'This season earns its confidence through structure, even when that confidence starts to feel a little too comfortable.',paragraphs:[{text:paragraph,evidence_ids:[1,2]},{text:paragraph,evidence_ids:[3,4]}]};
test('only trusted public HTTPS article URLs are accepted',()=>{assert.equal(safeSource(urls[0]),urls[0]);for(const u of ['http://tvline.com/article','https://tvline.com','https://tvline.com.evil.test/article','https://user:pass@tvline.com/article','https://127.0.0.1/article','javascript:alert(1)'])assert.equal(safeSource(u),'');});
test('completion and matching season details are required',()=>{assert.equal(checkEvidence(raw,urls,ctx).ok,true);for(const patch of [{season_complete:false},{is_midseason_break:true},{same_show_and_season:false},{episode_count:3},{finale_date:'2026-10-08'},{release_mode:'binge'}])assert.equal(checkEvidence({...raw,...patch},urls,ctx).ok,false);});
test('fabricated or unreturned source URLs fail the gate',()=>{assert.equal(checkEvidence(raw,[urls[0]],ctx).ok,false);assert.equal(checkEvidence({...raw,completion_source_urls:['https://tvline.com/never-retrieved']},urls,ctx).ok,false);});
test('two subdomains of one publisher are not independent sources',()=>{const links=['https://netflix.com/article/a','https://about.netflix.com/en/news/b'];assert.equal(checkEvidence({...raw,completion_source_urls:[links[0]],facts:raw.facts.map((f,i)=>({...f,source_urls:[links[i%2]]}))},links,ctx).ok,false);});
test('insufficient spoiler-free facts are held',()=>{assert.equal(checkEvidence({...raw,facts:raw.facts.map((f,i)=>({...f,contains_spoilers:i>0}))},urls,ctx).ok,false);});
test('draft citations cannot reference spoilers or unknown evidence',()=>{assert.equal(validateDraft(draft,evidence),draft);assert.throws(()=>validateDraft({...draft,paragraphs:[{text:paragraph,evidence_ids:[999]},draft.paragraphs[1]]},evidence));assert.throws(()=>validateDraft(draft,{...evidence,facts:evidence.facts.map(f=>({...f,contains_spoilers:true}))}));});
test('public review is prose without questions, references or generation tags',()=>{
  const p=renderReview(draft,evidence,'Example',2,'abc');
  assert.match(p.title,/Example — Season 2/);
  assert.equal(p.body.includes('AI-generated'),false);
  assert.equal(p.body.includes('Sources:'),false);
  assert.equal(p.body.includes('https://'),false);
  assert.equal(p.body.trim().endsWith('?'),false);
});
test('AI refusal and truncated responses cannot be published',()=>{assert.throws(()=>parseResponse({status:'incomplete',output:[]}));assert.throws(()=>parseResponse({status:'completed',output:[{content:[{type:'refusal'}]}]}));assert.deepEqual(responseSources({output:[{type:'web_search_call',action:{sources:[{url:urls[0]}]}}]}),[urls[0]]);});
test('edge function TypeScript parses without running remote dependencies',()=>{const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/publish-season-reviews/index.ts',import.meta.url),'utf8'));new Script(source.replace(/^import .*;$/gm,''));});

test('long copy, extra paragraphs and test labels cannot publish',()=>{
  assert.throws(()=>validateDraft({...draft,paragraphs:draft.paragraphs.map(p=>({...p,text:p.text+' '+paragraph}))},evidence),/length/);
  assert.throws(()=>validateDraft({...draft,paragraphs:[...draft.paragraphs,draft.paragraphs[0]]},evidence),/paragraph count/);
  assert.throws(()=>validateDraft({...draft,headline:'[Test] A season review'},evidence),/labelled a test/);
});
test('source evidence remains private and unchanged by rendering',()=>{
  const before=structuredClone(evidence);
  const p=renderReview(draft,evidence,'Example',1);
  assert.deepEqual(evidence,before);
  assert.ok(evidence.facts.every(f=>f.source_urls.length));
  assert.equal(p.body.includes('Sources:'),false);
  assert.equal(p.body.includes('theguardian.com'),false);
});
test('closing questions and public labels are rejected',()=>{
  assert.throws(()=>validateDraft({...draft,question:'Agree?'},evidence),/not an engagement question/);
  const paragraphs=draft.paragraphs.map((p,i)=>i===1?{...p,text:p.text.slice(0,-1)+'?'}:p);
  assert.throws(()=>validateDraft({...draft,paragraphs},evidence),/not an engagement question/);
  for(const label of [' Sources: Radio Times.',' AI-generated review.']) {
    assert.throws(()=>validateDraft({...draft,paragraphs:draft.paragraphs.map((p,i)=>i===1?{...p,text:p.text+label}:p)},evidence),/public labels or references/);
  }
});
test('review display links support spaces and reject unsafe destinations',()=>{
  const parts=reviewLinkParts('Sources: [Amazon] (https://www.aboutamazon.co.uk/news/entertainment/example) · [Unsafe](javascript:alert(1)) · [Credentials](https://user:pass@example.com/article)\n\nView show: [Example](https://burgrs.co.uk/show/abc)',true);
  assert.equal(parts.filter(p=>p.href).length,1);
  assert.equal(parts.find(p=>p.href).text,'Amazon');
  assert.equal(parts.some(p=>p.text.includes('View show:')),false);
});
