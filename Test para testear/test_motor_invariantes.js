// Arnés de invariantes del motor (Etapa 5C, auditoría) — escenarios aleatorios con
// SEMILLAS FIJAS (siempre los mismos, reproducible), verificados contra las reglas que
// nunca deben romperse y contra una referencia por fuerza bruta. Cualquier cambio futuro
// en turnero-motor.js tiene que pasar esto antes de entregarse.
const fs=require("fs"),vm=require("vm");
const path=require("path");
const src=fs.readFileSync(path.join(__dirname,"../repo/js/turnero-motor.js"),"utf8");
function assert(c,msg){if(!c)throw new Error("FALLA: "+msg);console.log("OK: "+msg);}
const m={console:{log(){},warn(){},error(){}}};vm.createContext(m);vm.runInContext(src,m);
let seed=1>>>0;const rnd=()=>{seed=(seed+0x6D2B79F5)>>>0;let t=seed;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
const ri=(a,b)=>a+Math.floor(rnd()*(b-a+1)),pick=a=>a[ri(0,a.length-1)],ch=p=>rnd()<p;
const hm=x=>`${String(Math.floor(x/60)).padStart(2,"0")}:${String(x%60).padStart(2,"0")}`,mi=s=>{const[h,mm]=s.split(":").map(Number);return h*60+mm};
const DS=["domingo","lunes","martes","miercoles","jueves","viernes","sabado"];
const addD=(iso,n)=>{const[y,mo,d]=iso.split("-").map(Number);const x=new Date(y,mo-1,d+n);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")}`};
const dname=iso=>{const[y,mo,d]=iso.split("-").map(Number);return DS[new Date(y,mo-1,d).getDay()]};
const TANDAS=[[101,0,160],[102,.6,160],[103,.6,160],[104,0,160],[105,.95,160]]; // [semilla, proporción de días saturados, escenarios]
const ATADURA_ACTIVA=true; // activa desde el cierre del Grupo B / P1 (atadura con el día pedido lleno)
const F0="2026-10-05";
const fallas={};const cob={propio:0,reacomodo:0,reacNull:0,sinLugar:0,solo:0,fijoOK:0,semana:0,atadura:0,ataduraLleno:0};let DENSIDAD=0;function falla(tipo,det){(fallas[tipo]=fallas[tipo]||{n:0,ej:det}).n++;}
function gen(){
  const ap=pick([420,480,510]),ci=ap+ri(4,12)*60;
  const nReg=ri(1,4),sill=[];for(let i=1;i<=nReg;i++)sill.push({numero:i,tipo:"regular"});
  if(ch(.6))sill.push({numero:nReg+1,tipo:"backup"});
  const DENSO=ch(DENSIDAD);
  const diasAt=DENSO?["lunes"]:DS.filter(d=>d!=="domingo"&&(d!=="sabado"||ch(.2))&&ch(.9));
  const sede={id:"s1",nombre:"Emilio Civit",horaApertura:hm(ap),horaCierre:hm(ci),diasAtencion:diasAt.length?diasAt:["lunes"],
    usaAtaduraDia:ch(.4),usaCuposPorcentaje:ch(.4),sillones:sill};
  const med={id:"m1",nombre:"Dr",diasPorSede:{"Emilio Civit":DS.filter(()=>ch(.6))}};
  if(ch(.3)){const fi=ap+ri(0,6)*30;med.franjaHoraria={horaInicio:hm(fi),horaFin:hm(Math.min(ci,fi+ri(1,6)*30))};}
  const cupos=sede.usaCuposPorcentaje?DS.filter(()=>ch(.8)).map(d=>({sedeId:"s1",dia:d,cupos:{m1:ri(10,80)}})):[];
  const turnos=[];let k=0;
  const nDias=ri(0,11);
  for(let dd=0;dd<=11;dd++){ if(!DENSO&&!ch(.7))continue; const f=addD(F0,dd);
    const cant=DENSO?ri(nReg*3,nReg*10):ri(0,nReg*4);
    if(DENSO&&dd===0&&ch(.7)){const ini=ap+ri(0,6)*15;turnos.push({id:"propioP",sedeId:"s1",fecha:f,sillon:ri(1,nReg),horarioInicio:hm(ini),horarioFin:hm(ini+ri(2,12)*5),medicoId:"m1",duracionTotalMinutos:60,paciente:{id:"P"}});}
    for(let j=0;j<cant;j++){const dur=ri(1,24)*5,ini=ap+ri(0,Math.max(0,(ci-ap-dur)/5))*5;
      const tipo=rnd(); let sillon; let extra={};
      if(tipo<.12){sillon=null;} else if(tipo<.17){sillon=null;extra.internado=true;} else if(tipo<.25&&sill.some(s=>s.tipo==="backup")){sillon=nReg+1;} else sillon=ri(1,nReg);
      const t={id:"t"+(k++),sedeId:"s1",fecha:f,sillon,horarioInicio:hm(ini),horarioFin:hm(ini+dur),medicoId:pick(["m1","m2"]),duracionTotalMinutos:dur,paciente:{id:(ch(.1)?"P":"q"+k)},...extra};
      // no dejar solapar turnos reales en el mismo sillón (datos válidos)
      if(sillon!=null&&turnos.some(o=>o.fecha===f&&o.sillon===sillon&&mi(o.horarioInicio)<ini+dur&&mi(o.horarioFin)>ini))continue;
      turnos.push(t);} }
  const bloq=[];const nb=ri(0,2);
  for(let i=0;i<nb;i++){const b={sedeId:"s1",motivo:"b"+i,activo:true};
    if(ch(.5)){b.tipo="puntual";const a=ri(0,10);b.fechaInicio=addD(F0,a);b.fechaFin=addD(F0,a+ri(0,2));}
    else{b.tipo="recurrente";b.diaSemana=pick(DS);b.fechasExceptuadas=ch(.3)?[addD(F0,ri(0,10))]:[];}
    if(ch(.6))b.sillon=ri(1,nReg+1);
    if(ch(.6)){const s=ap+ri(0,(ci-ap)/30-1)*30;b.horaInicio=hm(s);b.horaFin=hm(Math.min(ci,s+ri(1,4)*30));}
    bloq.push(b);}
  return {sede,med,cupos,turnos,bloq};
}
// --- verificación de un hueco concreto contra TODAS las reglas ---
function ocupadoFisico(e,f,sillon,ini,fin,excluir){
  if(sillon==null)return false;
  return e.turnos.some(t=>t.id!==excluir&&t.fecha===f&&t.sillon===sillon&&mi(t.horarioInicio)<fin&&mi(t.horarioFin)>ini);}
function bloqueado(e,f,sillon,ini,fin){
  return e.bloq.some(b=>{const vig=b.tipo==="recurrente"?(b.diaSemana===dname(f)&&!(b.fechasExceptuadas||[]).includes(f)):(f>=b.fechaInicio&&f<=b.fechaFin);
    if(!vig)return false; if(b.sillon!=null&&b.sillon!==sillon)return false;
    const bi=b.horaInicio?mi(b.horaInicio):mi(e.sede.horaApertura),bf=b.horaFin?mi(b.horaFin):mi(e.sede.horaCierre);return ini<bf&&fin>bi;});}
function pacienteOtroDia(e,f,pac,excluir){return e.turnos.some(t=>t.id!==excluir&&t.fecha===f&&t.paciente&&t.paciente.id===pac);}
function reglasMedico(e,f,ini,dur,excluir){ // devuelve null si ok, o motivo
  const d=dname(f);
  if(e.sede.usaAtaduraDia&&!(e.med.diasPorSede["Emilio Civit"]||[]).includes(d))return "atadura";
  if(e.sede.usaCuposPorcentaje){const c=e.cupos.find(c=>c.dia===d);const p=c&&c.cupos.m1!=null?c.cupos.m1:null;
    if(p!=null){const reg=e.sede.sillones.filter(s=>s.tipo==="regular").length;const techo=(mi(e.sede.horaCierre)-mi(e.sede.horaApertura))*reg*p/100;
      const us=e.turnos.filter(t=>t.id!==excluir&&t.medicoId==="m1"&&t.fecha===f).reduce((a,t)=>a+t.duracionTotalMinutos,0);if(us+dur>techo)return "cupo";}}
  if(e.med.franjaHoraria){if(ini<mi(e.med.franjaHoraria.horaInicio)||ini>mi(e.med.franjaHoraria.horaFin))return "franja";}
  return null;}
function tiposSillon(e,t){return e.sede.sillones.filter(s=>s.tipo===t).map(s=>s.numero);}
// Referencia por fuerza bruta: primer día válido con algún inicio válido (grano 5)
function refPrimerDia(e,dur,pac,excluir,solo){
  const durN=Math.ceil(dur/5)*5,ap=mi(e.sede.horaApertura),ci=mi(e.sede.horaCierre),sill=tiposSillon(e,solo||"regular");
  for(let dd=0;dd<=10;dd++){const f=addD(F0,dd);if(!e.sede.diasAtencion.includes(dname(f)))continue;
    if(pacienteOtroDia(e,f,pac,excluir)){if(dd===0)return {bloqueoPaciente:true};continue;}
    if(!solo&&dd===0&&e.sede.usaAtaduraDia&&!(e.med.diasPorSede["Emilio Civit"]||[]).includes(dname(f)))return {atadura:true};
    let ok=false;
    for(let x=ap;x+durN<=ci&&!ok;x+=5){ if(!solo&&reglasMedico(e,f,x,dur,excluir))continue;
      for(const s of sill){if(!ocupadoFisico(e,f,s,x,x+durN,excluir)&&!bloqueado(e,f,s,x,x+durN)){ok=true;break;}}}
    if(ok)return {fecha:f};}
  return null;}
(async()=>{
 let casos=0,exitos=0;
 for(const [sd,den,N] of TANDAS){seed=sd>>>0;DENSIDAD=den;
 for(let it=0;it<N;it++){
  const e=gen();const dur=ri(1,40)*5;const solo=ch(.15)?"backup":null;if(solo&&!tiposSillon(e,"backup").length)continue;
  // Reasignar: a veces excluimos un turno propio del paciente P
  const propio=ch(.6)?(e.turnos.find(t=>t.id==="propioP")||e.turnos.find(t=>t.paciente.id==="P")):null;const excl=propio?propio.id:undefined;
  if(propio)cob.propio++;if(solo)cob.solo++;
  const r=await m.buscarHuecos("m1","",dur,F0,[e.med],[e.sede],e.turnos,false,"s1",e.cupos,"P",excl,e.bloq,solo);casos++;
  const ref=refPrimerDia(e,dur,"P",excl,solo);
  if(r.exito){exitos++;
   for(const h of r.huecosEncontrados){const ini=mi(h.horaInicio),fin=mi(h.horaFin);
    if(!e.sede.diasAtencion.includes(dname(h.fecha)))falla("buscarHuecos: día que la sede no atiende",h);
    if(ini<mi(e.sede.horaApertura)||fin>mi(e.sede.horaCierre))falla("buscarHuecos: fuera de horario de sede",h);
    if(!tiposSillon(e,solo||"regular").includes(h.sillon))falla("buscarHuecos: tipo de sillón equivocado",{h,solo});
    if(ocupadoFisico(e,h.fecha,h.sillon,ini,fin,undefined)&&!(propio&&propio.fecha===h.fecha&&propio.sillon===h.sillon)) falla("buscarHuecos: superposición con otro turno",h);
    if(bloqueado(e,h.fecha,h.sillon,ini,fin))falla("buscarHuecos: cae sobre un bloqueo",h);
    if(pacienteOtroDia(e,h.fecha,"P",excl))falla("buscarHuecos: paciente ya tiene turno ese día",h);
    if(!solo){const rm=reglasMedico(e,h.fecha,ini,dur,undefined);if(rm&&rm!=="cupo")falla("buscarHuecos: viola regla "+rm,h);}
    if(fin-ini!==Math.ceil(dur/5)*5)falla("buscarHuecos: duración mal normalizada",h);}
   const f=r.huecosEncontrados[0].fecha;
   if(ref&&ref.fecha&&ref.fecha<f)falla("buscarHuecos: NO eligió el primer día posible (Reasignar mismo día / cupo del propio turno)",{motor:f,correcto:ref.fecha,propio:!!propio});
  } else {
   if(ref&&ref.atadura)cob.atadura++;
   if(ATADURA_ACTIVA&&ref&&ref.atadura&&!r.bloqueoAtadura&&!r.bloqueoPaciente)falla("buscarHuecos: el día pedido no es del médico (atadura) pero informa 'sin lugar en 10 días'",{motivo:r.sinHuecosMotivo});
   // P1: el candidato de la atadura tiene que ser coherente con la ocupación REAL del día pedido (fuerza bruta):
   // con sinHuecoFisico no puede haber lugar y no lleva horas; sin él, tiene que haber lugar y llevar horas.
   if(ATADURA_ACTIVA&&!solo&&r.bloqueoAtadura&&r.bloqueoAtadura.huecoDisponible){const hd=r.bloqueoAtadura.huecoDisponible;
     const durN=Math.ceil(dur/5)*5,ap=mi(e.sede.horaApertura),ci=mi(e.sede.horaCierre);let hayFisico=false;
     for(let x=ap;x+durN<=ci&&!hayFisico;x+=5)for(const s of tiposSillon(e,"regular"))if(!ocupadoFisico(e,F0,s,x,x+durN,excl)&&!bloqueado(e,F0,s,x,x+durN)){hayFisico=true;break;}
     if(hd.fecha!==F0||hd.sedeId!=="s1")falla("buscarHuecos: bloqueoAtadura con el candidato en otro día/sede que el pedido",hd);
     if(hd.sinHuecoFisico){cob.ataduraLleno++;if(hayFisico||hd.horaInicio!==null||hd.horaFin!==null)falla("buscarHuecos: bloqueoAtadura sinHuecoFisico incoherente con la ocupación real del día",{hd,hayFisico});}
     else if(!hayFisico||typeof hd.horaInicio!=="string"||typeof hd.horaFin!=="string")falla("buscarHuecos: bloqueoAtadura con hueco real incoherente (no había lugar, o faltan horas)",{hd,hayFisico});}
   if(ref&&ref.fecha&&!r.bloqueoCupo&&!r.bloqueoAtadura&&!r.bloqueoFranja&&!r.bloqueoPaciente){falla("buscarHuecos: dice que no hay lugar pero sí había",{correcto:ref.fecha,motivo:r.sinHuecosMotivo,propio:!!propio});
     }
   cob.sinLugar++;
   if(r.sinHuecosMotivo&&r.sinHuecosMotivo.startsWith("Error interno"))falla("buscarHuecos: excepción interna",r.sinHuecosMotivo);}
  // --- arrastre semanal (buscarHuecosSemanaEnSede): mismas reglas día por día ---
  {const fechas=[0,1,2,3,4,5,6].map(d=>{const[y,mo,dd]=addD(F0,d).split("-").map(Number);return new Date(y,mo-1,dd);});
   const sinProp=e.turnos.filter(t=>t.id!==excl);const sillS=tiposSillon(e,solo||"regular");
   const bloqP=new Set(e.turnos.filter(t=>t.id!==excl&&t.paciente.id==="P").map(t=>t.fecha));
   const rs=await m.buscarHuecosSemanaEnSede("s1","Emilio Civit",fechas,dur,e.sede.horaApertura,e.sede.horaCierre,e.sede.diasAtencion,sinProp,sillS,"m1",solo?null:e.med,e.sede.usaAtaduraDia,e.sede.usaCuposPorcentaje,e.cupos,bloqP,e.bloq);
   for(const f of Object.keys(rs)){if(rs[f].huecos.length)cob.semana++;for(const h of rs[f].huecos){const ini=mi(h.horaInicio),fin=mi(h.horaFin);
     if(ocupadoFisico(e,f,h.sillon,ini,fin,excl))falla("semana: superposición",h);
     if(bloqueado(e,f,h.sillon,ini,fin))falla("semana: sobre bloqueo",h);
     if(bloqP.has(f))falla("semana: paciente ya tiene turno ese día",h);
     if(!solo){const rm=reglasMedico(e,f,ini,dur,excl);if(rm)falla("semana: viola "+rm,h);}
     if(ini<mi(e.sede.horaApertura)||fin>mi(e.sede.horaCierre))falla("semana: fuera de horario",h);}}}
  // --- horario fijo ---
  const fechaF=addD(F0,ri(0,6));const hi=mi(e.sede.horaApertura)+ri(0,20)*15;
  const rf=await m.buscarSillonHorarioFijo("m1","",dur,fechaF,hm(hi),[e.med],[e.sede],e.turnos,"s1",e.bloq,solo==="backup",excl,"P");
  if(rf.exito)cob.fijoOK++;
  if(rf.exito){const h=rf.hueco,ini=mi(h.horaInicio),fin=mi(h.horaFin);
    if(ocupadoFisico(e,h.fecha,h.sillon,ini,fin,excl))falla("horarioFijo: superposición",h);
    if(bloqueado(e,h.fecha,h.sillon,ini,fin))falla("horarioFijo: cae sobre bloqueo",h);
    if(!tiposSillon(e,solo||"regular").includes(h.sillon))falla("horarioFijo: tipo de sillón equivocado",h);
    if(ini<mi(e.sede.horaApertura)||fin>mi(e.sede.horaCierre))falla("horarioFijo: fuera de horario",h);
    if(pacienteOtroDia(e,h.fecha,"P",excl))falla("horarioFijo: paciente ya tiene turno ese día",h);
  } else if(rf.motivo==="sinSillon"){ // verificar que de verdad no había
    const libre=tiposSillon(e,solo||"regular").some(s=>!ocupadoFisico(e,fechaF,s,hi,hi+dur,excl)&&!bloqueado(e,fechaF,s,hi,hi+dur));
    if(libre&&hi+dur<=mi(e.sede.horaCierre))falla("horarioFijo: dice sinSillon pero había",{fechaF,hi:hm(hi)});}
  else if(rf.motivo==="error")falla("horarioFijo: excepción",rf.error);
  // --- validarModificacion: turno existente, cambio de sillón ---
  const tm=pick(e.turnos.length?e.turnos:[null]);
  if(tm&&tm.sillon!==undefined){const cand=ch(.2)?null:ri(1,e.sede.sillones.length);
    const rv=m.validarModificacionTurno("m1","s1",tm.fecha,tm.horarioInicio,tm.horarioFin,cand,[e.med],[e.sede],e.turnos,e.cupos,tm.id,e.bloq);
    const ini=mi(tm.horarioInicio),fin=mi(tm.horarioFin);
    if(rv.valido&&cand!=null&&ocupadoFisico(e,tm.fecha,cand,ini,fin,tm.id))falla("validarModificacion: acepta sillón ocupado",{tm,cand});
    if(!rv.valido&&rv.motivo==="sillonOcupado"&&!ocupadoFisico(e,tm.fecha,cand,ini,fin,tm.id))falla("validarModificacion: sillonOcupado en falso",{tm,cand});
    if(rv.valido&&cand!=null&&bloqueado(e,tm.fecha,cand,ini,fin))falla("validarModificacion: acepta sillón bloqueado",{tm,cand});}
  // --- reacomodo directo: intervalos del día F0 ---
  const reg=tiposSillon(e,"regular");const diaT=e.turnos.filter(t=>t.fecha===F0);
  const x=mi(e.sede.horaApertura)+ri(0,16)*15,durN=Math.ceil(dur/5)*5;
  const fijos=diaT.filter(t=>t.sillon!=null&&!reg.includes(t.sillon)); // backup: no reacomodables
  const reac=diaT.filter(t=>t.sillon!=null&&reg.includes(t.sillon));
  const rc=m.calcularReacomodoSillones(x,x+durN,fijos,reac,reg);
  if(rc){const asig=diaT.map(t=>({...t,sillon:(rc.cambios.find(c=>c.turnoId===t.id)||{sillonNuevo:t.sillon}).sillonNuevo}));
    asig.push({id:"cand",sillon:rc.sillonCandidato,horarioInicio:hm(x),horarioFin:hm(x+durN)});
    for(let a=0;a<asig.length;a++)for(let b=a+1;b<asig.length;b++){const A=asig[a],B=asig[b];if(A.sillon!=null&&A.sillon===B.sillon&&mi(A.horarioInicio)<mi(B.horarioFin)&&mi(A.horarioFin)>mi(B.horarioInicio))falla("reacomodo: deja dos turnos en el mismo sillón",{A,B});}
  } else { // ¿de verdad no se podía? máximo de simultaneidad
    let maxSim=0;for(let y=x;y<x+durN;y++){const sim=reac.filter(t=>mi(t.horarioInicio)<=y&&mi(t.horarioFin)>y).length+1;maxSim=Math.max(maxSim,sim);}
    if(maxSim<=reg.length&&fijos.length===0)falla("reacomodo: devuelve null pero sí alcanzaban los sillones",{x:hm(x)});}
  // reacomodo integrado: nunca debe tocar turnos sin sillón
  const ri2=await m.buscarHuecosConReacomodo("m1","",dur,F0,[e.med],[e.sede],e.turnos,false,"s1",e.cupos,"Pnuevo",undefined,e.bloq,null,[],false);
  if(ri2.reacomodo)cob.reacomodo++;
  if(e.turnos.some(t=>t.fecha===F0&&t.sillon==null))cob.reacNull++;
  if(ri2.reacomodo){for(const c of ri2.reacomodo.cambios){const t=e.turnos.find(t=>t.id===c.turnoId);
     if(t.sillon==null)falla("reacomodo integrado: le asigna sillón a un turno SIN sillón (sobreturno/internado)",{c,internado:!!t.internado});
     if(t.sillon!=null&&!reg.includes(t.sillon))falla("reacomodo integrado: mueve un turno de backup",c);}
   const h=ri2.huecosEncontrados[0];if(bloqueado(e,h.fecha,h.sillon,mi(h.horaInicio),mi(h.horaFin)))falla("reacomodo integrado: candidato sobre bloqueo",h);}
 }
 }
 console.log(`casos=${casos} · buscarHuecos con éxito=${exitos} · cobertura=${JSON.stringify(cob)}`);
 // Cobertura: si el generador deja de ejercitar algo, la prueba falla en vez de pasar vacía.
 assert(casos>=500,"[cobertura] al menos 500 escenarios evaluados");
 assert(cob.propio>=100,"[cobertura] escenarios de Reasignar con turno propio");
 assert(cob.sinLugar>=50,"[cobertura] escenarios sin lugar (se verifican contra fuerza bruta)");
 assert(cob.reacomodo>=5,"[cobertura] escenarios donde el reacomodo se dispara");
 assert(cob.reacNull>=50,"[cobertura] escenarios con sobreturnos/internados sin sillón en el día");
 assert(cob.solo>=30,"[cobertura] escenarios con búsqueda solo en backup");
 assert(cob.fijoOK>=100,"[cobertura] escenarios de horario exacto con éxito");
 assert(cob.semana>=100,"[cobertura] días con huecos en el arrastre semanal");
 assert(!ATADURA_ACTIVA||cob.atadura>=30,"[cobertura] escenarios con atadura en el día pedido");
 assert(!ATADURA_ACTIVA||cob.ataduraLleno>=5,"[cobertura] escenarios con atadura Y el día pedido sin lugar (P1)");
 const ks=Object.keys(fallas);
 for(const k of ks)console.log(`  detalle x${fallas[k].n}: ${k}\n   ej: ${JSON.stringify(fallas[k].ej).slice(0,400)}`);
 assert(ks.length===0,"[invariantes] ninguna regla del motor se rompe en ningún escenario"+(ks.length?" — rotas: "+ks.join(" | "):""));
 console.log("\nTODAS LAS PRUEBAS DE INVARIANTES DEL MOTOR PASARON\n");
})();
