import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const port=process.env.PORT||'4173';
const url=`http://localhost:${port}`;
let opened=false;
function openBrowser(){
 if(opened||process.env.NOOK_NO_BROWSER==='1')return;opened=true;
 const args=process.platform==='win32'?['cmd.exe',['/c','start','',url]]:process.platform==='darwin'?['open',[url]]:['xdg-open',[url]];
 const browser=spawn(args[0],args[1],{stdio:'ignore',windowsHide:true});browser.on('error',()=>console.log('Open '+url+' in your browser.'));
}
let alreadyRunning=false;
try {
 const health=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)});
 const data=await health.json();
 if(health.ok&&data.application==='Nook'&&data.mode==='local demo'){
  alreadyRunning=true;console.log('Nook is already running: '+url);openBrowser();
 }
} catch { /* No existing local Nook server. Start one below. */ }
if(!alreadyRunning){
const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:process.env,stdio:['inherit','pipe','inherit']});
child.stdout.on('data',data=>{process.stdout.write(data);if(data.toString().includes('Nook is ready:'))openBrowser();});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code||0;});
process.on('SIGINT',()=>child.kill('SIGINT'));
process.on('SIGTERM',()=>child.kill('SIGTERM'));
}
