import fs from 'node:fs';import path from 'node:path';import {execFileSync} from 'node:child_process';import{fileURLToPath}from'node:url';
const requireThat=(value,message)=>{if(!value)throw Error(message);};
export function checkHistory(root, base) {
  requireThat(/^[0-9a-f]{40}$/.test(base), 'Expected an exact base commit.');
  requireThat(!/^0{40}$/.test(base), 'Expected a nonzero commit.');
  const git=(...args)=>execFileSync('git',['-C',root,...args],{maxBuffer:32*1024*1024});
  const revisions=git('log','--format=%H',base,'--','packages').toString().trim().split(/\r?\n/).filter(Boolean);
  const source=JSON.parse(fs.readFileSync(path.join(root,'source.json'),'utf8'));
  for(const revision of revisions) {
  const files=git('ls-tree','-r','--name-only','-z',revision,'--','packages').toString().split('\0').filter(Boolean);
  const previousSource=JSON.parse(git('show',revision+':source.json'));
  for(const name of files) {
    requireThat(/^packages\/com\.unlibra\.[a-z0-9.-]+\/\d+\.\d+\.\d+\.json$/.test(name),'Unexpected published history path.');
    const target=path.join(root,name), id=name.split('/')[1];
    requireThat(fs.existsSync(target)&&fs.lstatSync(target).isFile()&&!fs.lstatSync(target).isSymbolicLink()&&
      fs.readFileSync(target).equals(git('show',revision+':'+name)), 'Published version changed or removed: '+name);
    requireThat(source.packages?.[id]?.repository===previousSource.packages?.[id]?.repository,
      'Published package source changed or removed: '+id);
  }
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {checkHistory(path.dirname(path.dirname(fileURLToPath(import.meta.url))),process.argv[2]);console.log('Published history retained unchanged.');}
  catch(error){console.error(error.message);process.exitCode=1;}
}
