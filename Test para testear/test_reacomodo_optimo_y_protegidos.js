const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { JSDOM } = require("jsdom");

function assert(cond, msg) {
  if (!cond) { throw new Error("FALLA: " + msg); }
  console.log("OK: " + msg);
}

const srcMotor = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-motor.js"), "utf8");
const srcCarga = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-carga.js"), "utf8");
function cargarMotor() { const c = { console: { log() {}, warn() {}, error() {} } }; vm.createContext(c); vm.runInContext(srcMotor, c); return c; }
const hm = x => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
const mi = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const solapa = (a, b) => mi(a.horarioInicio) < mi(b.horarioFin) && mi(a.horarioFin) > mi(b.horarioInicio);

(async () => {
  const m = cargarMotor();

  // ===== PARTE A: los dos casos mínimos encontrados en la auditoría =====
  {
    // 3 sillones; el barrido pone el turno nuevo en el 1 y desplaza a t0, pero el 3 estaba libre.
    const reac = [{ id: "t0", sillon: 1, horarioInicio: "11:30", horarioFin: "12:30" }, { id: "t1", sillon: 2, horarioInicio: "10:30", horarioFin: "11:30" }];
    const barrido = m.calcularReacomodoSillones(mi("11:15"), mi("11:45"), [], reac, [1, 2, 3]);
    const optimo = m.calcularReacomodoSillonesOptimo(mi("11:15"), mi("11:45"), [], reac, [1, 2, 3]);
    assert(barrido && barrido.cambios.length === 1, "[A, control] el barrido de siempre mueve 1 paciente en este caso (comportamiento conocido)");
    assert(optimo && optimo.cambios.length === 0 && optimo.sillonCandidato === 3, "[A] la versión nueva no mueve a nadie: usa el sillón 3, que estaba libre");
  }
  {
    // 2 sillones; un fijo en el sillón 1 corta el final del candidato. El barrido dice "no entra".
    const fijos = [{ id: "t0", sillon: 1, horarioInicio: "12:45", horarioFin: "15:30" }];
    const reac = [{ id: "t2", sillon: 2, horarioInicio: "09:45", horarioFin: "12:15" }];
    const barrido = m.calcularReacomodoSillones(mi("11:00"), mi("13:00"), fijos, reac, [1, 2]);
    const optimo = m.calcularReacomodoSillonesOptimo(mi("11:00"), mi("13:00"), fijos, reac, [1, 2]);
    assert(barrido === null, "[A, control] el barrido de siempre dice 'no entra' en este caso (comportamiento conocido)");
    assert(optimo && optimo.sillonCandidato === 2 && optimo.cambios.length === 1 && optimo.cambios[0].turnoId === "t2" && optimo.cambios[0].sillonNuevo === 1,
      "[A] la versión nueva lo resuelve: t2 pasa al sillón 1 (termina antes que el fijo) y el nuevo va al 2");
  }

  // ===== PARTE B: comparación contra el óptimo por fuerza bruta (semilla fija) =====
  {
    let s = 12345 >>> 0;
    const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
    function optimoFuerzaBruta(c0, c1, fijos, reac, sill) {
      const items = [{ id: "__c", horarioInicio: hm(c0), horarioFin: hm(c1), sillon: null }, ...reac];
      let mejor = null; const asign = new Map();
      const ok = (it, sl) => { for (const f of fijos) if (f.sillon === sl && solapa(it, f)) return false; for (const [o, so] of asign) if (so === sl && solapa(it, o)) return false; return true; };
      (function rec(i, c) {
        if (mejor !== null && c >= mejor) return; if (i === items.length) { mejor = c; return; }
        const it = items[i];
        for (const sl of sill) { if (!ok(it, sl)) continue; asign.set(it, sl); rec(i + 1, c + (it.id !== "__c" && sl !== it.sillon ? 1 : 0)); asign.delete(it); }
      })(0, 0);
      return mejor;
    }
    let factibles = 0, barridoFalla = 0, barridoDeMas = 0, nuevoFalla = 0, nuevoDeMas = 0, invalidas = 0;
    for (let it = 0; it < 1500; it++) {
      const nS = ri(2, 4), sill = [...Array(nS)].map((_, i) => i + 1); const reac = [], fijos = [];
      for (let k = 0; k < ri(3, 9); k++) { const d = ri(2, 12) * 15, i0 = 480 + ri(0, 20) * 15; const t = { id: "t" + k, sillon: ri(1, nS), horarioInicio: hm(i0), horarioFin: hm(i0 + d) };
        if ([...reac, ...fijos].some(o => o.sillon === t.sillon && solapa(o, t))) continue; (rnd() < .25 ? fijos : reac).push(t); }
      if (rnd() < .3) fijos.push({ id: "b", esBloqueo: true, sillon: ri(1, nS), horarioInicio: hm(480 + ri(0, 16) * 15), horarioFin: hm(480 + ri(17, 30) * 15) });
      const c0 = 480 + ri(0, 24) * 15, c1 = c0 + ri(2, 10) * 15;
      const opt = optimoFuerzaBruta(c0, c1, fijos, reac, sill);
      const b = m.calcularReacomodoSillones(c0, c1, fijos, reac, sill);
      const n = m.calcularReacomodoSillonesOptimo(c0, c1, fijos, reac, sill);
      if (n) { // validez SIEMPRE, sea factible o no según la referencia
        const asig = [...reac.map(t => ({ ...t, sillon: (n.cambios.find(c => c.turnoId === t.id) || { sillonNuevo: t.sillon }).sillonNuevo })), { horarioInicio: hm(c0), horarioFin: hm(c1), sillon: n.sillonCandidato }];
        for (let a = 0; a < asig.length; a++) { for (const f of fijos) if (f.sillon === asig[a].sillon && solapa(f, asig[a])) invalidas++; for (let x = a + 1; x < asig.length; x++) if (asig[a].sillon === asig[x].sillon && solapa(asig[a], asig[x])) invalidas++; }
      }
      if (opt === null) { if (n) invalidas++; continue; }
      factibles++;
      if (!b) barridoFalla++; else if (b.cambios.length > opt) barridoDeMas++;
      if (!n) nuevoFalla++; else if (n.cambios.length > opt) nuevoDeMas++;
    }
    console.log(`   (${factibles} días factibles · barrido: ${barridoFalla} 'no entra' en falso, ${barridoDeMas} con pacientes movidos de más)`);
    assert(barridoFalla > 0 && barridoDeMas > 0, "[B, cobertura] la muestra contiene casos donde el barrido de siempre falla o mueve de más");
    assert(invalidas === 0, "[B] la versión nueva nunca devuelve una asignación inválida (ni choca entre turnos ni pisa fijos/bloqueos)");
    assert(nuevoFalla === 0, "[B] la versión nueva nunca dice 'no entra' cuando sí entraba");
    assert(nuevoDeMas === 0, "[B] la versión nueva siempre mueve la MENOR cantidad posible de pacientes");
  }

  // ===== PARTE C: integración — buscarHuecosConReacomodo usa la versión nueva =====
  // Caso real encontrado en la auditoría: sede 09-13, 2 sillones, ningún sillón tiene 75
  // minutos seguidos libres (la búsqueda normal falla) y t3 está protegido. El motor
  // anterior decía "no entra"; intercambiando los sillones de t0 y t2 entra 10:45-12:00.
  {
    const F = "2026-10-05";
    const sede = { id: "s1", nombre: "Emilio Civit", horaApertura: "09:00", horaCierre: "13:00", diasAtencion: ["lunes"], usaAtaduraDia: false, usaCuposPorcentaje: false,
      sillones: [{ numero: 1, tipo: "regular" }, { numero: 2, tipo: "regular" }] };
    const T = (id, sillon, i, f, fecha) => ({ id, sedeId: "s1", fecha: fecha || F, sillon, horarioInicio: i, horarioFin: f, medicoId: "m2", paciente: { id: "p" + id } });
    const turnos = [T("t0", 1, "09:00", "11:15"), T("t1", 1, "12:00", "13:00"), T("t2", 2, "09:00", "10:45"), T("t3", 2, "11:30", "13:00"),
      T("L1", 1, "09:00", "13:00", "2026-10-12"), T("L2", 2, "09:00", "13:00", "2026-10-12")];
    const r = await m.buscarHuecosConReacomodo("m1", "", 75, F, [{ id: "m1", nombre: "Dr", diasPorSede: {} }], [sede], turnos, false, "s1", [], "pN", undefined, [], null, ["t3"], false);
    assert(r.exito && r.reacomodo && r.huecosEncontrados[0].fecha === F, "[C] el día pedido entra reacomodando (antes: 'no entra')");
    assert(!r.reacomodo.cambios.some(c => c.turnoId === "t3"), "[C] el turno protegido (t3) nunca se toca");
    const asig = turnos.filter(t => t.fecha === F).map(t => ({ ...t, sillon: (r.reacomodo.cambios.find(c => c.turnoId === t.id) || { sillonNuevo: t.sillon }).sillonNuevo }));
    asig.push({ horarioInicio: r.huecosEncontrados[0].horaInicio, horarioFin: r.huecosEncontrados[0].horaFin, sillon: r.huecosEncontrados[0].sillon });
    let choques = 0; for (let a = 0; a < asig.length; a++) for (let b = a + 1; b < asig.length; b++) if (asig[a].sillon === asig[b].sillon && solapa(asig[a], asig[b])) choques++;
    assert(choques === 0, "[C] el día queda sin ningún choque de sillón después de aplicar el reacomodo");
  }

  // ===== PARTE D: punto 3 — qué turnos de hoy nunca se mueven (reloj simulado: hoy 10:30) =====
  {
    const hoy = "2026-10-05", manana = "2026-10-06";
    const turnos = [
      { id: "terminado", fecha: hoy, horarioInicio: "08:00", horarioFin: "09:00" },
      { id: "enCurso", fecha: hoy, horarioInicio: "10:00", horarioFin: "12:00" },
      { id: "empiezaJusto", fecha: hoy, horarioInicio: "10:30", horarioFin: "11:30" },
      { id: "futuroHoy", fecha: hoy, horarioInicio: "11:00", horarioFin: "12:00" },
      { id: "presenteFuturoHoy", fecha: hoy, horarioInicio: "14:00", horarioFin: "15:00", presente: true },
      { id: "manana", fecha: manana, horarioInicio: "08:00", horarioFin: "09:00" },
      { id: "mananaPresente", fecha: manana, horarioInicio: "09:00", horarioFin: "10:00", presente: true }
    ];
    const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, {
      runScripts: "dangerously",
      beforeParse(window) {
        const DateReal = window.Date;
        const ahora = new DateReal(2026, 9, 5, 10, 30, 0).getTime();
        window.Date = class extends DateReal { constructor(...a) { if (a.length === 0) super(ahora); else super(...a); } static now() { return ahora; } };
      }
    });
    const sc = dom.window.document.createElement("script");
    sc.textContent = `${srcMotor}\n${srcCarga}\nturnosExistentes = ${JSON.stringify(turnos)}; window.__ids = calcularTurnosNoReacomodablesIds();`;
    dom.window.document.body.appendChild(sc);
    const ids = new Set(dom.window.__ids);
    assert(ids.has("terminado"), "[D] turno de hoy que ya terminó → protegido (como siempre)");
    assert(ids.has("enCurso"), "[D] turno de hoy EN CURSO (10:00-12:00, son las 10:30) → protegido (antes: se podía mover)");
    assert(ids.has("empiezaJusto"), "[D] turno de hoy que empieza justo ahora → protegido");
    assert(!ids.has("futuroHoy"), "[D] turno de hoy que todavía no empezó, sin presente → se puede reacomodar");
    assert(ids.has("presenteFuturoHoy") && ids.has("mananaPresente"), "[D] marcado como presente → protegido, sin importar el horario");
    assert(!ids.has("manana"), "[D] turno de otro día sin presente → se puede reacomodar");
  }

  console.log("\nTODAS LAS PRUEBAS DEL REACOMODO ÓPTIMO Y TURNOS PROTEGIDOS PASARON\n");
})();
