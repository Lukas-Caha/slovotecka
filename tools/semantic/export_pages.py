"""Convert the large paradigm tables to compressed pages with a bounded runtime cache."""
from pathlib import Path
import os,sqlite3,json,struct,zlib,array,hashlib,time
from split_pages import split_dictionary
P=Path(os.environ.get('WORDGAME_SEMANTIC_WORK','.semantic-build')).resolve();D=Path(__file__).resolve().parents[2]/'vystup';db=sqlite3.connect(P/'cache/forms.sqlite');N=len(json.loads((D/'lexicon.json').read_text()));T=time.time()
for table,stem in [('exact','forms'),('accentless','accentless')]:
 pages=[];total=0;rows=[];datafile=stem+'.pages.bin'
 with (D/datafile).open('wb') as output:
  def flush():
   global total
   if not rows:return
   offsets=array.array('I',[0]);values=array.array('I');strings=bytearray()
   for word,lemma in rows:
    strings.extend(word.encode('utf8'));offsets.append(len(strings));values.append(lemma)
   import sys
   if sys.byteorder!='little':offsets.byteswap();values.byteswap()
   raw=b'WGIDX001'+struct.pack('<II',len(rows),N)+offsets.tobytes()+values.tobytes()+strings
   packed=zlib.compress(raw,6);offset=output.tell();output.write(packed)
   pages.append({'first':rows[0][0],'offset':offset,'length':len(packed),'count':len(rows)})
   total+=len(rows);rows.clear()
  for row in db.execute(f'SELECT form,lemma FROM {table} ORDER BY form COLLATE BINARY'):
   rows.append(row)
   if len(rows)>=2048:flush()
  flush()
 meta={'format':'WG-PAGES-1','vocabularySize':N,'count':total,'pageSize':2048,'dataFile':datafile,'pages':pages}
 (D/(stem+'.pages.json')).write_text(json.dumps(meta,ensure_ascii=False,separators=(',',':'))+'\n')
 (D/(stem+'.idx')).unlink(missing_ok=True)
 print(stem,'forms',total,'pages',len(pages),'MiB',round((D/datafile).stat().st_size/2**20,2),'s',round(time.time()-T,1),flush=True)
 split_dictionary(D,stem)
