"""Build ready-to-run daily game data; live Node server does not need Python."""
from pathlib import Path
import argparse,subprocess,os,sys,datetime
from zoneinfo import ZoneInfo
root=Path(__file__).resolve().parent;project=root.parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--start-date',default=datetime.datetime.now(ZoneInfo('Europe/Prague')).date().isoformat())
p.add_argument('--work-dir',type=Path,default=project/'.semantic-build')
p.add_argument('--rebuild-vocabulary',action='store_true')
a=p.parse_args();a.work_dir=a.work_dir.resolve();env=os.environ.copy();env['WORDGAME_SEMANTIC_WORK']=str(a.work_dir);env.setdefault('OPENBLAS_NUM_THREADS','2')
def run(name,*args):subprocess.run([sys.executable,str(root/name),*args],env=env,check=True,cwd=project)
if a.rebuild_vocabulary or not (a.work_dir/'cache/lemma-vectors.npz').exists():
 for name in ['download_cc.py','download_wiki.py','download_morphology.py','build_resources.py']:run(name)
run('add_supplements.py');run('export_pages.py');run('input_aliases.py');run('generate.py','--start-date',a.start_date)
run('verify.py')
