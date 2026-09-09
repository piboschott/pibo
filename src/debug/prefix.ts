import { parseArgs } from "node:util";
import { DatabaseSync } from "node:sqlite";
import { resolve, join } from "node:path";
import { lstat, realpath } from "node:fs/promises";
import { getPiboHome } from "../core/pibo-home.js";
import { inspectSessionPrefix } from "../sessions/prefix-inspection.js";
import { collectUnreferencedPrefixes } from "../sessions/prefix-gc.js";

/** Explicit database inventory: an absent or unfamiliar store never counts as empty. */
export async function runDebugPrefixCli(args: string[]): Promise<void> {
 const action=args[0];
 if(!action || action==="--help" || action==="-h") {
  process.stdout.write("pibo debug prefix — inspect protected session state\n\nCommands:\n  inventory  Count protected, unverified and recovery states\n  collect    Preview or remove unreferenced capsules\n\nNext:\n  pibo debug prefix inventory --help\n  pibo debug prefix collect --help\n");return;
 }
 if(!["inventory","collect"].includes(action))throw new Error("Unknown prefix action. Use pibo debug prefix --help");
 if(args.includes("--help")) {
  process.stdout.write(action==="inventory"
   ? "pibo debug prefix inventory [--database <path> ...] [--limit <1..200>] [--json]\n\nDefaults to pibo.sqlite in the current Pibo home. Counts metadata states; does not prove native history, artifact integrity or provider cache hits. Read-only; never reconstructs an old prefix.\n"
   : "pibo debug prefix collect --database <path> ... --complete-inventory [--root <path>] [--apply] [--json]\n\nList every session database referencing this prefix root. --complete-inventory explicitly declares that the list is exhaustive, including archived stores. Default is a dry run. --apply removes only unreferenced capsules; native histories and resource directories are retained. Missing or corrupt stores stop collection.\n");return;
 }
 const {values,positionals}=parseArgs({args:args.slice(1),allowPositionals:true,options:{database:{type:"string",multiple:true},root:{type:"string"},limit:{type:"string"},json:{type:"boolean"},apply:{type:"boolean"},"complete-inventory":{type:"boolean"}}});
 if(positionals.length)throw new Error("Unexpected prefix arguments");
 const databases=[...new Set((values.database??(action==="inventory"?[join(getPiboHome(),"pibo.sqlite")]:[])).map(path=>resolve(path)))];
 if(!databases.length || databases.length>128)throw new Error("Provide a bounded, explicit database inventory");
 if(action==="collect") {
  if(!values["complete-inventory"])throw new Error("Collection requires --complete-inventory and every database referencing this root");
  if(values.limit)throw new Error("Collection cannot use a partial --limit inventory");
  const result=await collectUnreferencedPrefixes({root:resolve(values.root??join(getPiboHome(),"session-prefixes")),databases,apply:values.apply});
  process.stdout.write(values.json?JSON.stringify({mode:values.apply?"apply":"dry-run",...result})+"\n":`${values.apply?"Applied":"Dry run"}: ${result.candidates} candidates, ${result.bytes} bytes, ${result.deleted} deleted, ${result.referenced} referenced\n`);return;
 }
 if(values.apply || values["complete-inventory"] || values.root)throw new Error("Inventory is read-only; root and collection flags belong to collect");
 const limit=Number(values.limit??20);if(!Number.isSafeInteger(limit)||limit<1||limit>200)throw new Error("Inventory limit must be 1..200");
 let total=0;const counts:Record<string,number>={},entries:unknown[]=[];
 for(const path of databases) {
  if(!(await lstat(path)).isFile() || await realpath(path)!==path)throw new Error("Inventory database must be an existing regular file without symlinks");
  const db=new DatabaseSync(path,{readOnly:true});
  try {
   let recognized=false;
   for(const table of ["session_runtime_bindings","pibo_session_runtime_bindings"]) {
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
    recognized=true;
    const sessions=table==="session_runtime_bindings"?"sessions":"pibo_sessions";
    const hasSessions=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(sessions));
    const query=hasSessions
     ? `SELECT s.id AS pibo_session_id,COALESCE(b.runtime_adapter_id,'unknown') AS adapter_id,b.native_session_id,COALESCE(b.binding_state,'bound') AS state,b.metadata_json FROM ${sessions} s LEFT JOIN ${table} b ON b.pibo_session_id=s.id ORDER BY s.id`
     : `SELECT pibo_session_id,runtime_adapter_id AS adapter_id,native_session_id,binding_state AS state,metadata_json FROM ${table} ORDER BY pibo_session_id`;
    for(const row of db.prepare(query).iterate()) {
     if(++total>1000000)throw new Error("Session inventory exceeds bounds");
     let metadata:unknown;try{metadata=JSON.parse(String(row.metadata_json??"{}"));}catch{metadata=false;}
     const state=inspectSessionPrefix({metadata,adapterId:String(row.adapter_id),nativeSessionId:typeof row.native_session_id==="string"?row.native_session_id:undefined,state:String(row.state)});
     counts[state.status]=(counts[state.status]??0)+1;
     if(entries.length<limit)entries.push({sessionId:String(row.pibo_session_id),adapterId:String(row.adapter_id),...state});
    }
   }
   if(!recognized)throw new Error("Inventory database has no recognized session binding table");
  }finally{db.close();}
 }
 const report={verification:"metadata-only",databases:databases.length,total,counts,entries,truncated:total>entries.length};
 process.stdout.write(values.json?JSON.stringify(report)+"\n":`Prefix inventory: ${total} sessions; metadata only\n${Object.entries(counts).map(([status,count])=>`${status}: ${count}`).join("\n")}\nUse --json for bounded session details. No historical prefix was reconstructed.\n`);
}
