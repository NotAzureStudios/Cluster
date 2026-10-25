import json,subprocess,time,concurrent.futures,pathlib,sys,os
p=pathlib.Path('TD4_R61_REGRESSION_RESULTS.json')
base=json.loads(p.read_text())
scripts=[r['script'] for r in base['results']]+['tools/scripts/cluster-td4-r62-hierarchy-lifecycle-tests.mjs','tools/scripts/cluster-td4-r62-hierarchy-ui-integration-tests.mjs']
# Preserve chronological regression inventory order, separate tests for new behavior
scripts=list(dict.fromkeys(scripts))
def run(s):
 t=time.monotonic();r=subprocess.run(['node',s],capture_output=True,text=True,timeout=120,env={**os.environ,'NODE_OPTIONS':'--experimental-strip-types'})
 return {'script':s,'passed':r.returncode==0,'seconds':round(time.monotonic()-t,2),'returncode':r.returncode,'lastOutput':r.stdout.strip().splitlines()[-1] if r.stdout.strip() else '', 'stderr':r.stderr[-2000:]}
local_typescript=pathlib.Path('node_modules/typescript')
created_link=False
if not local_typescript.exists():
 global_root=subprocess.check_output(['npm','root','-g'],text=True).strip()
 installed=pathlib.Path(global_root,'typescript')
 if not installed.is_dir():
  sys.exit('Cannot run lean R62 regression suite: TypeScript development dependency is not installed')
 local_typescript.parent.mkdir(parents=True,exist_ok=True)
 local_typescript.symlink_to(installed, target_is_directory=True)
 created_link=True
try:
 with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:results=list(pool.map(run,scripts))
finally:
 if created_link:local_typescript.unlink()
data={'toolchain':'Node v22.16.0 source-level suite; Node 24/PostgreSQL/Windows certification not performed','total':len(results),'passed':sum(r['passed'] for r in results),'results':results}
pathlib.Path('TD4_R62_REGRESSION_RESULTS.json').write_text(json.dumps(data,indent=2)+'\n')
for r in results: print(('PASS' if r['passed'] else 'FAIL'),r['script'],r['lastOutput'],r['stderr'][:180])
print(data['passed'],'/',data['total'],'SUITES PASSED')
sys.exit(data['total']!=data['passed'])
