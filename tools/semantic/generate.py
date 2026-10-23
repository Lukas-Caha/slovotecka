"""Generate a 30-day Czech Contexto dataset using the complete prebuilt model cache."""
from pathlib import Path
import argparse,datetime,csv,json,hashlib,struct,shutil,tempfile,os,sqlite3
import numpy as np
ROOT=Path(__file__).resolve().parents[2];D=ROOT/'vystup';TOOLS=ROOT/'tools/semantic'
parser=argparse.ArgumentParser();parser.add_argument('--work-dir',type=Path,default=Path(os.environ.get('WORDGAME_SEMANTIC_WORK',ROOT/'.semantic-build')));parser.add_argument('--start-date',default='2026-10-23');parser.add_argument('--cc-weight',type=float,default=.65);args=parser.parse_args();P=args.work_dir.resolve()
start=datetime.date.fromisoformat(args.start_date);config=list(csv.reader((TOOLS/'targets.tsv').open(),delimiter='\t'));assert len(config)==30
cache=np.load(P/'cache/lemma-vectors.npz',allow_pickle=False);words=cache['words'].tolist();cc=cache['cc'];wiki=cache['wiki'];freq=cache['frequencies'];mf=cache['max_frequencies'];idx={w:i for i,w in enumerate(words)}
resource=json.loads((TOOLS/'resource-build.json').read_text());senses=dict(csv.reader((TOOLS/'senses.tsv').open(),delimiter='\t'))
# Canonical spelling and infinitive variants resolved without reference to the day's target.
database=sqlite3.connect(P/'cache/forms.sqlite')
def canonical_input(w):
 if w in idx:return w
 row=database.execute('SELECT lemma FROM exact WHERE form=?',(w,)).fetchone()
 return words[row[0]] if row else w
alternate={'chleba':'chléb','kuchyně':'kuchyň','péci':'péct','říci':'říct','moci':'moct','kartón':'karton'}
reviews=[];metadata={};files={};out=P/'generated'
if out.exists():shutil.rmtree(out)
out.mkdir(exist_ok=True)
radar_file=TOOLS/'radar.tsv';reviewed_radars=dict(csv.reader(radar_file.open(),delimiter='\t')) if radar_file.exists() else {}
for day,row in enumerate(config,1):
 target,gender,category,seedtext=row
 seeds=list(dict.fromkeys(canonical_input(w) for w in seedtext.split() if canonical_input(w)!=target));missing=[w for w in seeds if w not in idx];assert not missing,(target,missing)
 seeds=[w for w in seeds if w in idx];cidx=[idx[w] for w in seeds];sense=senses.get(target)
 scores=[]
 for matrix in [cc,wiki]:
  centroid=matrix[cidx].mean(0);centroid/=np.linalg.norm(centroid)
  query=.35*matrix[idx[target]]+.25*matrix[idx[sense]]+.40*centroid if sense else .60*matrix[idx[target]]+.40*centroid
  query/=np.linalg.norm(query);scores.append(matrix@query)
 score=args.cc_weight*scores[0]+(1-args.cc_weight)*scores[1]-.025*np.maximum(0,3.-mf)-.03*(~cache['dictionary_verified'])
 order=np.lexsort((np.arange(len(words)),-score));order=order[order!=idx[target]];order=np.insert(order,0,idx[target]);rank=np.empty(len(words),dtype='<u4');rank[order]=np.arange(1,len(words)+1,dtype=np.uint32)
 filename=f'den_{day:02}.ranks.bin'
 with (out/filename).open('wb') as f:f.write(b'WGRANK01');f.write(struct.pack('<I',len(words)));f.write(rank.tobytes())
 ordered=[words[i] for i in order[:2500]];radar=reviewed_radars.get(target)
 if radar:
  assert radar in idx and 50<=int(rank[idx[radar]])<=1500,(target,radar,int(rank[idx[radar]]))
 else:radar=ordered[149]
 hintwords=list(dict.fromkeys(ordered[1:6]+[w for w in seeds if 1<int(rank[idx[w]])<=500]+[radar]))
 metadata[target]={'word':target,'gender':gender,'category':category,'radarWord':radar,'hintWords':hintwords}
 reviews.append({'day':day,'date':(start+datetime.timedelta(days=day-1)).isoformat(),'target':target,'top50':[{'word':w,'rank':int(rank[idx[w]])} for w in ordered[:50]],'radar':{'word':radar,'rank':int(rank[idx[radar]])},'anchorRanks':{w:int(rank[idx[w]]) for w in seeds},'rank100to400':[{'word':w,'rank':int(rank[idx[w]])} for w in ordered[99:400:5]]})
 files[filename]=hashlib.sha256((out/filename).read_bytes()).hexdigest()
with (out/'harmonogram.csv').open('w',newline='') as f:
 writer=csv.writer(f,lineterminator='\n');writer.writerow(['den','slovo']);writer.writerows((i,r[0]) for i,r in enumerate(config,1))
(out/'words.json').write_text(json.dumps({'dailyTargetWords':[r[0] for r in config],'targets':metadata},ensure_ascii=False,indent=2)+'\n')
(out/'review.json').write_text(json.dumps(reviews,ensure_ascii=False,indent=2)+'\n')
for filename in ['harmonogram.csv','words.json','review.json']:files[filename]=hashlib.sha256((out/filename).read_bytes()).hexdigest()
dictionary_files=['lexicon.json','input-aliases.json']
for stem in ['forms','accentless']:
 pagefile=f'{stem}.pages.json';page_meta=json.loads((D/pagefile).read_text())
 dictionary_files.append(pagefile)
 dictionary_files.extend(page_meta['dataFiles'] if page_meta['format']=='WG-PAGES-2' else [page_meta['dataFile']])
for filename in dictionary_files:
 if (D/filename).exists():files[filename]=hashlib.sha256((D/filename).read_bytes()).hexdigest()
config_hash=hashlib.sha256(Path(__file__).read_bytes()+(TOOLS/'targets.tsv').read_bytes()+(radar_file.read_bytes() if radar_file.exists() else b'')+(TOOLS/'senses.tsv').read_bytes()+json.dumps(files,sort_keys=True).encode()).hexdigest()[:16]
manifest={'version':f'cz-context-v3-{start.isoformat()}-{config_hash}','storage':'indexed-ranks-v1','startDate':start.isoformat(),'endDate':(start+datetime.timedelta(days=29)).isoformat(),'days':30,'vocabularySize':len(words),'acceptedForms':resource['acceptedExactForms'],'aliasCount':resource['aliasCount'],'source':resource,'ranking':{'query':'Each model: normalize(0.60 target + 0.40 normalized association mean). Sense cue when configured: normalize(0.35 target + 0.25 cue + 0.40 association mean).','score':f'{args.cc_weight} * CC cosine + {1-args.cc_weight:.3f} * Wiki cosine - 0.025 * max(0, 3.0 - maximum form Zipf) - 0.03 for words without dictionary analysis','head':'Only answer is forced to rank 1. All other ranks are computed. No manual rank swaps.','ties':'Stable vocabulary ID order; base words are lexical, reviewed additions appended in declared order.','hints':'Reviewed thematic words, their true computed ranks.'},'files':files}
(out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
D.mkdir(exist_ok=True)
for f in out.iterdir():shutil.copyfile(f,D/f.name)
(ROOT/'src/data/words.json').write_bytes((out/'words.json').read_bytes())
print(json.dumps({k:manifest[k] for k in ['version','startDate','endDate','days','vocabularySize','acceptedForms']},ensure_ascii=False),flush=True)
