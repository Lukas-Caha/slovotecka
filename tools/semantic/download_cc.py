import gzip,urllib.request,numpy as np,json,time,pathlib,os
p=pathlib.Path(os.environ.get('WORDGAME_SEMANTIC_WORK','.semantic-build')).resolve()/'cache'
p.mkdir(parents=True,exist_ok=True)
if (p/'crawl-vectors.npy').exists() and (p/'crawl-words.json').exists():
 if np.load(p/'crawl-vectors.npy',mmap_mode='r').shape==(2000000,300):
  print('Using cached Common Crawl vectors');raise SystemExit(0)
limit=2000000
a=np.lib.format.open_memmap(p/'crawl-vectors.npy',mode='w+',dtype='float32',shape=(limit,300))
words=[];t=time.time()
url='https://dl.fbaipublicfiles.com/fasttext/vectors-crawl/cc.cs.300.vec.gz?wordgame=20261023-all-2m'
with urllib.request.urlopen(url,timeout=45) as response:
 with gzip.GzipFile(fileobj=response) as g:
  header=g.readline().decode().split();assert header==['2000000','300'],header
  for i in range(limit):
   line=g.readline();word,sep,values=line.partition(b' ')
   if not sep:raise RuntimeError('Unexpected vector EOF')
   vector=np.fromstring(values.decode('ascii'),sep=' ',dtype=np.float32)
   if len(vector)!=300:raise RuntimeError(f'Bad vector at {i}')
   words.append(word.decode('utf-8'));a[i]=vector
   if (i+1)%200000==0:print('vectors',i+1,'elapsed_s',round(time.time()-t,1),flush=True)
a.flush();(p/'crawl-words.json').write_text(json.dumps(words,ensure_ascii=False))
print('READY',len(words),flush=True)
