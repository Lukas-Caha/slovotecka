import pathlib,time,urllib.request,json,os,numpy as np
p=pathlib.Path(os.environ.get('WORDGAME_SEMANTIC_WORK','.semantic-build')).resolve()/'cache';p.mkdir(parents=True,exist_ok=True);t=time.time();words=[]
if (p/'wiki-vectors.npy').exists() and (p/'wiki-words.json').exists():
 if np.load(p/'wiki-vectors.npy',mmap_mode='r').shape==(627841,300):
  print('Using cached Wiki vectors');raise SystemExit(0)
with urllib.request.urlopen('https://dl.fbaipublicfiles.com/fasttext/vectors-wiki/wiki.cs.vec?wordgame-v3=20261023',timeout=45) as response:
 count,d=map(int,response.readline().split());print('wiki header',count,d,flush=True)
 a=np.lib.format.open_memmap(p/'wiki-vectors.npy',mode='w+',dtype='float32',shape=(count,d))
 for i in range(count):
  word,sep,values=response.readline().partition(b' ')
  if not sep:raise RuntimeError(f'Bad row {i}')
  v=np.fromstring(values.decode('ascii'),dtype=np.float32,sep=' ')
  if len(v)!=d:raise RuntimeError(f'Bad vector {i}')
  a[i]=v;words.append(word.decode('utf8'))
  if (i+1)%200000==0:print('wiki',i+1,'seconds',round(time.time()-t,1),flush=True)
 a.flush()
(p/'wiki-words.json').write_text(json.dumps(words,ensure_ascii=False))
print('WIKI READY',len(words),round(time.time()-t,1),flush=True)
