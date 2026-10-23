from pathlib import Path
import argparse,json,struct,array,sys,csv
p=argparse.ArgumentParser(description='Export a precomputed daily ranking to readable UTF-8 CSV.');p.add_argument('--day',type=int,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
D=Path(__file__).resolve().parents[2]/'vystup';words=json.loads((D/'lexicon.json').read_text());b=(D/f'den_{a.day:02}.ranks.bin').read_bytes();assert b[:8]==b'WGRANK01' and struct.unpack_from('<I',b,8)[0]==len(words)
ranks=array.array('I');ranks.frombytes(b[12:])
if sys.byteorder!='little':ranks.byteswap()
order=sorted(range(len(words)),key=lambda i:ranks[i])
with a.output.open('w',encoding='utf-8',newline='') as f:
 w=csv.writer(f);w.writerow(['slovo','poradi']);w.writerows((words[i],ranks[i]) for i in order)
print(a.output.resolve())
