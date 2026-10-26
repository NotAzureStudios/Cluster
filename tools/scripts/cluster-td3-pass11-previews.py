"""Representative workspace previews using real Cluster renderer CSS.
NOT mounted React/Qt screenshots, and all content is illustrative sample data.
"""
from pathlib import Path
import re, json
from PIL import Image, ImageOps, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'.td3-pass11-preview-output';OUT.mkdir(exist_ok=True)
def flatten(file,seen=None):
    seen=seen or set();file=file.resolve()
    if file in seen:return ''
    seen.add(file)
    data=file.read_text()
    return re.sub(r'@import\s+["\']([^"\'\n]+)["\']\s*;',lambda m:flatten(file.parent/m.group(1),seen),data)
css='\n'.join(flatten(ROOT/p) for p in ('packages/renderer/src/styles.css','packages/renderer/src/features/shell/shell.css','packages/renderer/src/features/shell/shell-v2.css'))
template=(ROOT/'tools/fixtures/td3-pass7-workspace.html').read_text().replace('<link rel="stylesheet" href="../../packages/renderer/src/styles.css"/>','<style>'+css.replace('</style>','')+'</style>')
css11='''
.td11-root{--td-accent:#90aff8;--td-green:#8ed8b6}
.td11-root .td5-workspace{padding:26px clamp(18px,3vw,36px) 65px;max-width:1740px}
.td11-root .td5-demo .content-shell{overflow-x:hidden}
.td11-eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:.16em;font-weight:780;color:var(--td-accent);margin-bottom:9px}
.td11-title{font-size:30px;letter-spacing:-.045em;font-weight:780;margin:0 0 7px;line-height:1.12}
.td11-subtitle{font-size:12px;color:var(--td-muted);line-height:1.6;margin:0}
.td11-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:23px}
.td11-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end}
.td11-btn{background:var(--td-panel);border:1px solid var(--td-border);color:var(--td-text);border-radius:10px;padding:10px 14px;font:650 11px/1 inherit;white-space:nowrap;min-height:38px}
.td11-btn.accent{background:color-mix(in srgb,var(--td-accent) 22%,var(--td-panel));border-color:color-mix(in srgb,var(--td-accent) 45%,var(--td-border))}
.td11-panel{background:var(--td-panel);border:1px solid var(--td-border);border-radius:15px;min-width:0;overflow:hidden;box-shadow:0 7px 25px rgb(0 0 0 / 5%)}
.td11-panel-h{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 18px;border-bottom:1px solid var(--td-border)}
.td11-panel-h b{font-size:13px}.td11-panel-h span{color:var(--td-muted);font-size:10px}
.td11-pad{padding:18px}.td11-muted{color:var(--td-muted)}
.td11-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:13px;margin-bottom:18px}
.td11-kpi{border:1px solid var(--td-border);border-radius:13px;background:var(--td-panel);padding:17px 18px;min-width:0;position:relative;overflow:hidden}
.td11-kpi:after{content:'';position:absolute;right:-24px;top:-30px;width:84px;height:84px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--td-accent) 9%,transparent),transparent)}
.td11-kpi small{display:block;font-size:11px;color:var(--td-muted)}.td11-kpi strong{display:block;font-size:27px;letter-spacing:-.04em;margin:7px 0 6px;font-weight:780}.td11-kpi em{font:650 10px/1.4 inherit;font-style:normal;color:#82cdb1}
.td11-layout{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(240px,.85fr);gap:16px}
.td11-stack{display:grid;gap:16px;align-content:start;min-width:0}
.td11-pill{display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:99px;border:1px solid var(--td-border);background:var(--td-panel-2);font-size:10px;color:var(--td-muted);white-space:nowrap}
.td11-pill.green{background:#579a7b22;color:#8ad5af;border-color:#63b89435}.td11-pill.amber{background:#bb9a4a23;color:#d8be7d;border-color:#d2b46938}.td11-pill.blue{background:#6995d824;color:var(--td-accent);border-color:#85aaff37}
.td11-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 17px;border-bottom:1px solid var(--td-border);min-width:0}
.td11-row:last-child{border-bottom:0}.td11-row-main{display:flex;gap:11px;align-items:center;min-width:0}.td11-row-main strong{display:block;font-size:12px;line-height:1.4}.td11-row-main small{display:block;font-size:10px;color:var(--td-muted);margin-top:3px}
.td11-symbol{width:36px;height:36px;flex:0 0 36px;display:grid;place-items:center;border:1px solid var(--td-border);border-radius:10px;background:color-mix(in srgb,var(--td-accent) 13%,var(--td-panel-2));font-size:17px;color:var(--td-accent)}
.td11-symbol.teal{color:#8bd7ba;background:#5d9b8725}.td11-symbol.purple{color:#c2a3fa;background:#9c77d725}.td11-symbol.gold{color:#ebc786;background:#b5984725}
.td11-progress{width:100%;height:5px;background:var(--td-panel-2);border-radius:99px;overflow:hidden;margin-top:9px}.td11-progress i{display:block;height:100%;width:var(--w,40%);border-radius:inherit;background:linear-gradient(90deg,#648fff,#99b7ff)}
.td11-section-label{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--td-muted);font-weight:750;margin:0 0 10px}
.td11-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.td11-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}
.td11-tabline{display:flex;align-items:center;gap:5px;padding:5px;background:var(--td-panel);border:1px solid var(--td-border);border-radius:12px;margin-bottom:17px;overflow:auto}
.td11-tabline span{padding:9px 13px;border-radius:8px;font-size:11px;color:var(--td-muted);white-space:nowrap}.td11-tabline .active{background:var(--td-panel-2);color:var(--td-text);box-shadow:0 1px 3px #00000014}
.td11-table{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(65px,.65fr) minmax(85px,.75fr) minmax(75px,.6fr);align-items:center;gap:8px;padding:12px 18px;font-size:11px;border-bottom:1px solid var(--td-border)}
.td11-table.h{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--td-muted);background:color-mix(in srgb,var(--td-panel-2) 55%,transparent);font-weight:750}
.td11-table strong{font-size:11px}.td11-table.selected{background:color-mix(in srgb,var(--td-accent) 8%,var(--td-panel))}
.td11-table:last-child{border:0}
.td11-filterbar{display:flex;gap:8px;padding:12px 16px;border-bottom:1px solid var(--td-border);flex-wrap:wrap}.td11-search{background:var(--td-panel-2);color:var(--td-muted);border:1px solid var(--td-border);border-radius:9px;min-height:37px;display:flex;align-items:center;padding:0 12px;font-size:11px;flex:1;min-width:130px}
.td11-square{aspect-ratio:1.52;background:linear-gradient(155deg,#31445d,#1f2937 70%);border-radius:11px;border:1px solid var(--td-border);display:flex;flex-direction:column;justify-content:flex-end;padding:14px;position:relative;overflow:hidden}
.td11-square:before{content:'';position:absolute;width:115px;height:115px;left:45%;top:-35%;border-radius:27px;transform:rotate(30deg);border:18px solid #86b6e52a}.td11-square strong{position:relative;color:#fff;font-size:12px}.td11-square small{position:relative;color:#c0cce0;font-size:10px;margin-top:5px}
.td11-avatar{--td-avatar-color:#87a9f6;position:relative;display:grid;place-items:center;border-radius:9px;background:#40577c;width:36px;height:36px;color:#fff;font-size:11px;font-weight:800;flex:0 0 36px;border:2px solid var(--td-avatar-color);box-shadow:0 0 0 2px color-mix(in srgb,var(--td-avatar-color) 18%,transparent)}.td11-avatar::after{content:"";position:absolute;bottom:-4px;right:-4px;width:11px;height:11px;border:2px solid var(--td-panel);border-radius:50%;background:#8bd3b0}.td11-avatar.offline::after{background:#8795a5}.td11-avatar.busy::after{background:#dba6a6}.td11-avatar.green{--td-avatar-color:#8bd3b0;background:#3b736d}.td11-avatar.purple{--td-avatar-color:#c0a5fb;background:#735a96}.td11-avatar.gold{--td-avatar-color:#e4c385;background:#846d49}
.td11-root .td5-avatar{border:2px solid #87a9f6;border-radius:9px;position:relative}
.td11-root .td5-avatar::after{content:"";position:absolute;right:-4px;bottom:-4px;width:10px;height:10px;border:2px solid var(--td-panel);border-radius:50%;background:#8bd3b0}
.td11-root .td5-utility{gap:4px;white-space:nowrap}
.td11-root .td5-utility small,.td11-root .td5-search-trigger small{font-size:10px;font-weight:650}
.td11-root .td5-search-trigger{background:var(--td-panel-2);border:1px solid var(--td-border);border-radius:10px;padding:7px 12px;gap:7px}
.td11-root .td5-search-trigger kbd{font-size:9px;color:var(--td-muted);background:var(--td-panel);border:1px solid var(--td-border);border-radius:5px;padding:2px 4px}
@media(max-width:1200px){.td11-root .td5-utility small{display:none}}
@media(max-width:650px){.td11-root .td5-search-trigger small{display:none}.td11-root .td5-search-trigger{padding:7px}.td11-root .cluster-taskbar__tabs .td5-tab:not(.active){display:none}}
.td11-people{display:grid;grid-template-columns:minmax(200px,.85fr) minmax(0,1.65fr);gap:15px}.td11-people-entry{padding:10px 13px;border-bottom:1px solid var(--td-border);display:flex;gap:10px;align-items:center}.td11-people-entry.sel{background:color-mix(in srgb,var(--td-accent) 11%,var(--td-panel))}
.td11-cal-week{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1px;background:var(--td-border);border:1px solid var(--td-border);border-radius:12px;overflow:hidden}.td11-cal-col{min-height:335px;background:var(--td-panel);padding:12px 9px}.td11-cal-col header{text-align:center;font-size:10px;color:var(--td-muted);margin-bottom:16px}.td11-cal-col header b{display:block;font-size:18px;color:var(--td-text);margin-top:5px}.td11-event{background:color-mix(in srgb,var(--td-accent) 17%,var(--td-panel-2));border-left:3px solid var(--td-accent);border-radius:6px;padding:10px 8px;font-size:10px;margin-bottom:10px;line-height:1.45}.td11-event b{display:block}.td11-event small{color:var(--td-muted);font-size:9px}
.td11-kanban{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}.td11-lane{background:color-mix(in srgb,var(--td-panel) 76%,var(--td-bg));border:1px solid var(--td-border);border-radius:13px;min-width:0;padding:13px}.td11-lane-head{font-size:12px;font-weight:750;padding-bottom:13px;display:flex;justify-content:space-between}.td11-ticket{background:var(--td-panel);border:1px solid var(--td-border);border-radius:10px;padding:14px;margin-bottom:10px;box-shadow:0 4px 14px #00000009}.td11-ticket strong{font-size:12px;display:block;margin:7px 0}.td11-ticket small{font-size:10px;color:var(--td-muted)}
.td11-settings{display:grid;grid-template-columns:195px minmax(0,1fr);gap:16px}.td11-settings-nav{padding:11px}.td11-settings-nav span{display:block;font-size:11px;padding:12px 13px;border-radius:9px;color:var(--td-muted)}.td11-settings-nav .active{background:color-mix(in srgb,var(--td-accent) 12%,var(--td-panel));color:var(--td-text)}
.td11-setting-row{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:15px 18px;border-bottom:1px solid var(--td-border)}.td11-setting-row:last-child{border:0}.td11-setting-row strong{font-size:12px}.td11-setting-row small{display:block;margin-top:5px;font-size:10px;color:var(--td-muted)}.td11-choice{display:flex;gap:3px;padding:4px;border:1px solid var(--td-border);background:var(--td-panel-2);border-radius:9px}.td11-choice span{font-size:10px;color:var(--td-muted);padding:7px 9px;border-radius:6px;white-space:nowrap}.td11-choice .sel{background:var(--td-panel);color:var(--td-text);box-shadow:0 1px 4px #0002}
.td11-component-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.td11-swatch{display:grid;grid-template-columns:repeat(5,1fr);gap:9px}.td11-swatch div{height:54px;border-radius:10px;border:1px solid var(--td-border)}
.td11-mobile-nav{display:none}
@media(max-width:900px){.td11-root .td5-workspace{padding:18px 13px 34px}.td11-header{align-items:stretch;flex-direction:column}.td11-actions{justify-content:flex-start}.td11-kpis{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.td11-kpi{padding:13px}.td11-kpi strong{font-size:23px}.td11-layout,.td11-people,.td11-settings{grid-template-columns:minmax(0,1fr)}.td11-grid3{grid-template-columns:repeat(2,minmax(0,1fr))}.td11-kanban{grid-template-columns:minmax(210px,1fr);}.td11-cal-col{min-height:230px;padding:8px 5px}.td11-cal-col:nth-child(n+4){display:none}.td11-cal-week{grid-template-columns:repeat(3,minmax(0,1fr))}.td11-table{grid-template-columns:minmax(0,1fr) 85px}.td11-table>*:nth-child(3),.td11-table>*:nth-child(4){display:none}.td11-title{font-size:24px}.td11-people>.td11-panel:first-child{max-height:225px;overflow:auto}.td11-component-grid{grid-template-columns:1fr}.td11-settings-nav{display:flex;overflow:auto;gap:3px}.td11-settings-nav span{white-space:nowrap}.td11-root .td5-demo .taskbar-unified-v3430{min-height:58px}.td11-actions .td11-btn{flex:0 0 auto}.td11-pill{font-size:9px}}
@media(max-width:480px){.td11-grid2,.td11-grid3{grid-template-columns:minmax(0,1fr)}.td11-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.td11-tabline span{padding:9px 10px}.td11-cal-col:nth-child(n+3){display:none}.td11-cal-week{grid-template-columns:repeat(2,minmax(0,1fr))}}
'''
template=template.replace('</head>','<style>'+css11+'</style></head>').replace('<html lang="en"','<html lang="en" class="td11-root"')
# Page markup below deliberately uses the real shell and production CSS; it is not falsely passed off as real app output.
H=lambda title,desc,actions='',eyebrow='STUDIO WORKSPACE':f'<div class="td11-header"><div><div class="td11-eyebrow">{eyebrow}</div><h1 class="td11-title">{title}</h1><p class="td11-subtitle">{desc}</p></div><div class="td11-actions">{actions}</div></div>'
B=lambda label,primary=False:f'<button class="td11-btn {"accent" if primary else ""}">{label}</button>'
K=lambda label,value,note:f'<div class="td11-kpi"><small>{label}</small><strong>{value}</strong><em>{note}</em></div>'
P=lambda title,inside,note='':f'<div class="td11-panel"><div class="td11-panel-h"><b>{title}</b><span>{note}</span></div>{inside}</div>'
ROW=lambda icon,title,desc,extra='',color='':f'<div class="td11-row"><div class="td11-row-main"><div class="td11-symbol {color}">{icon}</div><div><strong>{title}</strong><small>{desc}</small></div></div>{extra}</div>'

def home():
  k=''.join([K('Active projects','12','+2 this month'),K('Your actions','07','3 need attention'),K('Team online','09','Across 4 departments'),K('Upcoming milestones','05','Next 14 days')])
  alert='<div class="td11-panel td11-pad" style="display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:17px;background:linear-gradient(110deg,color-mix(in srgb,var(--td-accent) 13%,var(--td-panel)),var(--td-panel))"><div><div class="td11-eyebrow">YOUR COMMAND BRIEF</div><strong style="font-size:18px;letter-spacing:-.02em">A focused start to your day</strong><p class="td11-subtitle" style="margin-top:6px">2 approvals waiting · 1 build needs attention · 4 recent updates</p></div><span class="td11-pill blue">Live studio overview</span></div>'
  work=P('Continue working', ''.join([ROW('◈','Project Orion','Production · Updated 11 minutes ago','<span class="td11-pill green">Active</span>'),ROW('▦','Environment art board','6 cards assigned to you','<span class="td11-pill blue">Board</span>','purple'),ROW('▣','Studio release calendar','Next milestone: Oct 20','<span class="td11-pill amber">Upcoming</span>','gold'),ROW('▤','Editing Kit v2.4','Latest managed packet','<span class="td11-pill">Packet</span>')]),'Recent workspaces')
  aside=P('Requires attention',''.join([ROW('!','Review access request','Project Orion · Guest request','<span class="td11-pill amber">Pending</span>','gold'),ROW('↗','Build #184 failed','Unreal Windows · 2 hours ago','<span class="td11-pill amber">Review</span>'),ROW('✓','Approve time off','2 requests awaiting decision','<span class="td11-pill blue">2 requests</span>','teal')]),'3 items')+P('Today at a glance','<div class="td11-pad"><div class="td11-section-label">Studio availability</div><div style="display:flex;gap:8px;align-items:center;margin-bottom:14px"><span class="td11-avatar">AL</span><span class="td11-avatar green">JM</span><span class="td11-avatar purple">SK</span><span class="td11-avatar gold">DR</span><span class="td11-muted" style="font-size:10px">+ 5 others online</span></div><div class="td11-section-label">Week capacity</div><div style="display:flex;justify-content:space-between;font-size:11px"><span>Allocated hours</span><strong>72%</strong></div><div class="td11-progress"><i style="--w:72%"></i></div></div>')
  return H('Home','Your studio, current work, and what needs your attention.',B('+ Create',True)+B('Customize Home'))+alert+'<div class="td11-kpis">'+k+'</div><div class="td11-layout"><div class="td11-stack">'+work+P('Recent studio activity',''.join([ROW('✓','Maya approved environment concept','Project Orion · 9:42 AM','<span class="td11-muted" style="font-size:10px">12 min ago</span>','teal'),ROW('◌','Board card moved to Review','Production board · 9:12 AM','','purple')]))+'</div><div class="td11-stack">'+aside+'</div></div>'

def projects():
  metrics=''.join([K('Active','12','Projects in production'),K('Needs attention','03','2 blocked, 1 at risk'),K('Milestones this week','06','Across 4 workspaces'),K('People assigned','24','Studio-wide contributors')])
  cards=''.join(f'<div class="td11-panel td11-pad"><div class="td11-square"><strong>{name}</strong><small>{type_}</small></div><div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px"><strong style="font-size:13px">{name}</strong><span class="td11-pill {tone}">{status}</span></div><div class="td11-muted" style="font-size:10px;margin-top:7px">{owner} · {target}</div><div class="td11-progress"><i style="--w:{pct}%"></i></div><div style="display:flex;justify-content:space-between;font-size:10px;margin-top:8px"><span class="td11-muted">Production readiness</span><b>{pct}%</b></div></div>' for name,type_,owner,target,pct,status,tone in [('Orion','Unreal Engine','A. Lin','Target Nov 14',76,'Active','green'),('Project Atlas','Animation','J. Morgan','Target Dec 3',48,'Attention','amber'),('Horizon','Fortnite Island','S. Kim','Target Jan 8',61,'Active','green')])
  return H('Projects','Track portfolio health, milestones, workspaces, and delivery readiness.',B('View portfolio')+B('+ New project',True))+ '<div class="td11-kpis">'+metrics+'</div><div class="td11-tabline"><span class="active">All projects</span><span>Active</span><span>Needs attention</span><span>Archived</span><span>Saved views ▾</span></div>'+P('Project portfolio','<div class="td11-filterbar"><div class="td11-search">⌕　 Search projects, leads, and tags</div><span class="td11-pill">Status ▾</span><span class="td11-pill">Project type ▾</span><span class="td11-pill">Sort: Updated ▾</span></div><div class="td11-pad"><div class="td11-grid3">'+cards+'</div></div>','12 projects')

def library():
  metrics=''.join([K('Total assets','1,284','+24 this week'),K('Storage used','84.2 GB','Across 3 libraries'),K('Revisions','212','Tracked file versions'),K('Needs review','08','Pending metadata')]); rows=[('▦','Environment','Folder','Today','24 files'),('▣','Trailer_Final.mov','Video','Yesterday','3.2 GB'),('▤','Orion_Pitch.pdf','Document','Oct 10','9.8 MB'),('◧','Hero_Model.fbx','3D Model','Oct 9','44 MB'),('▦','Concept Art','Folder','Oct 8','18 files')]
  table=''.join(f'<div class="td11-table {"selected" if i==0 else ""}"><strong>{icon}　{name}</strong><span>{kind}</span><span class="td11-muted">{date}</span><span class="td11-muted">{size}</span></div>' for i,(icon,name,kind,date,size) in enumerate(rows))
  inspector=P('Inspector','<div class="td11-pad"><div class="td11-square" style="aspect-ratio:1.7;justify-content:center;align-items:center;font-size:37px;color:#d4e6ff">◈</div><h3 style="font-size:15px;margin:17px 0 4px">Environment</h3><p class="td11-subtitle">Project Orion / Production</p><div style="margin:20px 0 13px;border-top:1px solid var(--td-border)"></div><div class="td11-row" style="padding:8px 0"><span class="td11-muted">Type</span><strong>Folder</strong></div><div class="td11-row" style="padding:8px 0"><span class="td11-muted">Contains</span><strong>24 assets</strong></div><div class="td11-row" style="padding:8px 0"><span class="td11-muted">Last change</span><strong>Today</strong></div><div style="margin-top:17px" class="td11-pill blue">Project Orion</div></div>','Details · References')
  main=P('Project files','<div class="td11-filterbar"><div class="td11-search">⌕　 Search in Production</div><span class="td11-pill">Filter ▾</span><span class="td11-pill">Sort ▾</span></div><div class="td11-table h"><span>Name</span><span>Type</span><span>Modified</span><span>Size</span></div>'+table,'Details view')
  return H('Library','Studio files, linked resources, revision history, and media previews.',B('New folder')+B('Upload files',True))+ '<div class="td11-kpis">'+metrics+'</div><div class="td11-tabline"><span>Studio Library</span><span>Project Orion</span><span class="active">Production</span><span>Favorites</span></div><div class="td11-layout"><div class="td11-stack">'+main+'</div>'+inspector+'</div>'

def people():
  metrics=''.join([K('People','24','Studio directory'),K('Available','09','Online now'),K('Teams','05','Across 4 departments'),K('Active projects','12','Contributors assigned')]); names=[('AL','Alex Lin','Creative Director','Online',''),('JM','Jordan Morgan','Technical Artist','Available','green'),('SK','Sam Kim','Gameplay Programmer','Busy','purple busy'),('DR','Drew Rivera','QA Lead','Offline','gold offline')]
  left=P('Directory','<div class="td11-filterbar"><div class="td11-search">⌕　 Search people</div></div>'+''.join(f'<div class="td11-people-entry {"sel" if i==0 else ""}"><div class="td11-avatar {c}">{init}</div><div style="min-width:0"><strong style="font-size:11px">{name}</strong><div class="td11-muted" style="font-size:10px;margin-top:3px">{role}</div></div></div>' for i,(init,name,role,status,c) in enumerate(names)),'24 people')
  right=P('Profile','<div class="td11-pad"><div style="display:flex;align-items:center;gap:14px;margin-bottom:15px"><div class="td11-avatar" style="width:61px;height:61px;font-size:17px;flex-basis:61px">AL</div><div><strong style="font-size:20px">Alex Lin</strong><p class="td11-subtitle">Creative Director · Design</p><div class="td11-pill green" style="margin-top:8px">● Available</div></div></div><div class="td11-tabline"><span class="active">Overview</span><span>Work</span><span>Calendar</span><span>Records</span><span>Access</span></div><div class="td11-grid2"><div class="td11-panel td11-pad"><div class="td11-section-label">Department</div><strong>Creative</strong><p class="td11-subtitle">Studio management</p></div><div class="td11-panel td11-pad"><div class="td11-section-label">Capacity</div><strong>34 / 40 hours</strong><div class="td11-progress"><i style="--w:85%"></i></div></div></div><div style="margin-top:16px" class="td11-section-label">Assigned projects</div>'+ROW('◈','Project Orion','Lead · 25h per week','<span class="td11-pill green">Active</span>')+ROW('▦','Project Atlas','Reviewer · 6h per week','<span class="td11-pill amber">Review</span>')+'</div>','Profile details')
  return H('People','Directory, teams, profiles, capacity, and availability.',B('Organization')+B('+ Add person',True))+'<div class="td11-kpis">'+metrics+'</div><div class="td11-tabline"><span class="active">Directory</span><span>Teams</span><span>Organization</span><span>Capacity</span><span>Availability</span></div><div class="td11-people">'+left+right+'</div>'

def calendar():
  return H('Calendar','Project schedules, studio meetings, deadlines, and availability.',B('Today')+B('Week ▾')+B('+ New event',True))+ '<div class="td11-kpis">'+''.join([K('Today','04','Scheduled events'),K('Meetings','09','This week'),K('Releases','02','Next 30 days'),K('Availability','87%','Team coverage')])+'</div><div class="td11-tabline"><span class="active">Studio</span><span>Project Orion</span><span>Personal</span><span>Release calendar</span><span>Overlays ▾</span></div>'+P('October 12 – 16, 2026','<div class="td11-pad"><div class="td11-cal-week">'+''.join('<div class="td11-cal-col"><header>'+day+'<b>'+date+'</b></header>'+ ''.join(f'<div class="td11-event" style="border-color:{color}"><b>{name}</b><small>{clock}</small></div>' for name,clock,color in ev)+'</div>' for day,date,ev in [('MON','12',[('Art review','10:00–11:00','#8dafff')]),('TUE','13',[('Production sync','09:30–10:00','#8fd6b7'),('QA triage','14:00–15:00','#d9b67e')]),('WED','14',[('Build cut','11:00–12:00','#bda3f8')]),('THU','15',[('Project review','13:00–14:30','#8dafff')]),('FRI','16',[('Release checklist','15:00–16:00','#8fd6b7')])])+'</div></div>','Week view · All times local')

def boards():
  cards={'Planned':[('Review narrative outline','Story','Oct 16'),('Library art audit','Assets','Oct 18')],'In progress':[('Implement player traversal','Gameplay','Oct 14'),('Polish interface mockups','UI/UX','Oct 17'),('QA environment pass','QA','Oct 19')],'Review':[('Approve color palette','Design','Today'),('Animation state machine','Technical art','Tomorrow')]}
  lane=''.join(f'<section class="td11-lane"><div class="td11-lane-head">{k} <span class="td11-pill">{len(v)}</span></div>'+''.join(f'<div class="td11-ticket"><span class="td11-pill blue">{tag}</span><strong>{title}</strong><small>◷ {due}　 ·　 ◌ Orion</small></div>' for title,tag,due in v)+'</section>' for k,v in cards.items())
  return H('Production board','Track tasks, owners, review stages, and project delivery.',B('Filter')+B('Automations')+B('+ Create card',True),'PROJECT ORION / BOARD')+'<div class="td11-kpis">'+''.join([K('Cards','32','Across 5 lists'),K('In progress','08','4 assigned to you'),K('Review queue','05','2 ready for approval'),K('Completed','19','This sprint')])+'</div><div class="td11-tabline"><span class="active">Board</span><span>Table</span><span>Timeline</span><span>Calendar</span><span>Activity</span></div><div class="td11-kanban">'+lane+'</div>'

def settings():
  group='<div class="td11-panel td11-settings-nav"><div class="td11-section-label" style="padding:9px 12px 0">PERSONALIZATION</div><span>Theme & Colors</span><span class="active">Materials & Effects</span><span>Layout & Navigation</span><span>Typography & Icons</span><span>Motion</span><span>Presets</span></div>'
  items=[('Surface depth','How much elevation panels and cards receive',['Flat','Soft','Elevated'],1),('Surface texture','Adds subtle detail without sacrificing readability',['Off','Fine grain','Brushed'],1),('Sidebar style','Navigation can float or dock against the edge',['Docked','Floating'],1),('Taskbar style','Choose a floating or full-width sticky header',['Floating','Full width'],0),('Panel borders','Adjust separation between adjacent surfaces',['Minimal','Subtle','Defined'],1)]
  form=P('Materials & layout',''.join(f'<div class="td11-setting-row"><div><strong>{name}</strong><small>{description}</small></div><div class="td11-choice">'+''.join(f'<span class="{"sel" if i==sel else ""}">{choice}</span>' for i,choice in enumerate(opts))+'</div></div>' for name,description,opts,sel in items),'User appearance')
  return H('Appearance','Personalize your workspace without changing studio defaults.',B('Reset section')+B('Save appearance',True),'ACCOUNT SETTINGS')+'<div class="td11-settings">'+group+'<div class="td11-stack">'+form+P('Live preview','<div class="td11-pad"><div class="td11-panel" style="padding:14px"><div class="td11-pill blue">Floating shell　·　 Soft depth　·　 Fine grain</div><div class="td11-row" style="margin-top:12px"><div class="td11-row-main"><span class="td11-symbol">▦</span><div><strong>Project Orion</strong><small>Production workspace</small></div></div><span class="td11-pill green">Active</span></div></div></div>')+'</div></div>'

def elements():
  return H('UI components','Shared controls, statuses, actions, navigation, and feedback.',B('Inspect tokens')+B('Copy configuration',True),'DESIGN SYSTEM / PREVIEW')+'<div class="td11-component-grid"><div class="td11-stack">'+P('Buttons and actions','<div class="td11-pad"><div class="td11-actions" style="justify-content:flex-start">'+B('Primary action',True)+B('Secondary')+B('Quiet')+'</div><div class="td11-section-label" style="margin-top:20px">Action feedback</div><div class="td11-pill green">✓ Saved successfully</div><div class="td11-pill amber" style="margin-left:8px">◷ Needs review</div></div>')+P('Search & filter','<div class="td11-filterbar"><div class="td11-search">⌕　 Search resources</div><span class="td11-pill">Status ▾</span><span class="td11-pill">Tags ▾</span></div>'+ROW('◈','Project Orion','Active workspace','<span class="td11-pill green">Active</span>')+ROW('▦','Environment assets','Library resource','<span class="td11-pill blue">Linked</span>'))+'</div><div class="td11-stack">'+P('Status & contextual actions','<div class="td11-pad"><div class="td11-section-label">System state</div><div class="td11-pill green">● Connected</div> <div class="td11-pill amber">! Attention</div> <div class="td11-pill blue">◷ Syncing</div><div class="td11-section-label" style="margin-top:24px">Overflow menu</div><div class="td11-panel" style="max-width:260px;padding:7px">'+''.join(f'<div style="padding:11px;font-size:11px;{border}">{title}</div>' for title,border in [('↗ Open',''),('✎ Rename',''),('▣ Copy link','border-bottom:1px solid var(--td-border)'),('⬇ Export','border-bottom:1px solid var(--td-border)'),('▤ Archive','color:#e19b9b')])+'</div></div>')+P('Accent and material tokens','<div class="td11-pad"><div class="td11-swatch">'+''.join(f'<div style="background:{color}"></div>' for color in ['#303a48','#526b91','#87abed','#81c1ac','#a99cc9'])+'</div><p class="td11-subtitle" style="margin-top:12px">Semantic surfaces stay readable in dark and light themes.</p></div>')+'</div></div>'
PAGES={'Home':home,'Projects':projects,'Library':library,'People':people,'Calendar':calendar,'Boards':boards,'Settings':settings,'Elements':elements}
with sync_playwright() as pw:
 browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 manifest=[]
 for theme in ['dark','light']:
  for name,renderer in PAGES.items():
   for form in (['desktop','phone'] if name in ['Home','Library','People','Settings'] else ['desktop']):
    w,h=(1440,900) if form=='desktop' else (390,844)
    page=browser.new_page(viewport={'width':w,'height':h},device_scale_factor=1,has_touch=form=='phone')
    page.set_content(template,wait_until='domcontentloaded')
    page.evaluate('''([theme,name,content])=>{
      const root=document.documentElement;
      Object.assign(root.dataset,{theme,taskbarLayout:'floating',sidebarLayout:'floating',surfaceDepth:'soft',surfaceTexture:'fine',panelBorders:'subtle',highContrast:'false'});
      const shell=document.querySelector('.td5-workspace');shell.innerHTML=content;
      for(const item of document.querySelectorAll('.td5-nav-item')){item.classList.toggle('active', item.textContent.trim().startsWith(name==='Boards'?'Projects':name) || (name==='Elements' && item.textContent.includes('Settings')));}
      const crumb=document.querySelector('.td5-breadcrumb');if(crumb)crumb.remove();
      // Only project tabs belong in this default taskbar. Workspace names must not turn into tabs.
      document.title=`Cluster / ${name} / ${theme}`;
      document.body.classList.add('td11-root');
      const words=document.querySelector('.td5-server');if(words)words.innerHTML='<i class="td5-pulse"></i> Studio server · Connected';
    }''',[theme,name,renderer()])
    page.wait_for_timeout(75)
    met=page.evaluate('''()=>({vw:innerWidth,documentWidth:document.documentElement.scrollWidth,taskbarPosition:getComputedStyle(document.querySelector('.taskbar-unified-v3430')).position,content:!!document.querySelector('.td11-title'),title:document.querySelector('.td11-title')?.textContent})''')
    if met['documentWidth']>w+1: print('OVERFLOW',name,theme,form,met,flush=True)
    assert met['content'] and met['taskbarPosition']=='sticky',met
    namefile=f'Cluster-TD3-Pass11-{name.lower()}-{theme}-{form}.png';page.screenshot(path=str(OUT/namefile),animations='disabled');manifest.append({'page':name,'theme':theme,'format':form,'file':namefile,'metrics':met});page.close()
    print('CAPTURE',namefile,met['documentWidth'],flush=True)
 browser.close()
(OUT/'PREVIEW_MANIFEST.json').write_text(json.dumps({'disclaimer':'Representative fixtures using Cluster production CSS; not mounted application screenshots. Data is fictional.','screenshots':manifest},indent=2)+'\n')
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';bold='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
for theme in ['dark','light']:
 names=['Home','Projects','Library','People','Calendar','Boards','Settings','Elements']
 im=Image.new('RGB',(2120,4*750+92),(16,21,29) if theme=='dark' else (231,235,241));d=ImageDraw.Draw(im)
 d.text((35,20),f'CLUSTER  /  TD3 PASS 11  /  {theme.upper()} UI GALLERY',font=ImageFont.truetype(bold,30),fill='#eff3fa' if theme=='dark' else '#263348')
 for i,name in enumerate(names):
  shot=Image.open(OUT/f'Cluster-TD3-Pass11-{name.lower()}-{theme}-desktop.png').convert('RGB');shot.thumbnail((1025,641))
  x=35+(i%2)*1050;y=103+(i//2)*750
  d.text((x,y-2),name.upper(),font=ImageFont.truetype(bold,20),fill='#b1bfd4' if theme=='dark' else '#4b607c')
  im.paste(shot,(x,y+38))
  d.rounded_rectangle((x-1,y+37,x+1026,y+38+shot.height),radius=5,outline='#60718c' if theme=='dark' else '#b4c1d3',width=2)
 im.save(OUT/f'Cluster-TD3-Pass11-{theme}-Gallery.png',optimize=True)
phone_names=['Home','Library','People','Settings']
phones=Image.new('RGB',(4*390+5*24,930),(18,23,31));d=ImageDraw.Draw(phones)
for i,n in enumerate(phone_names):
 photo=Image.open(OUT/f'Cluster-TD3-Pass11-{n.lower()}-dark-phone.png').convert('RGB');x=24+i*414;phones.paste(photo,(x,45));d.text((x,14),n.upper(),font=ImageFont.truetype(bold,17),fill='white')
phones.save(OUT/'Cluster-TD3-Pass11-Mobile-Gallery.png',optimize=True)
print('TOTAL SCREENSHOTS',len(manifest),'AND 3 GALLERIES')
