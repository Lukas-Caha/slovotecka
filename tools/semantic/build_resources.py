"""Build a wide Czech lexicon and lemma embeddings from complete vector releases.

No frequency cutoff is applied to dictionary-recognized common words. Frequent
unrecognized corpus words (loans/slang) and explicitly reviewed words are retained.
"""
from pathlib import Path
import os,argparse,csv,json,re,time,unicodedata,sqlite3,struct,hashlib,gc
import numpy as np
from wordfreq import zipf_frequency,get_frequency_dict
from ufal.morphodita import Morpho,TaggedLemmas,TaggedLemmasForms
P=Path(os.environ.get('WORDGAME_SEMANTIC_WORK','.semantic-build')).resolve();CACHE=P/'cache';OUT=Path(__file__).resolve().parents[2];DATA=OUT/'vystup';TOOLS=OUT/'tools/semantic';DATA.mkdir(parents=True,exist_ok=True)
T=time.time();exact_frequency_words=get_frequency_dict('cs')
rows=list(csv.reader((TOOLS/'targets.tsv').open(),delimiter='\t'))
required={x for r in rows for x in [r[0],*r[3].split()]}
required.update('stetoskop příboj marcipán barista latte kafe wifi wi-fi e-mail email selfie čištění karton mozzarella běžec jídlo motorka tužka brambor kamarád mrkev počasí ponožka radost ahoj ano běhat jeden tři parlament jahoda klávesnice brzda kočka román letadlo auto ovladač powerbanka nabíječka router algoritmus programátor odšťavňovač kytara palačinka cheeseburger pizza jogurt peníze nemocnice počítač zářivka xerox kyslík vodík čichat škrábat cyklostezka účtenka cappuccino'.split())
letters='a-záčďéěíňóřšťúůýžàâäæãåāçèêëēîïīôöõøōœùûüūÿñß'
valid=re.compile('^['+letters+"]{2,48}(?:[-']['"+letters+"]+)*$")
def norm(w):return unicodedata.normalize('NFC',w).lower().replace('’',"'")
# Orthographic variants, plural-only common displays and irregular comparatives.
canonical={'telefoní':'telefonní','řidítko':'řídítka','řídítko':'řídítka','nůžka':'nůžky','péci':'péct','říci':'říct','moci':'moct','téci':'téct','vléci':'vléct','léta':'léto','lepší':'dobrý','horší':'špatný','kartón':'karton'}
force={'jeden':'jeden','tři':'tři','domu':'dům','kola':'kolo','letech':'rok','letům':'rok','lety':'rok','léta':'léto','chutě':'chuť','wi-fi':'wifi','e-mail':'email'}
model=next((CACHE/'morph').rglob('*.dict'));m=Morpho.load(str(model));a=TaggedLemmas();forms=TaggedLemmasForms()
info=[];lemma_id={};frequency={};observed={};corpora={}
def freq(w):
 v=frequency.get(w)
 if v is None:v=frequency[w]=zipf_frequency(w,'cs')
 return v
def ensure(lemma,full=None,pos='N'):
 if lemma not in lemma_id:
  lemma_id[lemma]=len(info);info.append({'word':lemma,'ids':set(),'pos':set(),'freq':freq(lemma),'maxfreq':freq(lemma),'cc_head':None,'wiki_head':None,'dictionary':False})
 i=lemma_id[lemma];item=info[i]
 if full:item['ids'].add(full);item['dictionary']=True
 item['pos'].add(pos);return i
def analyze(token):
 low=norm(token);result={}
 variants=[low]
 if token!=low and token not in variants:variants.append(token)
 for variant in variants:
  has_lower_reading=bool(result) and variant!=low
  m.analyze(variant,m.NO_GUESSER,a)
  for x in a:
   raw=norm(m.rawLemma(x.lemma));pos=x.tag[0]
   if has_lower_reading and re.search(r';[A-Z]',x.lemma):continue
   spelling=re.search(r'\^DD\*\*([a-zA-ZáčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ]+)',x.lemma)
   if spelling and raw not in canonical:canonical[raw]=canonical.get(norm(spelling[1]),norm(spelling[1]))
   if not valid.fullmatch(raw) or pos not in 'NAVDPCRJTI':continue
   raw=canonical.get(raw,raw)
   if raw in force and force[raw]!=raw:continue
   i=ensure(raw,x.lemma,pos);result[i]=True
 return list(result)
for source in ['cc','wiki']:
 wordfile='crawl-words.json' if source=='cc' else 'wiki-words.json';vectorfile='crawl-vectors.npy' if source=='cc' else 'wiki-vectors.npy'
 words=json.loads((CACHE/wordfile).read_text());assign=np.full(len(words),-1,dtype=np.int32);weights=np.zeros(len(words),dtype=np.float32)
 for n,token in enumerate(words):
  w=norm(token)
  if not valid.fullmatch(w):continue
  fw=freq(w)
  if w not in observed:
   choices=analyze(token)
   if not choices and ((w in exact_frequency_words and fw>=2.2) or w in required):choices=[ensure(canonical.get(w,w))]
   if not choices:observed[w]=-1;continue
   forced=force.get(w)
   if forced in lemma_id:chosen=lemma_id[forced]
   else:chosen=max(choices,key=lambda i:(info[i]['freq']+(1.0 if info[i]['word']==w else 0),info[i]['word']==w,-i))
   observed[w]=chosen
  chosen=observed[w]
  if chosen<0:continue
  # A compound spelling can be assigned to its explicitly preferred dictionary root.
  if w in force and force[w] in lemma_id:chosen=lemma_id[force[w]];observed[w]=chosen
  assign[n]=chosen;weights[n]=10**(.20*(min(6.,fw)-3.))
  info[chosen]['maxfreq']=max(info[chosen]['maxfreq'],fw)
  head=canonical.get(w,w)
  if head in lemma_id:
   item=info[lemma_id[head]];existing=item[source+'_head']
   if existing is None or token==head:item[source+'_head']=n
  if (n+1)%250000==0:print('lexicon',source,n+1,'lemmas',len(info),'s',round(time.time()-T,1),flush=True)
 corpora[source]={'assign':assign,'weights':weights,'vectors':vectorfile,'count':len(words)}
 print('CORPUS',source,'tokens',len(words),'mapped',int((assign>=0).sum()),'lemmas',len(info),flush=True)
 del words
# Add reviewed corpus words that a stricter morphology marks as unknown; never fabricate vectors.
for w in required:
 w=canonical.get(w,w)
 if w not in lemma_id:print('MISSING REVIEWED',w,flush=True)
N=len(info);embeddings={};available={}
for source,c in corpora.items():
 matrix=np.load(CACHE/c['vectors'],mmap_mode='r');summed=np.zeros((N,300),dtype=np.float32);weight=np.zeros(N,dtype=np.float32)
 for start in range(0,c['count'],20000):
  end=min(start+20000,c['count']);ids=c['assign'][start:end];select=ids>=0
  if not select.any():continue
  indices=ids[select];v=np.array(matrix[start:end][select],dtype=np.float32);v/=np.maximum(np.linalg.norm(v,axis=1,keepdims=True),1e-12)
  ww=c['weights'][start:end][select];np.add.at(summed,indices,v*ww[:,None]);np.add.at(weight,indices,ww)
 sums_norm=np.linalg.norm(summed,axis=1);good=sums_norm>1e-9;summed[good]/=sums_norm[good,None]
 for i,item in enumerate(info):
  h=item[source+'_head']
  if h is None:continue
  v=np.array(matrix[h],dtype=np.float32);v/=max(np.linalg.norm(v),1e-12)
  summed[i]=.85*v+.15*summed[i] if good[i] else v;good[i]=True
 norms=np.linalg.norm(summed,axis=1);summed[good]/=norms[good,None]
 embeddings[source]=summed;available[source]=good
 print('EMBEDDED',source,int(good.sum()),'s',round(time.time()-T,1),flush=True)
 del matrix,weight;gc.collect()
keep=available['cc']|available['wiki'];ordered=sorted(np.flatnonzero(keep),key=lambda i:info[i]['word']);remap=np.full(N,-1,dtype=np.int32);remap[ordered]=np.arange(len(ordered));words=[info[i]['word'] for i in ordered]
cc=embeddings['cc'][ordered];wiki=embeddings['wiki'][ordered];cc_ok=available['cc'][ordered];wiki_ok=available['wiki'][ordered]
freqs=np.array([info[i]['freq'] for i in ordered],dtype=np.float32);maxfreq=np.array([info[i]['maxfreq'] for i in ordered],dtype=np.float32)
# Align shared frequent lemmas, so rare words missing in one release have a semantic estimate.
train=cc_ok&wiki_ok&(freqs>=3.)
u,s,vt=np.linalg.svd(cc[train].T@wiki[train],full_matrices=False);rotation=u@vt
wiki[~wiki_ok]=cc[~wiki_ok]@rotation;cc[~cc_ok]=wiki[~cc_ok]@rotation.T
cc/=np.maximum(np.linalg.norm(cc,axis=1,keepdims=True),1e-12);wiki/=np.maximum(np.linalg.norm(wiki,axis=1,keepdims=True),1e-12)
np.savez_compressed(CACHE/'lemma-vectors.npz',words=np.array(words),cc=cc,wiki=wiki,frequencies=freqs,max_frequencies=maxfreq,cc_observed=cc_ok,wiki_observed=wiki_ok,dictionary_verified=np.array([info[i]['dictionary'] for i in ordered],dtype=np.bool_))
(DATA/'lexicon.json').write_text(json.dumps(words,ensure_ascii=False,separators=(',',':'))+'\n')
print('VOCABULARY',len(words),'shared',int((cc_ok&wiki_ok).sum()),'projected_cc',int((~cc_ok).sum()),'projected_wiki',int((~wiki_ok).sum()),flush=True)
# Construct exact and accentless finite indexes on disk; avoid huge Python/Node alias maps.
dbpath=CACHE/'forms.sqlite';dbpath.unlink(missing_ok=True);db=sqlite3.connect(dbpath);db.execute('PRAGMA journal_mode=OFF');db.execute('PRAGMA synchronous=OFF');db.execute('PRAGMA cache_size=-60000')
db.execute('CREATE TABLE exact(form TEXT PRIMARY KEY, lemma INTEGER NOT NULL, priority REAL NOT NULL) WITHOUT ROWID')
insert='INSERT INTO exact VALUES(?,?,?) ON CONFLICT(form) DO UPDATE SET lemma=excluded.lemma,priority=excluded.priority WHERE excluded.priority>exact.priority'
batch=[];word_ids={w:i for i,w in enumerate(words)}
for i,w in enumerate(words):batch.append((w,i,100.+float(freqs[i])))
db.executemany(insert,batch);db.commit();batch=[]
for z,oldid in enumerate(ordered):
 item=info[oldid];newid=int(remap[oldid]);priority=float(item['freq'])
 for full in sorted(item['ids']):
  m.generate(full,None,m.NO_GUESSER,forms)
  for group in forms:
   raw=canonical.get(norm(m.rawLemma(group.lemma)),norm(m.rawLemma(group.lemma)))
   if raw!=item['word']:continue
   for form in group.forms:
    w=norm(form.form)
    if not valid.fullmatch(w):continue
    if w in force and force[w] in word_ids and force[w]!=w:continue
    batch.append((w,newid,priority))
    if len(batch)>=30000:db.executemany(insert,batch);batch=[]
 if z%10000==0:
  if batch:db.executemany(insert,batch);batch=[]
  db.commit();print('PARADIGMS',z,'forms',db.execute('SELECT COUNT(*) FROM exact').fetchone()[0],'s',round(time.time()-T,1),flush=True)
if batch:db.executemany(insert,batch);batch=[]
# Observed forms disambiguate rare competing generated paradigms, but never override exact lemmas.
for form,oldid in observed.items():
 if oldid<0 or remap[oldid]<0 or form in word_ids:continue
 batch.append((form,int(remap[oldid]),20.+float(info[oldid]['freq'])))
 if len(batch)>=30000:db.executemany(insert,batch);batch=[]
if batch:db.executemany(insert,batch)
for form,lemma in force.items():
 if lemma in word_ids and form not in word_ids:db.execute(insert,(form,word_ids[lemma],50.+float(freqs[word_ids[lemma]])))
db.commit();exact_count=db.execute('SELECT COUNT(*) FROM exact').fetchone()[0]
def strip(w):return ''.join(c for c in unicodedata.normalize('NFD',w) if not unicodedata.combining(c))
db.execute('CREATE TABLE accentless(form TEXT PRIMARY KEY,lemma INTEGER NOT NULL,priority REAL NOT NULL) WITHOUT ROWID');batch=[]
accinsert=insert.replace('exact','accentless')
for form,lemma,priority in db.execute('SELECT form,lemma,priority FROM exact'):
 # Prefer real headwords, then frequent lemmas, consistently across every target.
 score=(100. if form in word_ids else 0.)+float(freqs[lemma])
 batch.append((strip(form),lemma,score))
 if len(batch)>=30000:db.executemany(accinsert,batch);batch=[]
if batch:db.executemany(accinsert,batch)
db.commit()
def export_index(table,filename):
 count=db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0];offsets=np.zeros(count+1,dtype='<u4');ids=np.zeros(count,dtype='<u4');payload=CACHE/(table+'.strings')
 with payload.open('wb') as f:
  cursor=0
  for i,(word,lemma) in enumerate(db.execute(f'SELECT form,lemma FROM {table} ORDER BY form COLLATE BINARY')):
   b=word.encode('utf8');f.write(b);cursor+=len(b);offsets[i+1]=cursor;ids[i]=lemma
 with (DATA/filename).open('wb') as f:
  f.write(b'WGIDX001');f.write(struct.pack('<II',count,len(words)));f.write(offsets.tobytes());f.write(ids.tobytes())
  with payload.open('rb') as source:
   import shutil;shutil.copyfileobj(source,f)
 return count
exact_count=export_index('exact','forms.idx');accentless_count=export_index('accentless','accentless.idx')
meta={'vectorSources':{'cc':'fastText cc.cs.300.vec.gz, all 2000000 tokens','wiki':'fastText wiki.cs.vec, all 627841 tokens'},'morphology':model.name,'vocabularySize':len(words),'acceptedExactForms':exact_count,'aliasCount':exact_count-len(words),'accentlessSpellings':accentless_count,'wordfreq':'3.1.1','wordAcceptance':'No frequency threshold for dictionary-recognized words. Unrecognized loans/slang require an exact wordfreq entry with Zipf >= 2.2, or explicit review. Corpus fragments are not admitted using inferred compound frequency.','lemmaComposition':'85% normalized headword + 15% normalized weighted form mean; normalized. Without headword use normalized form mean.','projection':{'method':'Orthogonal Procrustes on shared lemmas with Zipf >= 3','trainingLemmas':int(train.sum()),'estimatedCC':int((~cc_ok).sum()),'estimatedWiki':int((~wiki_ok).sum())},'cacheSHA256':hashlib.sha256((CACHE/'lemma-vectors.npz').read_bytes()).hexdigest()}
(TOOLS/'resource-build.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n')
print('DONE',json.dumps(meta,ensure_ascii=False),'seconds',round(time.time()-T,1),flush=True)
