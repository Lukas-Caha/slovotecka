from pathlib import Path
import numpy as np,os,json,sqlite3,unicodedata,re
from ufal.morphodita import Morpho,TaggedLemmas
P=Path(os.environ.get('WORDGAME_SEMANTIC_WORK','.semantic-build')).resolve();ROOT=Path(__file__).resolve().parents[2];D=ROOT/'vystup';cache=np.load(P/'cache/lemma-vectors.npz',allow_pickle=False);words=cache['words'].tolist();freq=cache['frequencies'];ids={w:i for i,w in enumerate(words)}
m=Morpho.load(str(next((P/'cache/morph').rglob('*.dict'))));a=TaggedLemmas();common=[]
for w in words:
 m.analyze(w,m.NO_GUESSER,a)
 common.append(any(m.rawLemma(x.lemma).lower()==w and x.tag[0] in 'NAVDPCRJTI' and not re.search(r';[A-Z]',x.lemma) for x in a))
def plain(w):return ''.join(c for c in unicodedata.normalize('NFD',w) if not unicodedata.combining(c))
best={}
for i,w in enumerate(words):
 key=plain(w)
 if key!=w and common[i] and (key not in best or freq[i]>freq[best[key]]):best[key]=i
aliases={};db=sqlite3.connect(P/'cache/forms.sqlite')
for key,i in best.items():
 if key in ids and common[ids[key]]:continue
 exact=db.execute('SELECT lemma FROM exact WHERE form=?',(key,)).fetchone()
 if not exact:continue
 actual=exact[0]
 if actual!=i and (not common[actual] or freq[i]>=freq[actual]+1.5):aliases[key]=words[i]
import csv
for spelling,canonical in csv.reader((ROOT/'tools/semantic/input-preferences.tsv').open(),delimiter='\t'):
 assert canonical in ids
 aliases[spelling]=canonical
(D/'input-aliases.json').write_text(json.dumps(aliases,ensure_ascii=False,separators=(',',':'))+'\n')
print('stable unaccented overrides',len(aliases),{w:aliases.get(w) for w in ['kava','skola','chleb','dest','reka','more','psi','byt']},flush=True)
