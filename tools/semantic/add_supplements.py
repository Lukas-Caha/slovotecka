"""Add reviewed new terms with definition-derived vectors, never random ranks."""
from pathlib import Path
import numpy as np,json,os,sqlite3,hashlib,unicodedata
from wordfreq import zipf_frequency
ROOT=Path(__file__).resolve().parents[2];P=Path(os.environ.get('WORDGAME_SEMANTIC_WORK',ROOT/'.semantic-build')).resolve();C=P/'cache';D=ROOT/'vystup';T=ROOT/'tools/semantic'
cache=np.load(C/'lemma-vectors.npz',allow_pickle=False);data={k:cache[k] for k in cache.files};cache.close();words=data['words'].tolist();idx={w:i for i,w in enumerate(words)}
supplements=json.loads((T/'supplements.json').read_text());added=[]
for item in supplements:
 word=item['word']
 if word in idx:continue
 missing=set(item['anchors'])-set(idx)
 if missing:raise ValueError(f'{word}: missing definition anchors {missing}')
 for model in ['cc','wiki']:
  vector=sum(float(weight)*data[model][idx[anchor]] for anchor,weight in item['anchors'].items());vector/=np.linalg.norm(vector)
  data[model]=np.concatenate([data[model],vector[None,:]],axis=0)
 f=zipf_frequency(word,'cs')
 for name,value in [('frequencies',f),('max_frequencies',f),('cc_observed',False),('wiki_observed',False),('dictionary_verified',False)]:data[name]=np.append(data[name],np.asarray(value,dtype=data[name].dtype))
 idx[word]=len(words);words.append(word);added.append(word)
if added:
 data['words']=np.array(words);temp=C/'lemma-vectors-supplemented.npz';np.savez_compressed(temp,**data);os.replace(temp,C/'lemma-vectors.npz')
 (D/'lexicon.json').write_text(json.dumps(words,ensure_ascii=False,separators=(',',':'))+'\n')
db=sqlite3.connect(C/'forms.sqlite');db.execute('PRAGMA journal_mode=OFF');db.execute('PRAGMA synchronous=OFF')
for item in supplements:
 i=idx[item['word']];f=float(data['frequencies'][i])
 for form in [item['word'],*item['forms']]:
  for table,key in [('exact',form),('accentless',''.join(c for c in unicodedata.normalize('NFD',form) if not unicodedata.combining(c)))]:
   priority=100.+f if form==item['word'] else 30.+f
   db.execute(f'INSERT INTO {table} VALUES(?,?,?) ON CONFLICT(form) DO UPDATE SET lemma=excluded.lemma,priority=excluded.priority WHERE excluded.priority>={table}.priority',(key,i,priority))
db.commit()
resource=json.loads((T/'resource-build.json').read_text());resource.update(vocabularySize=len(words),acceptedExactForms=db.execute('SELECT COUNT(*) FROM exact').fetchone()[0],accentlessSpellings=db.execute('SELECT COUNT(*) FROM accentless').fetchone()[0]);resource['aliasCount']=resource['acceptedExactForms']-len(words)
resource['reviewedDefinitionEmbeddings']={i['word']:i['anchors'] for i in supplements};resource['cacheSHA256']=hashlib.sha256((C/'lemma-vectors.npz').read_bytes()).hexdigest()
(T/'resource-build.json').write_text(json.dumps(resource,ensure_ascii=False,indent=2)+'\n')
print('Reviewed supplements',added,'vocabulary',len(words),'forms',resource['acceptedExactForms'],flush=True)
