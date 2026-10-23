from pathlib import Path
import urllib.request,os,zipfile,shutil
p=Path(os.environ.get('WORDGAME_SEMANTIC_WORK','.semantic-build')).resolve()/'cache';p.mkdir(parents=True,exist_ok=True)
if list((p/'morph').rglob('czech-morfflex2.1-250909.dict')):print('Using cached MorfFlex 2.1');raise SystemExit(0)
url='https://lindat.mff.cuni.cz/repository/server/api/core/bitstreams/a5d20e52-fc3d-4bc4-9df9-5b4c36839dcc/content'
with urllib.request.urlopen(url,timeout=45) as response,(p/'morph.zip').open('wb') as output:shutil.copyfileobj(response,output)
with zipfile.ZipFile(p/'morph.zip') as archive:
 for item in archive.infolist():
  name=Path(item.filename)
  if not name.is_absolute() and '..' not in name.parts and item.filename.endswith(('czech-morfflex2.1-250909.dict','LICENSE','README')):archive.extract(item,p/'morph')
print('MorfFlex 2.1 ready')
