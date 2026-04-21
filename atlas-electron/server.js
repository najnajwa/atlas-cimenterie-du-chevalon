require('dotenv').config({ path: process.env.ATLAS_USER_DATA ? require('path').join(process.env.ATLAS_USER_DATA, '.env') : require('path').join(__dirname, '.env') });

const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const sharp   = require('sharp');

const PORT      = parseInt(process.env.PORT) || 3737;
const API_KEY   = process.env.MAMMOUTH_API_KEY;

// Use injected paths (Electron) or fallback to local (dev)
const USER_DATA = process.env.ATLAS_USER_DATA || __dirname;
const DATA_FILE = process.env.ATLAS_DATA_FILE || path.join(__dirname, 'atlas_data.json');
const UPLOADS   = process.env.ATLAS_UPLOADS   || path.join(__dirname, 'uploads');
const ASSETS    = process.env.ATLAS_ASSETS    || path.join(__dirname, 'public', 'assets');
const THUMBS    = path.join(UPLOADS, '_thumbs');

const MAMMOUTH_URL   = 'https://api.mammouth.ai/v1/chat/completions';
const MAMMOUTH_MODEL = 'gpt-4.1';

const IMAGE_EXTS = new Set(['.jpg','.jpeg','.png','.webp','.tiff','.tif','.bmp']);
const RAW_EXTS   = new Set(['.nef','.cr2','.cr3','.arw','.dng','.raf','.rw2']);
const VIDEO_EXTS = new Set(['.mov','.mp4','.avi','.mkv']);

[UPLOADS, THUMBS, ASSETS].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ─── Default taxonomy ─────────────────────────────────────────────────────────
const DEFAULT_TAXONOMY = [
  { id:'structural', label:'Structural Elements', subs:[
    { id:'masonry', label:'Masonry', elements:['Hollow concrete block','Solid brick','Rubble stone','Dressed stone','Concrete block wall','Brick wall','Stone wall','Concrete column','Concrete beam','Concrete slab','Concrete foundation'] },
    { id:'metal_frame', label:'Metal Frame', elements:['Steel beam','Steel column','Steel truss','Steel lattice girder','Steel purlin','Steel tie rod','Cast iron column','Metal deck','Corrugated metal sheet'] },
    { id:'floor_roof', label:'Floor & Roof', elements:['Concrete floor slab','Tile floor','Brick floor','Corrugated roof sheet','Flat concrete roof','Timber roof structure','Skylight frame','Gutter'] },
  ]},
  { id:'envelope', label:'Building Envelope', subs:[
    { id:'openings', label:'Openings', elements:['Steel window frame','Wooden window frame','Broken window glass','Door frame steel','Door frame wood','Rolling shutter','Loading bay door','Vent opening','Skylight','Glass block panel'] },
    { id:'cladding', label:'Cladding & Partition', elements:['Plaster wall','Painted concrete wall','Tiled wall','Brick partition','Corrugated cladding panel','Cement board panel'] },
  ]},
  { id:'industrial', label:'Industrial Machinery', subs:[
    { id:'production', label:'Production Equipment', elements:['Rotary kiln','Cement mill','Ball mill','Crusher','Hammer mill','Bucket elevator','Belt conveyor','Screw conveyor','Vibrating screen','Cyclone separator','Electrostatic precipitator','Preheater tower'] },
    { id:'storage', label:'Storage & Silos', elements:['Cement silo','Raw material silo','Clinker silo','Storage tank','Hopper','Bin','Bunker'] },
    { id:'utilities', label:'Utilities & Distribution', elements:['Large diameter pipe','Small diameter pipe','Duct','Cable tray','Electrical panel','Transformer','Pump','Compressor','Valve','Chimney stack'] },
    { id:'transport', label:'On-site Transport', elements:['Rail track','Rail car','Bridge crane beam','Crane runway beam','Overhead conveyor structure','Loading platform'] },
  ]},
  { id:'vegetation', label:'Vegetation & Regeneration', subs:[
    { id:'trees_shrubs', label:'Trees & Shrubs', elements:['Mature tree (trunk)','Young tree','Dense shrub','Climbing plant on wall','Ivy','Wild bramble','Elder bush'] },
    { id:'ground_cover', label:'Ground Cover', elements:['Moss','Lichen on concrete','Lichen on metal','Grass tuft','Fern','Wildflowers','Leaf litter accumulation'] },
    { id:'water', label:'Water & Humidity', elements:['Stagnant water pool','Water infiltration trace','Efflorescence','Calcite deposit','Rust stain','Algae growth'] },
  ]},
  { id:'degradation', label:'Degradation & Texture', subs:[
    { id:'concrete_deg', label:'Concrete Degradation', elements:['Surface crack','Structural crack','Spalling concrete','Exposed rebar','Carbonation','Concrete efflorescence','Delamination'] },
    { id:'metal_deg', label:'Metal Degradation', elements:['Surface rust','Deep corrosion','Perforated metal','Deformed metal','Paint peel on metal','Welded joint','Rivet'] },
    { id:'surface_texture', label:'Surface Texture', elements:['Raw concrete texture','Shuttering imprint','Aggregate exposed concrete','Painted surface','Graffiti tag','Graffiti mural','Soot deposit','Dust accumulation'] },
  ]},
  { id:'debris_waste', label:'Debris & Waste', subs:[
    { id:'construction_debris', label:'Construction Debris', elements:['Broken concrete fragment','Brick rubble','Metal scrap piece','Timber offcut','Glass shard','Roof tile fragment','Plaster chunk'] },
    { id:'industrial_waste', label:'Industrial Waste', elements:['Clinker residue','Cement dust deposit','Oil drum','Chemical drum','Abandoned vehicle part','Electrical cable scrap'] },
    { id:'general_waste', label:'General Waste', elements:['Plastic waste','Paper waste','Abandoned personal object','Abandoned furniture','Abandoned tool'] },
  ]},
  { id:'spatial', label:'Spatial Elements', subs:[
    { id:'circulation', label:'Circulation', elements:['Staircase concrete','Staircase metal','Ramp','Catwalk','Ladder','Corridor','Passage opening'] },
    { id:'light_atmosphere', label:'Light & Atmosphere', elements:['Zenithal light','Lateral light through opening','Shadow pattern','Dust in light','Dramatic contrast'] },
    { id:'void_space', label:'Void & Space', elements:['Large interior volume','Mezzanine level','Pit','Shaft','Trench','Collapsed zone','Partially open roof'] },
  ]},
];

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { photos:[], taxonomy:DEFAULT_TAXONOMY, clusters:[] };
  try {
    const d = JSON.parse(fs.readFileSync(DATA_FILE,'utf-8'));
    if (!d.taxonomy) d.taxonomy = DEFAULT_TAXONOMY;
    if (!d.clusters) d.clusters = [];
    return d;
  } catch { return { photos:[], taxonomy:DEFAULT_TAXONOMY, clusters:[] }; }
}
function saveData(d) { fs.writeFileSync(DATA_FILE, JSON.stringify(d,null,2)); }

const storage = multer.diskStorage({
  destination: (_q,_f,cb) => cb(null,UPLOADS),
  filename:    (_q,f,cb)  => cb(null,`${Date.now()}-${Math.random().toString(36).slice(2,8)}${path.extname(f.originalname).toLowerCase()}`),
});
const upload = multer({ storage, limits:{ fileSize:200*1024*1024 },
  fileFilter:(_q,file,cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    (IMAGE_EXTS.has(ext)||RAW_EXTS.has(ext)||VIDEO_EXTS.has(ext)) ? cb(null,true) : cb(new Error(`Unsupported: ${ext}`));
  }
});
const uploadMap = multer({ storage: multer.diskStorage({
  destination:(_q,_f,cb) => cb(null,ASSETS),
  filename:   (_q,_f,cb) => cb(null,'site_map.png'),
}), limits:{ fileSize:50*1024*1024 }});

const sleep = ms => new Promise(r => setTimeout(r,ms));

function buildPrompt(taxonomy) {
  const list = taxonomy.map(f =>
    `  ${f.id} (${f.label}):\n` + f.subs.map(s => `    ${s.id} (${s.label}): ${s.elements.slice(0,5).join(', ')}...`).join('\n')
  ).join('\n');
  return `You are an expert architectural surveyor for abandoned industrial sites.
Analyze this photograph of the Cimenterie du Chevalon (Voreppe, France), abandoned 1987.

INVENTORY TAXONOMY:
${list}

RULES:
- Count every discrete visible element (bricks, columns, pipes, windows, machines, etc.)
- Estimate quantities carefully, extrapolate logically for partially visible elements
- condition: "intact" | "reusable" | "degraded" | "non-reusable"
- confidence: 0.0–1.0
- Be exhaustive: 5–15 inventory entries per photo is normal
- NEVER use "autre" unless completely off-topic (no industrial content at all)

RESPOND ONLY WITH VALID JSON (no text, no markdown):
{
  "categories": ["cat1","cat2"],
  "primary": "cat_dominant",
  "description": "2-3 precise documentary sentences.",
  "tags": ["tag1","tag2","tag3","tag4"],
  "materiaux": ["m1","m2"],
  "etat": "intact|degraded|heavily degraded|ruined",
  "interest": 3,
  "inventory": [
    { "family_id":"structural","subfamily_id":"masonry","element":"Hollow concrete block","quantity":47,"unit":"units","condition":"reusable","notes":"visible in collapsed wall","confidence":0.75 }
  ]
}
Standard categories: escaliers,portes,debris,graffitis,metal,machines,rouille,fenetres,beton,vegetation,sol,lumiere,plafond,tubes,autre`;
}

const STD_CATS = new Set(['escaliers','portes','debris','graffitis','metal','machines','rouille','fenetres','beton','vegetation','sol','lumiere','plafond','tubes','autre']);

async function toJpeg(filePath, ext) {
  if (VIDEO_EXTS.has(ext)) return null;
  try { return await sharp(filePath).resize(1568,1568,{fit:'inside'}).jpeg({quality:90}).toBuffer(); }
  catch { return null; }
}
async function makeThumb(src, dest) {
  try {
    if (Buffer.isBuffer(src)) await sharp(src).resize(400,400,{fit:'cover'}).jpeg({quality:80}).toFile(dest);
    else await sharp(src).resize(400,400,{fit:'cover'}).jpeg({quality:80}).toFile(dest);
  } catch {}
}

async function classify(buf, taxonomy, attempt=1) {
  const currentKey = process.env.MAMMOUTH_API_KEY;
  if (!currentKey || currentKey==='COLLE-TA-CLE-ICI') throw new Error('API key not set');
  const res = await fetch(MAMMOUTH_URL, {
    method:'POST',
    headers:{'Authorization':`Bearer ${currentKey}`,'Content-Type':'application/json'},
    body: JSON.stringify({ model:MAMMOUTH_MODEL, max_tokens:2048,
      messages:[{role:'user',content:[
        {type:'image_url',image_url:{url:`data:image/jpeg;base64,${buf.toString('base64')}`}},
        {type:'text',text:buildPrompt(taxonomy)},
      ]}]
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    if (res.status===429 && attempt<=4) { await sleep(attempt*15000); return classify(buf,taxonomy,attempt+1); }
    throw new Error(`HTTP ${res.status}: ${t.slice(0,200)}`);
  }
  const data  = await res.json();
  const text  = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error('Empty response');
  const match = text.replace(/```json|```/gm,'').match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Non-JSON');
  const p = JSON.parse(match[0]);
  p.categories = (p.categories||[]).filter(c => STD_CATS.has(c));
  if (!p.categories.length) p.categories=['autre'];
  if (!STD_CATS.has(p.primary)) p.primary=p.categories[0];
  p.interest = Math.min(5,Math.max(1,parseInt(p.interest)||3));
  p.inventory = (p.inventory||[]).map(item=>({
    family_id:   item.family_id||'autre',
    subfamily_id:item.subfamily_id||'',
    element:     item.element||'Unknown',
    quantity:    parseInt(item.quantity)||1,
    unit:        item.unit||'units',
    condition:   item.condition||'degraded',
    notes:       item.notes||'',
    confidence:  parseFloat(item.confidence)||0.5,
  }));
  return p;
}

function findOrCreateCluster(data, x, y) {
  const RADIUS = 0.08;
  const nearby = data.photos.filter(p => p.location && Math.hypot(p.location.x-x,p.location.y-y)<RADIUS && p.cluster_id);
  if (nearby.length>0) {
    const counts={};
    nearby.forEach(p=>{counts[p.cluster_id]=(counts[p.cluster_id]||0)+1;});
    return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
  }
  const newId=`cluster_${Date.now()}`;
  data.clusters.push({id:newId,label:`Zone ${data.clusters.length+1}`,x,y});
  return newId;
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname,'public')));
app.use('/uploads', express.static(UPLOADS));
app.use('/assets',  express.static(ASSETS));

// Set API key from UI (first launch)
app.post('/api/set-key', (req, res) => {
  const { key } = req.body;
  if (!key?.trim()) return res.status(400).json({error:'Empty key'});
  process.env.MAMMOUTH_API_KEY = key.trim();
  const envPath = process.env.ATLAS_USER_DATA
    ? path.join(process.env.ATLAS_USER_DATA, '.env')
    : path.join(__dirname, '.env');
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath,'utf-8') : '';
  if (content.includes('MAMMOUTH_API_KEY=')) {
    content = content.replace(/MAMMOUTH_API_KEY=.*/,'MAMMOUTH_API_KEY='+key.trim());
  } else {
    content += '\nMAMMOUTH_API_KEY='+key.trim()+'\n';
  }
  fs.writeFileSync(envPath, content);
  res.json({ok:true});
});

app.get('/api/categories', (_q,res) => res.json([
  {id:'escaliers',label:'Escaliers'},{id:'portes',label:'Portes & Accès'},
  {id:'debris',label:'Débris & Déchets'},{id:'graffitis',label:'Graffitis & Tags'},
  {id:'metal',label:'Structure Métallique'},{id:'machines',label:'Machines & Équipements'},
  {id:'rouille',label:'Rouille & Corrosion'},{id:'fenetres',label:'Fenêtres & Ouvertures'},
  {id:'beton',label:'Béton Fissuré'},{id:'vegetation',label:'Végétation Envahissante'},
  {id:'sol',label:'Sols & Revêtements'},{id:'lumiere',label:'Lumière & Ombres'},
  {id:'plafond',label:'Plafonds & Voûtes'},{id:'tubes',label:'Tuyaux & Câblages'},
  {id:'autre',label:'Autre'},
]));

app.get('/api/photos', (req,res) => {
  const {category,search,sort}=req.query;
  let {photos}=loadData();
  if (category&&category!=='all') photos=photos.filter(p=>p.categories?.includes(category));
  if (search) { const q=search.toLowerCase(); photos=photos.filter(p=>p.description?.toLowerCase().includes(q)||p.tags?.some(t=>t.toLowerCase().includes(q))||p.manual_tags?.some(t=>t.toLowerCase().includes(q))||p.notes?.toLowerCase().includes(q)||p.original_name?.toLowerCase().includes(q)); }
  if (sort==='interest') photos.sort((a,b)=>(b.interest||0)-(a.interest||0));
  else if (sort==='date') photos.sort((a,b)=>new Date(b.uploaded_at)-new Date(a.uploaded_at));
  else if (sort==='category') photos.sort((a,b)=>(a.primary||'').localeCompare(b.primary||''));
  res.json(photos);
});

app.get('/api/stats', (_q,res) => {
  const {photos}=loadData();
  const cats=['escaliers','portes','debris','graffitis','metal','machines','rouille','fenetres','beton','vegetation','sol','lumiere','plafond','tubes','autre'];
  const stats=Object.fromEntries(cats.map(c=>[c,0]));
  photos.forEach(p=>(p.categories||[]).forEach(c=>{if(c in stats)stats[c]++;}));
  res.json({total:photos.length,byCategory:stats});
});

app.post('/api/upload', upload.array('photos',200), async (req,res) => {
  const files=req.files;
  if (!files?.length) return res.status(400).json({error:'No files'});
  const data=loadData(), results=[];
  for (let i=0;i<files.length;i++) {
    const file=files[i];
    const ext=path.extname(file.originalname).toLowerCase();
    const thumbName=`thumb_${file.filename}.jpg`;
    console.log(`  [${i+1}/${files.length}] ${file.originalname}`);
    let jpegBuf=null, cls=null;
    try { jpegBuf=await toJpeg(file.path,ext); if(jpegBuf){await makeThumb(jpegBuf,path.join(THUMBS,thumbName));cls=await classify(jpegBuf,data.taxonomy);} } catch(e){console.error('    ✗',e.message);}
    const photo={
      id:`p_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
      filename:file.filename, original_name:file.originalname,
      path:`/uploads/${file.filename}`,
      thumb:jpegBuf?`/uploads/_thumbs/${thumbName}`:null,
      file_type:VIDEO_EXTS.has(ext)?'video':RAW_EXTS.has(ext)?'raw':'image',
      ext, uploaded_at:new Date().toISOString(), size:file.size,
      categories:cls?.categories||['autre'], primary:cls?.primary||'autre',
      description:cls?.description||'', tags:cls?.tags||[], materiaux:cls?.materiaux||[],
      etat:cls?.etat||'', interest:cls?.interest||1, inventory:cls?.inventory||[],
      manual_tags:[], notes:'', location:null, cluster_id:null, ai_classified:!!cls,
    };
    console.log(`    ✓ [${photo.categories.join(', ')}] — ${photo.inventory.length} items`);
    data.photos.push(photo); saveData(data);
    results.push({success:true,name:file.originalname,inventory_count:photo.inventory.length});
    if (i<files.length-1) await sleep(300);
  }
  res.json({processed:results.length,results});
});

app.put('/api/photos/:id', (req,res) => {
  const data=loadData(), idx=data.photos.findIndex(p=>p.id===req.params.id);
  if (idx===-1) return res.status(404).json({error:'Not found'});
  ['interest','manual_tags','notes','categories','primary','description','tags','etat','materiaux','inventory','location','cluster_id'].forEach(k=>{if(req.body[k]!==undefined)data.photos[idx][k]=req.body[k];});
  saveData(data); res.json(data.photos[idx]);
});

app.post('/api/photos/:id/location', (req,res) => {
  const {x,y}=req.body;
  if (x===undefined||y===undefined) return res.status(400).json({error:'x,y required'});
  const data=loadData(), idx=data.photos.findIndex(p=>p.id===req.params.id);
  if (idx===-1) return res.status(404).json({error:'Not found'});
  data.photos[idx].location={x:parseFloat(x),y:parseFloat(y)};
  data.photos[idx].cluster_id=findOrCreateCluster(data,parseFloat(x),parseFloat(y));
  saveData(data); res.json(data.photos[idx]);
});

app.post('/api/photos/:id/tags', (req,res) => {
  const {tag}=req.body;
  if (!tag?.trim()) return res.status(400).json({error:'Empty'});
  const data=loadData(), idx=data.photos.findIndex(p=>p.id===req.params.id);
  if (idx===-1) return res.status(404).json({error:'Not found'});
  if (!data.photos[idx].manual_tags) data.photos[idx].manual_tags=[];
  const t=tag.trim().toLowerCase();
  if (!data.photos[idx].manual_tags.includes(t)) data.photos[idx].manual_tags.push(t);
  saveData(data); res.json(data.photos[idx]);
});

app.delete('/api/photos/:id/tags/:tag', (req,res) => {
  const data=loadData(), idx=data.photos.findIndex(p=>p.id===req.params.id);
  if (idx===-1) return res.status(404).json({error:'Not found'});
  data.photos[idx].manual_tags=(data.photos[idx].manual_tags||[]).filter(t=>t!==decodeURIComponent(req.params.tag));
  saveData(data); res.json(data.photos[idx]);
});

app.delete('/api/photos/:id', (req,res) => {
  const data=loadData(), photo=data.photos.find(p=>p.id===req.params.id);
  if (!photo) return res.status(404).json({error:'Not found'});
  [path.join(UPLOADS,photo.filename),path.join(THUMBS,`thumb_${photo.filename}.jpg`)].forEach(fp=>{try{if(fs.existsSync(fp))fs.unlinkSync(fp);}catch{}});
  data.photos=data.photos.filter(p=>p.id!==req.params.id); saveData(data); res.json({ok:true});
});

app.post('/api/photos/:id/reclassify', async (req,res) => {
  const data=loadData(), idx=data.photos.findIndex(p=>p.id===req.params.id);
  if (idx===-1) return res.status(404).json({error:'Not found'});
  try {
    const buf=await toJpeg(path.join(UPLOADS,data.photos[idx].filename),data.photos[idx].ext);
    if (!buf) return res.status(400).json({error:'Cannot process'});
    const cls=await classify(buf,data.taxonomy);
    Object.assign(data.photos[idx],cls,{ai_classified:true}); saveData(data); res.json(data.photos[idx]);
  } catch(e){res.status(500).json({error:e.message});}
});

app.get('/api/taxonomy', (_q,res) => res.json(loadData().taxonomy));
app.put('/api/taxonomy', (req,res) => { const data=loadData(); data.taxonomy=req.body; saveData(data); res.json(data.taxonomy); });
app.post('/api/taxonomy/family', (req,res) => {
  const {label}=req.body; if(!label) return res.status(400).json({error:'label required'});
  const data=loadData(), f={id:`fam_${Date.now()}`,label,subs:[]}; data.taxonomy.push(f); saveData(data); res.json(f);
});
app.post('/api/taxonomy/family/:fid/sub', (req,res) => {
  const {label}=req.body; const data=loadData(); const fam=data.taxonomy.find(f=>f.id===req.params.fid);
  if(!fam) return res.status(404).json({error:'Not found'});
  const sub={id:`sub_${Date.now()}`,label,elements:[]}; fam.subs.push(sub); saveData(data); res.json(sub);
});
app.post('/api/taxonomy/family/:fid/sub/:sid/element', (req,res) => {
  const {element}=req.body; const data=loadData(); const fam=data.taxonomy.find(f=>f.id===req.params.fid);
  if(!fam) return res.status(404).json({error:'Not found'}); const sub=fam.subs.find(s=>s.id===req.params.sid);
  if(!sub) return res.status(404).json({error:'Not found'}); if(!sub.elements.includes(element)) sub.elements.push(element);
  saveData(data); res.json(sub);
});
app.delete('/api/taxonomy/family/:fid', (req,res) => {
  const data=loadData(); data.taxonomy=data.taxonomy.filter(f=>f.id!==req.params.fid); saveData(data); res.json({ok:true});
});
app.patch('/api/taxonomy/family/:fid', (req,res) => {
  const data=loadData(); const fam=data.taxonomy.find(f=>f.id===req.params.fid);
  if(!fam) return res.status(404).json({error:'Not found'}); if(req.body.label) fam.label=req.body.label; saveData(data); res.json(fam);
});

app.get('/api/inventory', (_q,res) => {
  const {photos,taxonomy}=loadData();
  const agg={};
  photos.forEach(photo=>{(photo.inventory||[]).forEach(item=>{
    if(!agg[item.family_id])agg[item.family_id]={};
    if(!agg[item.family_id][item.subfamily_id])agg[item.family_id][item.subfamily_id]={};
    const key=item.element;
    if(!agg[item.family_id][item.subfamily_id][key])agg[item.family_id][item.subfamily_id][key]={quantity:0,conditions:{},photos:[]};
    const e=agg[item.family_id][item.subfamily_id][key];
    e.quantity+=item.quantity; e.conditions[item.condition]=(e.conditions[item.condition]||0)+item.quantity;
    if(!e.photos.includes(photo.id))e.photos.push(photo.id);
  });});
  let total_items=0; Object.values(agg).forEach(s=>Object.values(s).forEach(el=>Object.values(el).forEach(e=>{total_items+=e.quantity;})));
  res.json({aggregated:agg,taxonomy,total_items,total_photos:photos.length,total_photos_with_inventory:photos.filter(p=>p.inventory?.length>0).length});
});

app.get('/api/map', (_q,res) => {
  const {photos,clusters}=loadData();
  res.json({photos:photos.filter(p=>p.location).map(p=>({id:p.id,thumb:p.thumb,original_name:p.original_name,location:p.location,cluster_id:p.cluster_id,primary:p.primary,interest:p.interest})),clusters});
});
app.get('/api/clusters', (_q,res) => { const data=loadData(); res.json(data.clusters.map(c=>({...c,photos:data.photos.filter(p=>p.cluster_id===c.id).map(p=>({id:p.id,thumb:p.thumb,original_name:p.original_name}))}))); });
app.patch('/api/clusters/:id', (req,res) => {
  const data=loadData(); const c=data.clusters.find(c=>c.id===req.params.id);
  if(!c) return res.status(404).json({error:'Not found'}); if(req.body.label)c.label=req.body.label; saveData(data); res.json(c);
});
app.post('/api/sitemap', uploadMap.single('map'), (_q,res) => res.json({ok:true,path:'/assets/site_map.png'}));
app.get('/api/export', (_q,res) => { res.setHeader('Content-Disposition','attachment; filename="atlas_chevalon.json"'); res.json(loadData()); });

app.listen(PORT, () => console.log(`Atlas running on http://localhost:${PORT}`));
