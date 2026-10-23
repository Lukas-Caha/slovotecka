"""Validate all rank permutations, exact forms, dictionary pages and file hashes."""
from pathlib import Path
import json,csv,hashlib,struct,zlib,array,sys
ROOT=Path(__file__).resolve().parents[2];D=ROOT/'vystup';m=json.loads((D/'manifest.json').read_text());words=json.loads((D/'lexicon.json').read_text());N=len(words)
assert N==m['vocabularySize'] and len(set(words))==N
schedule=list(csv.reader((D/'harmonogram.csv').open()))[1:];assert len(schedule)==m['days']==30
for filename,digest in m['files'].items():assert hashlib.sha256((D/filename).read_bytes()).hexdigest()==digest,filename
index={w:i for i,w in enumerate(words)};metadata=json.loads((D/'words.json').read_text())['targets']
for day,target in schedule:
 b=(D/f'den_{int(day):02}.ranks.bin').read_bytes();assert b[:8]==b'WGRANK01';assert struct.unpack_from('<I',b,8)[0]==N
 ranks=array.array('I');ranks.frombytes(b[12:])
 if sys.byteorder!='little':ranks.byteswap()
 assert len(ranks)==N and ranks[index[target]]==1 and sorted(ranks)==list(range(1,N+1))
 for hint in metadata[target]['hintWords']:assert hint in index and ranks[index[hint]]>1
 radar=metadata[target]['radarWord'];assert 50<=ranks[index[radar]]<=1500
for stem,expected in [('forms',m['acceptedForms']),('accentless',m['source']['accentlessSpellings'])]:
 meta=json.loads((D/f'{stem}.pages.json').read_text());assert meta['vocabularySize']==N and meta['count']==expected
 count=0;previous=None
 data_files=meta['dataFiles'] if meta['format']=='WG-PAGES-2' else [meta['dataFile']]
 from contextlib import ExitStack
 with ExitStack() as stack:
  handles=[stack.enter_context((D/name).open('rb')) for name in data_files]
  for page in meta['pages']:
   f=handles[page.get('file',0)]
   f.seek(page['offset']);b=zlib.decompress(f.read(page['length']));assert b[:8]==b'WGIDX001'
   n,v=struct.unpack_from('<II',b,8);assert n==page['count'] and v==N
   offsets=struct.unpack_from('<'+'I'*(n+1),b,16);values=struct.unpack_from('<'+'I'*n,b,16+4*(n+1));start=16+4*(n+1)+4*n
   assert offsets[0]==0 and offsets[-1]+start==len(b) and max(values)<N
   for i in range(n):
    word=b[start+offsets[i]:start+offsets[i+1]];assert word
    if previous is not None:assert previous<word
    previous=word
   assert b[start+offsets[0]:start+offsets[1]].decode()==page['first'];count+=n
 assert count==expected
print(f'OK: {m["days"]} days, {N} ranked lemmas, {m["acceptedForms"]} exact spellings, all pages and SHA-256 hashes.')
