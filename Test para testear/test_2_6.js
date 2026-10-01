const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

function assert(cond, msg) {
  if (!cond) { throw new Error("FALLA: " + msg); }
  console.log("OK: " + msg);
}

const srcGrilla = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-grilla.js"), "utf8");
const srcMensual = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-mensual.js"), "utf8");

function correrGrilla(turnos, turnoIdAAbrir) {
  const setupJs = `
    window.ROLES = { administrador: "Administrador", enfermeria: "Enfermería", medico: "Médico" };
    sedesCacheGrilla = [];
    sedeSeleccionadaGrilla = "sede1";
    rolActualGrilla = "administrador";
    datosUsuarioActualGrilla = { medicoId: null };
    usuarioActualGrilla = { uid: "u1" };
    turnosCacheGrilla = ${JSON.stringify(turnos)};
    abrirDetalleTurnoGrilla(${JSON.stringify(turnoIdAAbrir)});
  `;
  const html = `<!DOCTYPE html><html><body>
    <div id="overlay-detalle-turno-grilla" style="display:none;"></div>
    <div id="contenido-detalle-turno-grilla"></div>
    <script>${srcGrilla}</script>
    <script>${setupJs}</script>
  </body></html>`;
  const dom = new JSDOM(html, { runScripts: "dangerously" });
  return dom.window.document.getElementById("contenido-detalle-turno-grilla").innerHTML;
}

function correrMensual(turnos, turnoIdAAbrir) {
  const setupJs = `
    sedesCacheMensual = [];
    sedeSeleccionadaMensual = "sede1";
    function urlAgendaSemanaMensual() { return "agenda.html"; }
    turnosMesMensual = ${JSON.stringify(turnos)};
    abrirDetalleMensual(${JSON.stringify(turnoIdAAbrir)});
  `;
  const html = `<!DOCTYPE html><html><body>
    <div id="overlay-detalle-mensual" style="display:none;"></div>
    <div id="contenido-detalle-mensual"></div>
    <script>${srcMensual}</script>
    <script>${setupJs}</script>
  </body></html>`;
  const dom = new JSDOM(html, { runScripts: "dangerously" });
  return dom.window.document.getElementById("contenido-detalle-mensual").innerHTML;
}

const turnoConProtocolos = {
  id: "t1", paciente: { apellido: "Pérez", nombre: "Ana" }, sillon: 3,
  horarioInicio: "09:00", horarioFin: "10:05", fecha: "2026-10-05",
  medicoNombre: "Dr. Gómez",
  protocolos: [{ nombre: "FEC" }, { nombre: "Trastuzumab" }],
  premedicacion: true,
  duracionTotalMinutos: 125,
  presente: false
};

const turnoViejoSinProtocolos = {
  id: "t2", paciente: { apellido: "López", nombre: "Juan" }, sillon: 1,
  horarioInicio: "11:00", horarioFin: "12:00", fecha: "2026-10-05",
  medicoNombre: "Dra. Ruiz",
  presente: false
};

// ---- Test 1: grilla, turno con protocolos ----
{
  const html = correrGrilla([turnoConProtocolos], "t1");
  assert(html.includes("Protocolo(s)"), "[grilla] aparece la etiqueta Protocolo(s)");
  assert(html.includes("FEC, Trastuzumab"), "[grilla] protocolos unidos por coma");
  assert(html.includes("Tiempo estimado"), "[grilla] aparece la etiqueta Tiempo estimado");
  assert(html.includes("2 h 5 min"), "[grilla] duración formateada (125 min → 2 h 5 min)");
  assert(!/Premedicaci/i.test(html), "[grilla] NO se agregó fila de premedicación");
  const posMedico = html.indexOf("Médico");
  const posProtocolos = html.indexOf("Protocolo(s)");
  assert(posMedico > -1 && posMedico < posProtocolos, "[grilla] Protocolo(s) va después de Médico");
}

// ---- Test 2: grilla, turno viejo ----
{
  const html = correrGrilla([turnoViejoSinProtocolos], "t2");
  const filaProtocolos = /Protocolo\(s\)<\/span>\s*<span>([^<]*)<\/span>/.exec(html);
  assert(!!filaProtocolos && filaProtocolos[1] === "-", "[grilla, turno viejo] Protocolo(s) muestra '-' (fila no se oculta)");
  const filaDuracion = /Tiempo estimado<\/span>\s*<span>([^<]*)<\/span>/.exec(html);
  assert(!!filaDuracion && filaDuracion[1] === "-", "[grilla, turno viejo] Tiempo estimado muestra '-'");
}

// ---- Test 3: mensual, turno con protocolos ----
{
  const html = correrMensual([turnoConProtocolos], "t1");
  assert(html.includes("Protocolo(s)"), "[mensual] aparece la etiqueta Protocolo(s)");
  assert(html.includes("FEC, Trastuzumab"), "[mensual] protocolos unidos por coma");
  assert(html.includes("2 h 5 min"), "[mensual] duración formateada correctamente");
  assert(!/Premedicaci/i.test(html), "[mensual] NO se agregó fila de premedicación");
  assert(html.includes("Prioridad"), "[mensual] sigue la fila Prioridad (sin romper nada existente)");
  assert(html.includes("Comentarios"), "[mensual] sigue la fila Comentarios");
}

// ---- Test 4: mensual, turno viejo ----
{
  const html = correrMensual([turnoViejoSinProtocolos], "t2");
  const filaProtocolos = /Protocolo\(s\)<\/span>\s*<span>([^<]*)<\/span>/.exec(html);
  assert(!!filaProtocolos && filaProtocolos[1] === "-", "[mensual, turno viejo] Protocolo(s) muestra '-'");
}

console.log("\nTODAS LAS PRUEBAS PASARON");
