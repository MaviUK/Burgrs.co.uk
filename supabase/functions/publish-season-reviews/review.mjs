export const SOURCE_DOMAINS = ['tvline.com','deadline.com','variety.com','hollywoodreporter.com','bbc.co.uk','netflix.com','about.netflix.com','theguardian.com','radiotimes.com','digitalspy.com','vulture.com','avclub.com','ign.com','thewrap.com','tvinsider.com','tvguide.com','rogerebert.com','collider.com','hbo.com','press.wbd.com','apple.com','paramountplus.com','disneyplus.com','amazon.com','primevideo.com','amc.com','nbc.com','cbs.com','abc.com','fox.com','thereviewgeek.com','cbr.com','decider.com'];
const str = { type: 'string' }, bool = { type: 'boolean' }, strings = { type: 'array', items: str };
const object = (properties) => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const researchSchema = object({
  same_show_and_season:bool,season_complete:bool,is_midseason_break:bool,
  episode_count:{type:'integer'},finale_date:str,release_mode:{type:'string',enum:['weekly','binge','unknown']},
  completion_source_urls:strings,reason:str,
  facts:{type:'array',items:object({id:{type:'integer'},detail:str,source_urls:strings,contains_spoilers:bool})},
});
export const draftSchema = object({headline:str,verdict:str,paragraphs:{type:'array',items:object({text:str,evidence_ids:{type:'array',items:{type:'integer'}}})},question:str});
export const verificationSchema = object({approved:bool,unsupported_claims:strings,contains_spoilers:bool,copied_phrasing:bool,reason:str});
export function safeSource(value) {
  try {
    const u=new URL(value);const host=u.hostname.toLowerCase();
    if(u.protocol!=='https:'||u.username||u.password||u.port||(u.pathname==='/'&& !u.search))return '';
    if(!SOURCE_DOMAINS.some(d=>host===d||host.endsWith('.'+d)))return '';
    u.hash=''; return u.href;
  } catch {return '';}
}
export function responseSources(response) {
  const result=new Set();
  for(const output of response.output||[]) {
    if(output.type==='web_search_call')for(const source of output.action?.sources||[]){const u=safeSource(source.url);if(u)result.add(u);}
    for(const part of output.content||[])for(const a of part.annotations||[]){if(a.type==='url_citation'){const u=safeSource(a.url);if(u)result.add(u);}}
  }
  return [...result];
}
export function parseResponse(response) {
  if(response.status!=='completed')throw new Error('AI response incomplete');
  const parts=(response.output||[]).flatMap(x=>x.content||[]);
  if(parts.some(x=>x.type==='refusal'))throw new Error('AI response refused');
  const text=parts.filter(x=>x.type==='output_text').map(x=>x.text||'').join('');
  return JSON.parse(text);
}
export function checkEvidence(raw, retrieved, context) {
  const seen=new Set(retrieved.map(safeSource).filter(Boolean));
  const approvedUrls=(urls)=>[...new Set((urls||[]).map(safeSource).filter(u=>u&&seen.has(u)))];
  if(!raw.same_show_and_season||!raw.season_complete||raw.is_midseason_break)return {ok:false,reason:raw.reason||'Season completion not confirmed'};
  if(raw.episode_count!==context.episodes.length||raw.finale_date!==context.finale_date)return {ok:false,reason:'External episode count or finale date disagrees with database'};
  if(raw.release_mode!==context.release_mode)return {ok:false,reason:'Release pattern is uncertain or disagrees with schedule'};
  const completion=approvedUrls(raw.completion_source_urls);
  if(!completion.length)return {ok:false,reason:'No retrieved source confirms the complete season'};
  const facts=(raw.facts||[]).filter(f=>f.detail?.length>=40).map(f=>({...f,source_urls:approvedUrls(f.source_urls)})).filter(f=>f.source_urls.length);
  const ids=new Set(facts.map(f=>f.id));
  const hosts=new Set(facts.flatMap(f=>f.source_urls).map(u=> {
    const host=new URL(u).hostname;
    return SOURCE_DOMAINS.filter(d=>host===d||host.endsWith('.'+d)).sort((a,b)=>a.length-b.length)[0];
  }));
  if(facts.length<4||ids.size!==facts.length||hosts.size<2)return {ok:false,reason:'Need at least four sourced details from two independent publications'};
  if(facts.filter(f=>!f.contains_spoilers).length<3)return {ok:false,reason:'Insufficient spoiler-free evidence for a review'};
  return {ok:true,evidence:{...raw,facts,completion_source_urls:completion,retrieved_sources:[...seen]}};
}
const clean=(x)=>String(x||'').replace(/<[^>]*>/g,'').trim();
export function validateDraft(draft,evidence) {
  const allowed=new Set(evidence.facts.filter(f=>!f.contains_spoilers).map(f=>f.id));
  if(!draft||clean(draft.headline).length<8||clean(draft.headline).length>100||clean(draft.verdict).length<20||clean(draft.verdict).length>260)throw new Error('Review headline or verdict invalid');
  if(!Array.isArray(draft.paragraphs)||draft.paragraphs.length<2||draft.paragraphs.length>4)throw new Error('Review paragraph count invalid');
  for(const p of draft.paragraphs)if(clean(p.text).length<60||!p.evidence_ids?.length||p.evidence_ids.some(id=>!allowed.has(id)))throw new Error('Review paragraph lacks spoiler-free evidence');
  if(!clean(draft.question).endsWith('?')||clean(draft.question).length>220)throw new Error('Review needs a specific engagement question');
  const whole=[draft.verdict,...draft.paragraphs.map(p=>p.text),draft.question].join(' ');
  const count=whole.split(/\s+/).filter(Boolean).length;
  if(count<140||count>300||/https?:\/\/|\[[^\]]*\]\(|\bI (watched|binged|saw)\b/i.test(whole))throw new Error('Review length or content invalid');
  return draft;
}
export function renderReview(draft,evidence,showName,seasonNumber,showId='') {
  validateDraft(draft,evidence);
  const sources=[];
  function citation(url){let i=sources.indexOf(url);if(i<0){sources.push(url);i=sources.length-1;}return `[${i+1}](${url})`;}
  const paragraphs=draft.paragraphs.map(p=> {
    const urls=[...new Set(p.evidence_ids.flatMap(id=>evidence.facts.find(f=>f.id===id).source_urls))].slice(0,2);
    return clean(p.text)+' '+urls.map(citation).join(' ');
  });
  const title=`${showName} — Season ${seasonNumber}: ${clean(draft.headline)}`.slice(0,180);
  const link=showId?`View show: [${showName.replace(/[\[\]]/g,'')}](https://burgrs.co.uk/show/${encodeURIComponent(showId)})`:'';
  const body=[`AI-generated · Spoiler-free season review`,clean(draft.verdict),...paragraphs,clean(draft.question),link].filter(Boolean).join('\n\n');
  return {title,body};
}
