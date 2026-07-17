import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FLOORS, type Floor, type Office } from "../data/floors";
import { apiFetch } from "../api/client";
import { useDashboardWs, isSensorMessage } from "../context/WsContext";
import type { SensorMessage } from "../hooks/useWebSocket";
import { staleTone, staleLabel } from "../util/metricHealth";

// ── Design tokens ────────────────────────────────────────────────
const C = {
  bg:        "#0b1220",
  panel:     "#0f172a",
  card:      "#1e293b",
  border:    "#334155",
  borderSub: "#1f2a3d",
  text:      "#f1f5f9",
  muted:     "#94a3b8",
  dim:       "#64748b",
  accent:    "#38bdf8",
  ok:        "#4ade80",
  warn:      "#facc15",
  danger:    "#f87171",
  orange:    "#fb923c",
};

// ── API types ────────────────────────────────────────────────────
interface CompanyRow {
  id: number;
  name: string;
  floor_id: number | null;
  office_id: string | null;
  co2_device_id: string | null;
  temp_device_id: string | null;
}

interface DeviceInfo {
  device_id: string;
  friendly_name?: string | null;
  company_id?: number | null;
  metrics: string[];
  latest_values?: Record<string, number>;
  latest_recorded_at?: string | null;
}

// ── SVG floor plan ───────────────────────────────────────────────
const VB_W = 1280;
const VB_H = 600;

const HULL_PATH = `M 70 26 Q 270 14, 800 18 Q 1100 32, 1238 300 Q 1100 568, 800 582 Q 270 586, 70 574 Z`;

function HullTicks() {
  const ticks: React.ReactNode[] = [];
  const sample = (p0:[number,number], c:[number,number], p1:[number,number], t:number) => {
    const x=(1-t)*(1-t)*p0[0]+2*(1-t)*t*c[0]+t*t*p1[0];
    const y=(1-t)*(1-t)*p0[1]+2*(1-t)*t*c[1]+t*t*p1[1];
    const dx=2*(1-t)*(c[0]-p0[0])+2*t*(p1[0]-c[0]);
    const dy=2*(1-t)*(c[1]-p0[1])+2*t*(p1[1]-c[1]);
    const len=Math.hypot(dx,dy)||1;
    return {x,y,nx:-dy/len,ny:dx/len};
  };
  const segs=[
    {p0:[70,26]as[number,number],c:[270,14]as[number,number],p1:[800,18]as[number,number],n:14,side:1},
    {p0:[800,18]as[number,number],c:[1100,32]as[number,number],p1:[1238,300]as[number,number],n:20,side:1},
    {p0:[70,574]as[number,number],c:[270,586]as[number,number],p1:[800,582]as[number,number],n:14,side:-1},
    {p0:[800,582]as[number,number],c:[1100,568]as[number,number],p1:[1238,300]as[number,number],n:20,side:-1},
  ];
  let k=0;
  for(const s of segs){
    for(let i=0;i<=s.n;i++){
      const {x,y,nx,ny}=sample(s.p0,s.c,s.p1,i/s.n);
      ticks.push(<line key={`tk-${k++}`} x1={x-nx*4*s.side} y1={y-ny*4*s.side} x2={x+nx*4*s.side} y2={y+ny*4*s.side} stroke={C.border} strokeWidth="0.7" opacity="0.5"/>);
    }
  }
  return <g>{ticks}</g>;
}

function CentralCore() {
  return (
    <g stroke={C.border} fill="none" strokeWidth="1.4">
      <rect x="480" y="240" width="150" height="135" fill={C.panel}/>
      <g strokeWidth="1">{[0,1,2,3,4,5,6,7].map(i=><line key={i} x1={488} y1={250+i*12} x2={540} y2={250+i*12}/>)}</g>
      <rect x="555" y="252" width="32" height="28" fill={C.panel}/>
      <rect x="555" y="290" width="32" height="28" fill={C.panel}/>
      <rect x="555" y="328" width="32" height="28" fill={C.panel}/>
      <rect x="595" y="252" width="30" height="105" fill={C.panel}/>
      <ellipse cx="755" cy="305" rx="85" ry="58" strokeDasharray="6 5" fill="none"/>
      <rect x="880" y="240" width="170" height="135" fill={C.panel}/>
      <line x1="935" y1="245" x2="935" y2="370"/>
      <rect x="888" y="252" width="40" height="60" fill={C.panel}/>
      <g strokeWidth="1">{[0,1,2,3,4,5,6,7].map(i=><line key={i} x1={945} y1={250+i*14} x2={1045} y2={250+i*14}/>)}</g>
    </g>
  );
}

function FurnitureGrid({x,y,w,h}:{x:number;y:number;w:number;h:number}) {
  if(w<50||h<40) return null;
  const pad=8, innerW=w-pad*2, innerH=h-pad*2;
  const cols=innerW>90?3:innerW>55?2:1, rows=innerH>70?2:1;
  const cW=innerW/cols, cH=innerH/rows;
  const items:React.ReactNode[]=[];
  for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
    const dx=x+pad+c*cW+cW*0.15, dy=y+pad+r*cH+cH*0.25, dw=cW*0.7, dh=cH*0.32;
    items.push(
      <rect key={`d-${r}-${c}`} x={dx} y={dy} width={dw} height={dh} fill="none" stroke={C.dim} strokeWidth="0.7" opacity="0.4" rx="1.5"/>,
      <circle key={`c1-${r}-${c}`} cx={dx+dw*0.3} cy={dy+dh+3} r="1.8" fill={C.dim} opacity="0.4"/>,
      <circle key={`c2-${r}-${c}`} cx={dx+dw*0.7} cy={dy+dh+3} r="1.8" fill={C.dim} opacity="0.4"/>,
    );
  }
  return <g>{items}</g>;
}

const LS_KEY = "floormap_hidden_offices";

function loadHidden(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) ?? "[]")); }
  catch { return new Set(); }
}
function saveHidden(s: Set<string>) {
  localStorage.setItem(LS_KEY, JSON.stringify([...s]));
}

function FloorSVG({ floor, companies, devices, liveReadings, selectedId, hoverId, query, editMode, hiddenIds, onSelect, onHover, onHide }:{
  floor: Floor;
  companies: CompanyRow[];
  devices: DeviceInfo[];
  liveReadings: Record<string,{values:Record<string,number>;receivedAt:string}>;
  selectedId: string|null;
  hoverId: string|null;
  query: string;
  editMode: boolean;
  hiddenIds: Set<string>;
  onSelect:(id:string)=>void;
  onHover:(id:string|null)=>void;
  onHide:(id:string)=>void;
}) {
  const px=(p:number)=>(p/100)*VB_W;
  const py=(p:number)=>(p/100)*VB_H;
  const q=query.trim().toLowerCase();

  // Map office_id → company
  const officeToCompany = useMemo(()=>{
    const m=new Map<string,CompanyRow>();
    for(const c of companies) if(c.office_id) m.set(c.office_id,c);
    return m;
  },[companies]);

  // Map company_id → aggregated metrics
  const companyMetrics = useMemo(()=>{
    const m=new Map<number,{co2:number|null;temp:number|null;hum:number|null;lastSeen:string|null}>();
    const byCompany=new Map<number,DeviceInfo[]>();
    for(const d of devices){
      if(d.company_id==null) continue;
      if(!byCompany.has(d.company_id)) byCompany.set(d.company_id,[]);
      byCompany.get(d.company_id)!.push(d);
    }
    for(const [cid,devs] of byCompany){
      const company=companies.find(c=>c.id===cid);
      const getVal=(d:DeviceInfo,k:string)=>liveReadings[d.device_id]?.values?.[k]??d.latest_values?.[k]??null;
      const avg=(vals:(number|null)[])=>{const f=vals.filter((v):v is number=>v!==null);return f.length?f.reduce((a,b)=>a+b,0)/f.length:null;};
      const isCo2=(d:DeviceInfo)=>d.metrics?.includes("co2")||d.latest_values?.co2!=null||liveReadings[d.device_id]?.values?.co2!=null;
      const autoNonCo2=devs.filter(d=>!isCo2(d));
      const co2Devs=company?.co2_device_id?devs.filter(d=>d.device_id===company.co2_device_id):devs.filter(isCo2);
      const tempDevs=company?.temp_device_id?devs.filter(d=>d.device_id===company.temp_device_id):(autoNonCo2.length>0?autoNonCo2:devs);
      // Use actual WS arrival time; fall back to DB timestamp
      const liveTimes=devs.map(d=>liveReadings[d.device_id]?.receivedAt??null);
      const dbTimes=devs.map(d=>d.latest_recorded_at??null);
      const allTimes=[...liveTimes,...dbTimes].filter((t):t is string=>t!=null);
      const lastSeen=allTimes.length?allTimes.reduce((a,b)=>a>b?a:b):null;
      m.set(cid,{
        co2: (v=>v!=null?Math.round(v):null)(avg(co2Devs.map(d=>getVal(d,"co2")))),
        temp: avg(tempDevs.map(d=>getVal(d,"temperature"))),
        hum: (v=>v!=null?Math.round(v):null)(avg(tempDevs.map(d=>getVal(d,"humidity")))),
        lastSeen,
      });
    }
    return m;
  },[devices,liveReadings]);

  const matches=useMemo(()=>{
    if(!q) return null;
    return new Set(floor.offices.filter(o=>{
      const co=officeToCompany.get(o.id);
      return o.name.toLowerCase().includes(q)||(co?.name||"").toLowerCase().includes(q);
    }).map(o=>o.id));
  },[q,floor,officeToCompany]);

  const visibleOffices = floor.offices.filter(o => editMode || !hiddenIds.has(o.id));

  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} preserveAspectRatio="xMidYMid meet" style={{width:"100%",height:"100%",display:"block"}}>
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke={C.border} strokeWidth="0.3" opacity="0.25"/>
        </pattern>
        <clipPath id="hullClip"><path d={HULL_PATH}/></clipPath>
        <filter id="glow"><feGaussianBlur stdDeviation="3" result="blur"/><feComposite in="SourceGraphic" in2="blur" operator="over"/></filter>
      </defs>
      <rect width={VB_W} height={VB_H} fill="url(#grid)"/>
      <path d={HULL_PATH} fill={C.panel} stroke={C.border} strokeWidth="2.2" strokeLinejoin="round"/>
      <HullTicks/>
      <g stroke={C.border} strokeWidth="1.2" fill="none" opacity="0.7">
        <path d="M 30 240 L 68 240 L 68 360 L 30 360 Z"/>
        <line x1="30" y1="270" x2="68" y2="270"/>
        <line x1="30" y1="300" x2="68" y2="300"/>
        <line x1="30" y1="330" x2="68" y2="330"/>
      </g>
      <CentralCore/>
      <g clipPath="url(#hullClip)">
        {visibleOffices.map(o=>{
          const x=px(o.x),y=py(o.y),w=px(o.w),h=py(o.h);
          const company=officeToCompany.get(o.id);
          const isSelected=selectedId===o.id;
          const isHover=hoverId===o.id;
          const isHidden=hiddenIds.has(o.id);
          const dim=matches!==null&&!matches.has(o.id);

          const metrics=company?companyMetrics.get(company.id):null;
          const stale=metrics?staleTone(metrics.lastSeen):"fresh";
          const staleAge=metrics?staleLabel(metrics.lastSeen):null;

          const fillColor = isHidden
            ? `${C.danger}08`
            : isSelected ? `${C.accent}22`
            : isHover ? `${C.card}cc`
            : C.card;
          const strokeColor = isHidden
            ? `${C.danger}40`
            : isSelected ? C.accent
            : isHover ? C.muted
            : company && stale === "dead" ? `${C.dim}66`
            : company && stale === "stale" ? `${C.orange}88`
            : company ? `${C.accent}55`
            : C.border;

          return (
            <g key={o.id}
              style={{cursor: editMode ? "default" : "pointer", opacity: dim ? 0.25 : isHidden ? 0.4 : 1, transition:"opacity 150ms"}}
              onClick={()=>{ if(!editMode) onSelect(o.id); }}
              onMouseEnter={()=>onHover(o.id)}
              onMouseLeave={()=>onHover(null)}>
              <rect x={x} y={y} width={w} height={h} rx="6"
                fill={fillColor} stroke={strokeColor}
                strokeWidth={isSelected?1.8:1.1}
                strokeDasharray={isHidden?"5 4":undefined}
                style={{transition:"fill 150ms,stroke 150ms"}}/>
              {!dim&&!isHidden&&<FurnitureGrid x={x} y={y} w={w} h={h}/>}
              {/* Company label + metrics */}
              {!isHidden&&company&&w>70&&h>30&&(()=>{
                const hasMetrics=metrics&&(metrics.co2!=null||metrics.temp!=null||metrics.hum!=null);
                const labelFs=Math.min(11,w/8);
                const metricFs=Math.min(9.5,w/10);

                const tempColor=(t:number)=>t<16?"#60a5fa":t<19?"#93c5fd":t<=25?C.ok:t<=28?C.warn:C.danger;
                const humColor=(h:number)=>h<30?C.warn:h<=60?C.ok:h<=70?C.warn:C.danger;
                const co2Color=(v:number)=>v>1000?C.danger:v>800?C.warn:C.ok;

                const metricItems:{text:string;color:string}[]=[];
                if(metrics?.temp!=null) metricItems.push({text:`${metrics.temp.toFixed(1)}°C`,color:tempColor(metrics.temp)});
                if(metrics?.hum!=null) metricItems.push({text:`${metrics.hum}%`,color:humColor(metrics.hum)});
                if(metrics?.co2!=null) metricItems.push({text:`CO₂ ${metrics.co2}`,color:co2Color(metrics.co2)});

                const hasStaleWarning=stale!=="fresh"&&staleAge!=null&&h>55;
                const rows=metricItems.length+(hasStaleWarning?1:0);
                const step=13;
                const totalH=rows*step;
                const labelY=hasMetrics&&h>55?y+h/2-(totalH/2)-2:y+h/2+1;
                const metricOpacity=stale==="dead"?0.45:stale==="stale"?0.7:1;

                return (
                  <g style={{pointerEvents:"none",userSelect:"none"}}>
                    <text x={x+w/2} y={labelY} textAnchor="middle" dominantBaseline="middle"
                      fontSize={labelFs} fill={stale==="dead"?C.dim:C.muted} fontWeight="600">
                      {company.name.length>18?company.name.slice(0,16)+"…":company.name}
                    </text>
                    {hasMetrics&&h>55&&(
                      <g opacity={metricOpacity}>
                        {metricItems.map((item,i)=>(
                          <text key={i} x={x+w/2} y={labelY+12+(i*step)} textAnchor="middle" dominantBaseline="middle"
                            fontSize={metricFs} fill={item.color} fontWeight="700">
                            {item.text}
                          </text>
                        ))}
                      </g>
                    )}
                    {hasStaleWarning&&(
                      <text x={x+w/2} y={labelY+12+(metricItems.length*step)} textAnchor="middle" dominantBaseline="middle"
                        fontSize={Math.min(8.5,w/11)} fill={stale==="dead"?C.dim:C.orange} fontWeight="700">
                        {`⚠ ${staleAge}`}
                      </text>
                    )}
                  </g>
                );
              })()}
              {/* Edit mode: delete / restore button */}
              {editMode && isHover && w > 32 && h > 24 && (
                <g onClick={e=>{e.stopPropagation(); onHide(o.id);}} style={{cursor:"pointer"}}>
                  <circle cx={x+w-10} cy={y+10} r="10"
                    fill={isHidden ? C.ok : C.danger}
                    opacity="0.9"/>
                  <text x={x+w-10} y={y+10} textAnchor="middle" dominantBaseline="middle"
                    fontSize="11" fill="#fff" fontWeight="800"
                    style={{pointerEvents:"none",userSelect:"none"}}>
                    {isHidden ? "↩" : "×"}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </g>
      {/* Column dots */}
      <g fill={C.border} opacity="0.55">
        {[0.18,0.34,0.5,0.66,0.82,0.92].map(t=>(
          <React.Fragment key={t}>
            <circle cx={90+t*1140} cy={26+(1-Math.abs(2*t-1))*8-12} r="2.2"/>
            <circle cx={90+t*1140} cy={574-(1-Math.abs(2*t-1))*8+12} r="2.2"/>
          </React.Fragment>
        ))}
      </g>
    </svg>
  );
}

// ── Office detail panel ──────────────────────────────────────────
function OfficeDetail({ office, floor, company, devices, liveReadings, onClose }:{
  office: Office|null;
  floor: Floor;
  company: CompanyRow|null;
  devices: DeviceInfo[];
  liveReadings: Record<string,{values:Record<string,number>;receivedAt:string}>;
  onClose:()=>void;
}) {
  const { t } = useTranslation();
  if(!office) return null;

  const getVal=(d:DeviceInfo, metric:string)=>{
    const live=liveReadings[d.device_id]?.values?.[metric];
    return live??d.latest_values?.[metric]??null;
  };

  const officeDevices=devices.filter(d=>d.company_id===company?.id);

  // Use actual WS arrival time; fall back to DB timestamp
  const lastSeenStr=officeDevices.reduce<string|null>((best,d)=>{
    const t=liveReadings[d.device_id]?.receivedAt??d.latest_recorded_at??null;
    if(!t) return best;
    return !best||t>best?t:best;
  },null);
  const stale=staleTone(lastSeenStr);
  const ageLabel=staleLabel(lastSeenStr);
  const co2Vals=officeDevices.map(d=>getVal(d,"co2")).filter((v):v is number=>v!==null);
  const tempVals=officeDevices.map(d=>getVal(d,"temperature")).filter((v):v is number=>v!==null);
  const humVals=officeDevices.map(d=>getVal(d,"humidity")).filter((v):v is number=>v!==null);

  const avgCo2=co2Vals.length?Math.round(co2Vals.reduce((a,b)=>a+b,0)/co2Vals.length):null;
  const avgTemp=tempVals.length?(tempVals.reduce((a,b)=>a+b,0)/tempVals.length).toFixed(1):null;
  const avgHum=humVals.length?Math.round(humVals.reduce((a,b)=>a+b,0)/humVals.length):null;

  const co2State=avgCo2==null
    ? {color:C.dim,label:"—"}
    : avgCo2>1000?{color:C.danger,label:t("floorMap.co2.elevated")}
    : avgCo2>800?{color:C.warn,label:t("floorMap.co2.moderate")}
    : {color:C.ok,label:t("floorMap.co2.good")};

  return (
    <>
      <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(3,8,18,0.45)",backdropFilter:"blur(2px)",zIndex:90,animation:"fadeIn 160ms ease-out"}}/>
      <aside style={{
        width:"min(380px,92vw)",background:C.panel,borderLeft:`1px solid ${C.border}`,
        height:"100vh",overflowY:"auto",position:"fixed",right:0,top:0,zIndex:100,
        boxShadow:"-16px 0 40px rgba(0,0,0,0.5)",animation:"slideIn 220ms cubic-bezier(0.32,0.72,0,1)",
      }}>
        <header style={{
          padding:"18px 22px",borderBottom:`1px solid ${C.borderSub}`,
          display:"flex",alignItems:"center",justifyContent:"space-between",
          position:"sticky",top:0,background:C.panel,zIndex:1,
        }}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontSize:11,color:C.dim,fontWeight:600}}>{floor.label}</span>
          </div>
          <button onClick={onClose} style={{background:"transparent",border:"none",color:C.muted,fontSize:22,lineHeight:1,cursor:"pointer",padding:"0 4px"}}>×</button>
        </header>

        <div style={{padding:22}}>
          <h2 style={{fontSize:20,fontWeight:700,color:C.text,margin:0,letterSpacing:"-0.01em"}}>{office.name}</h2>
          {company
            ? <div style={{fontSize:13,color:C.accent,marginTop:4,fontWeight:600}}>🏢 {company.name}</div>
            : <div style={{fontSize:13,color:C.dim,marginTop:4}}>{t("floorMap.detail.noCompany")}</div>
          }
          {stale!=="fresh"&&ageLabel&&officeDevices.length>0&&(
            <div style={{
              marginTop:12,padding:"8px 12px",borderRadius:8,
              background:stale==="dead"?"#1c1917":"#1c1200",
              border:`1px solid ${stale==="dead"?C.dim+"44":C.orange+"55"}`,
              display:"flex",alignItems:"center",gap:8,
            }}>
              <span style={{fontSize:15}}>{stale==="dead"?"📴":"⚠️"}</span>
              <div>
                <div style={{fontSize:12,fontWeight:700,color:stale==="dead"?C.dim:C.orange}}>
                  {stale==="dead"?"Устройство не в сети":"Данные устарели"}
                </div>
                <div style={{fontSize:11,color:C.dim,marginTop:1}}>Последние данные: {ageLabel}</div>
              </div>
            </div>
          )}

          {/* Sensor readings */}
          {officeDevices.length>0?(
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:18}}>
              {avgTemp!==null&&<StatBox icon="🌡️" label="Temperature" value={avgTemp} unit="°C" accent={C.orange}/>}
              {avgHum!==null&&<StatBox icon="💧" label="Humidity" value={String(avgHum)} unit="%" accent={C.accent}/>}
              {avgCo2!==null&&<StatBox icon="🌿" label="CO₂" value={String(avgCo2)} unit="ppm" accent={co2State.color} hint={co2State.label}/>}
              <StatBox icon="📟" label={t("floorMap.detail.sensors")} value={String(officeDevices.length)} unit="online" accent={C.ok}/>
            </div>
          ):(
            <div style={{marginTop:18,padding:"16px",background:C.card,borderRadius:10,border:`1px solid ${C.borderSub}`,fontSize:13,color:C.dim,textAlign:"center"}}>
              {company ? t("floorMap.detail.noSensors") : t("floorMap.detail.assignHint")}
            </div>
          )}

          {/* Device list */}
          {officeDevices.length>0&&(
            <div style={{marginTop:22}}>
              <div style={{fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",color:C.dim,marginBottom:8}}>
                {t("floorMap.detail.sensors")}
              </div>
              {officeDevices.map(d=>{
                const name=d.friendly_name||d.device_id;
                const bat=getVal(d,"battery");
                const lqi=getVal(d,"linkquality");
                const batColor=bat==null?C.dim:bat>30?C.ok:bat>15?C.warn:C.danger;
                return (
                  <div key={d.device_id} style={{
                    display:"flex",alignItems:"center",gap:10,
                    padding:"9px 12px",marginBottom:6,
                    background:C.card,border:`1px solid ${C.borderSub}`,borderRadius:8,
                  }}>
                    <span style={{fontSize:16}}>📡</span>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12.5,color:C.text,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{name}</div>
                      <div style={{fontSize:10.5,color:C.dim,fontFamily:"ui-monospace,monospace"}}>{d.device_id}</div>
                    </div>
                    <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3}}>
                      {bat!==null&&(
                        <div style={{display:"flex",alignItems:"center",gap:4}}>
                          <div style={{width:24,height:5,borderRadius:999,background:"#1f2a3d",overflow:"hidden"}}>
                            <div style={{width:`${bat}%`,height:"100%",background:batColor}}/>
                          </div>
                          <span style={{fontSize:10,color:C.muted,fontFamily:"ui-monospace,monospace"}}>{bat}%</span>
                        </div>
                      )}
                      {lqi!==null&&<span style={{fontSize:10,color:C.dim}}>LQI {lqi}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}

function StatBox({icon,label,value,unit,accent,hint}:{icon:string;label:string;value:string;unit:string;accent:string;hint?:string}) {
  return (
    <div style={{background:C.card,borderRadius:10,padding:"12px 14px",border:`1px solid ${C.borderSub}`}}>
      <div style={{fontSize:10.5,fontWeight:600,color:C.dim,textTransform:"uppercase",letterSpacing:"0.06em",display:"flex",alignItems:"center",gap:5,marginBottom:8}}>
        <span>{icon}</span><span>{label}</span>
      </div>
      <div style={{display:"flex",alignItems:"baseline",gap:4}}>
        <span style={{fontSize:22,fontWeight:700,color:accent,fontVariantNumeric:"tabular-nums"}}>{value}</span>
        <span style={{fontSize:12,color:C.dim}}>{unit}</span>
      </div>
      {hint&&<div style={{fontSize:10,color:accent,marginTop:2,fontWeight:600}}>{hint}</div>}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────
export default function FloorMapPage() {
  const { t } = useTranslation();
  const { subscribeMessages } = useDashboardWs();
  const [floorId, setFloorId] = useState(1);
  const [selectedId, setSelectedId] = useState<string|null>(null);
  const [hoverId, setHoverId] = useState<string|null>(null);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  // Stores {values, receivedAt} per device — receivedAt is the actual WS arrival time
  const [liveReadings, setLiveReadings] = useState<Record<string,{values:Record<string,number>;receivedAt:string}>>({});
  const [editMode, setEditMode] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(loadHidden);;

  // Fetch
  useEffect(()=>{
    let cancelled=false;
    (async()=>{
      const [cr,dr]=await Promise.all([apiFetch("/companies"),apiFetch("/devices")]);
      if(cancelled) return;
      if(cr.ok) setCompanies(await cr.json());
      if(dr.ok) setDevices(await dr.json());
    })();
    return ()=>{cancelled=true;};
  },[]);

  // Live WS — store values AND the real arrival timestamp
  useEffect(()=>subscribeMessages(raw=>{
    if(!isSensorMessage(raw)) return;
    const msg=raw as SensorMessage;
    setLiveReadings(prev=>({
      ...prev,
      [msg.device_id]:{
        values:{...(prev[msg.device_id]?.values??{}),...msg.data},
        receivedAt: new Date().toISOString(),
      },
    }));
  }),[subscribeMessages]);

  useEffect(()=>{setSelectedId(null);},[floorId]);
  useEffect(()=>{
    const fn=(e:KeyboardEvent)=>{if(e.key==="Escape") setSelectedId(null);};
    window.addEventListener("keydown",fn);
    return ()=>window.removeEventListener("keydown",fn);
  },[]);

  const toggleHide = (id: string) => {
    setHiddenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      saveHidden(next);
      return next;
    });
  };

  const floor=FLOORS.find(f=>f.id===floorId)!;

  // Companies on current floor
  const floorCompanies=useMemo(()=>companies.filter(c=>c.floor_id===floorId),[companies,floorId]);

  // Map office_id → company
  const officeToCompany=useMemo(()=>{
    const m=new Map<string,CompanyRow>();
    for(const c of floorCompanies) if(c.office_id) m.set(c.office_id,c);
    return m;
  },[floorCompanies]);

  const selectedOffice=floor.offices.find(o=>o.id===selectedId)??null;
  const selectedCompany=selectedId?officeToCompany.get(selectedId)??null:null;

  // Floor totals using real data (excluding hidden offices)
  const totals=useMemo(()=>{
    const visibleOffices=floor.offices.filter(o=>!hiddenIds.has(o.id));
    const offices=visibleOffices.length;
    const withCompany=visibleOffices.filter(o=>officeToCompany.has(o.id)).length;
    const allFloorDevices=devices.filter(d=>{
      const co=companies.find(c=>c.id===d.company_id);
      return co?.floor_id===floorId;
    });
    const co2Vals=allFloorDevices.map(d=>{
      const live=liveReadings[d.device_id]?.values?.co2;
      return live??d.latest_values?.co2??null;
    }).filter((v):v is number=>v!==null);
    const avgCo2=co2Vals.length?Math.round(co2Vals.reduce((a,b)=>a+b,0)/co2Vals.length):null;
    return {offices,withCompany,sensors:allFloorDevices.length,avgCo2};
  },[floor,floorId,devices,companies,liveReadings,officeToCompany,hiddenIds]);

  return (
    <div style={{display:"flex",flexDirection:"column",minWidth:0,flex:1,background:C.bg}}>
      <style>{`
        @keyframes slideIn{from{transform:translateX(100%);opacity:0.6}to{transform:translateX(0);opacity:1}}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
      `}</style>

      {/* Header */}
      <div style={{
        padding:"22px 32px 16px",borderBottom:`1px solid ${C.border}`,
        background:C.panel,display:"flex",flexDirection:"column",gap:16,
      }}>
        <div style={{display:"flex",flexWrap:"wrap",alignItems:"flex-end",justifyContent:"space-between",gap:16}}>
          <div>
            <div style={{fontSize:11,fontWeight:600,color:C.dim,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:6}}>
              {t("floorMap.crumb")}
            </div>
            <h1 style={{margin:0,fontSize:22,fontWeight:700,color:C.text,letterSpacing:"-0.02em"}}>
              {floor.label}
              <span style={{color:C.muted,fontWeight:500,fontSize:16,marginLeft:8}}>· {t("floorMap.officesCount", { count: floor.offices.length })}</span>
            </h1>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            {/* Search */}
            <div style={{display:"flex",alignItems:"center",gap:8,background:C.bg,border:`1px solid ${C.border}`,padding:"7px 12px",borderRadius:8,width:240}}>
              <span style={{fontSize:12,color:C.dim}}>🔍</span>
              <input ref={searchRef} value={query} onChange={e=>setQuery(e.target.value)}
                placeholder={t("floorMap.searchPlaceholder")}
                style={{background:"transparent",border:"none",outline:"none",color:C.text,fontSize:13,flex:1,fontFamily:"inherit",minWidth:0}}/>
              {query&&<button onClick={()=>setQuery("")} style={{background:"transparent",border:"none",color:C.dim,cursor:"pointer",fontSize:16,lineHeight:1,padding:0}}>×</button>}
            </div>
            {/* Floor switcher */}
            <div style={{display:"flex",gap:4,padding:4,background:C.bg,border:`1px solid ${C.border}`,borderRadius:8}}>
              {FLOORS.map(f=>{
                const active=f.id===floorId;
                return (
                  <button key={f.id} onClick={()=>setFloorId(f.id)} style={{
                    padding:"7px 14px",fontSize:13,fontWeight:600,
                    background:active?C.accent:"transparent",
                    color:active?"#06222e":C.muted,
                    border:"none",borderRadius:6,cursor:"pointer",fontFamily:"inherit",transition:"all 120ms",
                  }}>F{f.id}</button>
                );
              })}
            </div>

            {/* Edit mode toggle */}
            <button
              onClick={()=>{ setEditMode(v=>!v); setSelectedId(null); }}
              style={{
                padding:"7px 14px",fontSize:13,fontWeight:600,
                background: editMode ? `${C.danger}22` : C.bg,
                color: editMode ? C.danger : C.muted,
                border:`1px solid ${editMode ? C.danger+"55" : C.border}`,
                borderRadius:8,cursor:"pointer",fontFamily:"inherit",transition:"all 120ms",
                display:"flex",alignItems:"center",gap:6,
              }}
            >
              ✏️ {editMode ? "Готово" : "Редактировать"}
              {!editMode && hiddenIds.size > 0 && (
                <span style={{fontSize:10,fontWeight:700,padding:"1px 6px",borderRadius:999,background:C.dim+"33",color:C.dim}}>
                  {hiddenIds.size} скрыто
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Meta strip */}
        <div style={{display:"flex",gap:24,flexWrap:"wrap"}}>
          <MetaItem label={t("floorMap.meta.offices")} value={String(totals.offices)}/>
          <MetaItem label={t("floorMap.meta.withCompany")} value={String(totals.withCompany)} accent={totals.withCompany>0?C.ok:C.dim}/>
          <MetaItem label={t("floorMap.meta.sensors")} value={String(totals.sensors)}/>
          {totals.avgCo2!==null&&(
            <MetaItem label={t("floorMap.meta.avgCo2")} value={`${totals.avgCo2} ppm`} accent={totals.avgCo2>1000?C.danger:totals.avgCo2>800?C.warn:C.ok}/>
          )}
        </div>
      </div>

      {/* Legend */}
      <div style={{display:"flex",alignItems:"center",gap:18,padding:"10px 32px",fontSize:11.5,color:C.muted,borderBottom:`1px solid ${C.borderSub}`,flexWrap:"wrap"}}>
        {editMode ? (
          <>
            <span style={{fontSize:12,color:C.danger,fontWeight:600}}>✏️ Режим редактирования</span>
            <span style={{color:C.dim,fontSize:11}}>Наведите на блок и нажмите <strong style={{color:C.danger}}>×</strong> чтобы скрыть, <strong style={{color:C.ok}}>↩</strong> чтобы восстановить</span>
            {hiddenIds.size > 0 && (
              <button onClick={()=>{ setHiddenIds(new Set()); saveHidden(new Set()); }}
                style={{marginLeft:"auto",fontSize:11,color:C.danger,background:"transparent",border:`1px solid ${C.danger}44`,borderRadius:6,padding:"3px 10px",cursor:"pointer",fontFamily:"inherit"}}>
                Восстановить все ({hiddenIds.size})
              </button>
            )}
          </>
        ) : (
          <>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{width:12,height:12,borderRadius:3,background:`${C.accent}22`,border:`1.5px solid ${C.accent}55`}}/>
              <span>{t("floorMap.legend.assigned")}</span>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{width:12,height:12,borderRadius:3,background:C.card,border:`1.5px solid ${C.border}`}}/>
              <span>{t("floorMap.legend.unassigned")}</span>
            </div>
            <div style={{marginLeft:"auto",color:C.dim,fontSize:11}}>
              {t("floorMap.legend.hint", { count: floorCompanies.length })}
            </div>
          </>
        )}
      </div>

      {/* Map */}
      <div style={{padding:"18px 24px 32px",flex:1}}>
        <FloorSVG
          floor={floor}
          companies={floorCompanies}
          devices={devices}
          liveReadings={liveReadings}
          selectedId={selectedId}
          hoverId={hoverId}
          query={query}
          editMode={editMode}
          hiddenIds={hiddenIds}
          onSelect={id=>setSelectedId(prev=>prev===id?null:id)}
          onHover={setHoverId}
          onHide={toggleHide}
        />
      </div>

      <OfficeDetail
        office={selectedOffice}
        floor={floor}
        company={selectedCompany}
        devices={devices}
        liveReadings={liveReadings}
        onClose={()=>setSelectedId(null)}
      />
    </div>
  );
}

function MetaItem({label,value,accent}:{label:string;value:string;accent?:string}) {
  return (
    <div>
      <div style={{fontSize:10.5,color:C.dim,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em"}}>{label}</div>
      <div style={{fontSize:16,fontWeight:700,color:accent||C.text,fontVariantNumeric:"tabular-nums",marginTop:4}}>{value}</div>
    </div>
  );
}
