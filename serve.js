const http=require('http'),fs=require('fs'),path=require('path');
const root=__dirname;
http.createServer((req,res)=>{
  let f=decodeURIComponent(req.url.split('?')[0]);
  if(f==='/')f='/index.html';
  const p=path.join(root,f);
  fs.readFile(p,(e,d)=>{
    if(e){res.writeHead(404);res.end('not found');return;}
    const ext=path.extname(p).toLowerCase();
    const ct={'.html':'text/html','.js':'text/javascript','.css':'text/css'}[ext]||'application/octet-stream';
    res.writeHead(200,{'Content-Type':ct});res.end(d);
  });
}).listen(4599,()=>console.log('serving on 4599'));
