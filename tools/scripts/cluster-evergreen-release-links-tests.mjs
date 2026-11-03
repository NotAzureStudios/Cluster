// Prevent release-specific URLs from leaking back into evergreen README downloads.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=p=>readFileSync(path.join(root,p),'utf8');
const readme=read('README.md'), install=read('docs/INSTALLATION.md');
const repo='https://github.com/NotAzureStudios/Cluster';
for(const [name,contents] of [['README.md',readme],['docs/INSTALLATION.md',install]]){
 assert.match(contents,new RegExp(repo.replace(/[.*+?^$\{\}()|[\]\\]/g,'\\$&')+'/releases/latest'),name+' must link to latest release');
 assert.ok(contents.includes(repo+'/releases/latest/download/Cluster-Installer.exe'),name+' must link directly to latest Server installer');
 assert.doesNotMatch(contents,/releases\/(?:download|tag)\/v\d+\.\d+\.\d+/i,name+' contains a pinned, stale release link');
 assert.doesNotMatch(contents,/releases\/latest\/download\/Cluster-Desktop-Installer-\d/i,name+' assumes fixed Desktop component version');
}
assert.ok(readme.includes('docs/development/WINDOWS_CODE_SIGNING.md'),'README must link signing guide');
assert.ok(readme.includes('docs/development/RELEASE_ASSET_NAMING.md'),'README must explain permanent asset naming');
console.log('Evergreen README and installation download links verified.');
