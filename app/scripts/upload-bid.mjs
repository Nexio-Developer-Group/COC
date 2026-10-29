import { createClient } from "@supabase/supabase-js";
import fs from "fs"; import path from "path";
const [,, base, tender, file, party] = process.argv;
const env = Object.fromEntries(fs.readFileSync(".env.local","utf8").split("\n").filter(l=>l.includes("=")).map(l=>[l.slice(0,l.indexOf("=")),l.slice(l.indexOf("=")+1).replace(/^"|"$/g,"")]));
const post = async (u,b)=>{const r=await fetch(base+u,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)});return {ok:r.ok,data:await r.json().catch(()=>({}))}};
const name = path.basename(file);
const s = await post(`/api/tenders/${tender}/documents/sign`,{file_name:name});
if(!s.ok) throw new Error("sign "+JSON.stringify(s.data));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
const buf = fs.readFileSync(file);
const up = await sb.storage.from("tender-files").uploadToSignedUrl(s.data.storage_path, s.data.token, new Blob([buf]), {contentType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
if(up.error) throw up.error;
const reg = await post(`/api/tenders/${tender}/documents`,{document_id:s.data.document_id,storage_path:s.data.storage_path,file_name:name,mime_type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",size:buf.length,role:"bid",party_name:party||null,replace_document_id:null});
if(!reg.ok) throw new Error("reg "+JSON.stringify(reg.data));
for(let i=0;i<80;i++){const r=await post(`/api/documents/${s.data.document_id}/process`,{});if(!r.ok) throw new Error("proc "+JSON.stringify(r.data));console.log(name,r.data.phase,r.data.completed,"/",r.data.total);if(r.data.done){if(r.data.phase==="failed")throw new Error(r.data.detail);break;}}
console.log("DONE",s.data.document_id);
