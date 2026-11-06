const {test}=require('node:test');const assert=require('node:assert/strict');const https=require('node:https');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const {execFileSync}=require('node:child_process');const {desktopHttps}=require('../desktop-https.cjs');
test('self-signed trust is scoped and still enforces certificate identity',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task2do-tls-'));let server;
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});
  const cert=fs.readFileSync(path.join(dir,'cert.pem'),'utf8');let requests=0;
  server=https.createServer({key:fs.readFileSync(path.join(dir,'key.pem')),cert},(req,res)=>{requests++;res.setHeader('Content-Type','application/json');res.end('{"ok":true}');});
  await new Promise(resolve=>server.listen(0,resolve));const port=server.address().port,origin=`https://localhost:${port}`;
  await assert.rejects(desktopHttps(origin)({url:origin,method:'GET'}));assert.equal(requests,0);
  assert.equal((await desktopHttps(origin,cert)({url:origin,method:'GET'})).json.ok,true);assert.equal(requests,1);
  await assert.rejects(desktopHttps(`https://127.0.0.1:${port}`,cert)({url:`https://127.0.0.1:${port}`,method:'GET'}));assert.equal(requests,1);
  await assert.rejects(desktopHttps(origin,cert)({url:'https://other.invalid/api/v3',method:'GET'}),/unexpected/);
  assert.throws(()=>desktopHttps(origin,'-----BEGIN PRIVATE KEY-----'),/public certificate/);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
test('HTTPS transport does not follow redirects with credentials',async()=>{let server;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'task2do-tls-'));try{
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem'),'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'],{stdio:'ignore'});const cert=fs.readFileSync(path.join(dir,'cert.pem'),'utf8');server=https.createServer({key:fs.readFileSync(path.join(dir,'key.pem')),cert},(req,res)=>{res.writeHead(302,{Location:'https://other.invalid'});res.end();});await new Promise(resolve=>server.listen(0,resolve));const origin=`https://localhost:${server.address().port}`;assert.equal((await desktopHttps(origin,cert)({url:origin,headers:{Authorization:'fixture'}})).status,302);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}});
