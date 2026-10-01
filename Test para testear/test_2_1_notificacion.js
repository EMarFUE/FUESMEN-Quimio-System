const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

function assert(cond, msg) {
  if (!cond) { throw new Error("FALLA: " + msg); }
  console.log("OK: " + msg);
}

const srcMotor = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-motor.js"), "utf8");
const srcCarga = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-carga.js"), "utf8");
const srcGrilla = fs.readFileSync(path.join(__dirname, "../repo/js/turnero-grilla.js"), "utf8");

// Prueba directa del texto: tiene que empezar EXACTAMENTE igual que lo que
// observarGuardadoTurnoGrilla() busca con startsWith (turnero-grilla.js).
{
  const m = srcCarga.match(/mostrarMensajeGeneral\("(Turno guardado correctamente\.[^"]*)"[^)]*\);\s*\n\s*resetearFormularioCarga\(\);\s*\n\s*}\s*else/);
  assert(!!m, "[mensaje internado] se encontró el mensaje de éxito de internado en el código");
  assert(m[1].startsWith("Turno guardado correctamente."), "[mensaje internado] arranca con el prefijo exacto que espera el observador del modal");
}

// Prueba de punta a punta: el MutationObserver real, viendo el mensaje real, cierra el
// modal real después de guardar un turno de internado — reproduce exactamente el bug
// que reportó Elías y confirma que ya no pasa.
function armarFirestoreMock() {
  const docs = {};
  let contadorId = 0;
  function armarDocRef(coleccion, id) {
    return {
      id, __coleccion: coleccion,
      async get() { const data = docs[`${coleccion}/${id}`]; return { exists: !!data, data: () => data }; },
      async update(cambios) { docs[`${coleccion}/${id}`] = { ...(docs[`${coleccion}/${id}`] || {}), ...cambios }; }
    };
  }
  function armarBatch() {
    const operaciones = [];
    return {
      set(ref, data) { operaciones.push({ tipo: "set", ref, data }); },
      update(ref, data) { operaciones.push({ tipo: "update", ref, data }); },
      async commit() {
        for (const op of operaciones) {
          const clave = `${op.ref.__coleccion}/${op.ref.id}`;
          docs[clave] = op.tipo === "set" ? { ...op.data } : { ...(docs[clave] || {}), ...op.data };
        }
      }
    };
  }
  return { collection(c) { return { doc(id) { return armarDocRef(c, id || `auto${++contadorId}`); } }; }, batch: armarBatch, _docs: docs };
}

async function correrGuardadoInternadoConObservador() {
  const fsMock = armarFirestoreMock();
  const setupJs = `
    db = window.__db;
    firebase = { firestore: { FieldValue: { serverTimestamp: () => "TS" } } };
    rolActualCarga = "administrador"; datosUsuarioActualCarga = { rol: "administrador" };
    usuarioActualCarga = { uid: "u1" };
    pacienteSeleccionadoCarga = { id: "pac1", nombre: "Ana", apellido: "Pérez", obraSocial: "OSDE", tipoDocumento: "DNI", numeroDocumento: "1" };
    medicosCacheCarga = [{ id: "med1", nombre: "Dr. Gómez" }];
    sedesCacheCarga = [{ id: "sede1", nombre: "Emilio Civit" }];

    // No es lo que estoy probando acá (la grilla completa necesitaría un fixture enorme)
    // — cerrarModalNuevoTurnoGrilla() la llama al final, después de ya haber cerrado el
    // overlay, que es lo único que me importa confirmar en esta prueba.
    cargarYRenderizarGrilla = async function() {};

    // El modal real "+ nuevo turno" y su observador real, tal cual los usa agenda.html.
    document.getElementById("overlay-nuevo-turno-grilla").style.display = "flex";
    observarGuardadoTurnoGrilla();

    window.__listo = false;
    (async () => {
      await guardarTurnoConHueco(
        { medicoId: "med1", medicoNombre: "Dr. Gómez", sedeAutomatica: false,
          protocolos: [{ protocoloId: "p1", nombre: "FEC", duracionMinutos: 60 }],
          premedicacion: false, duracionTotalMinutos: 60, ciclo: 1, sesion: 1,
          diasSolicitados: null, fechaCalculadaDesdeDias: false, internado: true },
        { sedeId: "sede1", sedeNombre: "Emilio Civit", fecha: "2026-10-05",
          fechaLegible: "5 de octubre de 2026", horaInicio: "10:30", horaFin: "11:30", sillon: null },
        null
      );
      window.__listo = true;
    })();
  `;
  const html = `<!DOCTYPE html><html><body>
    <div id="overlay-nuevo-turno-grilla" style="display:none;"></div>
    <div id="mensaje-general"></div>
    <button id="boton-guardar-turno"></button>
    <select id="campo-medico"><option value="med1">Dr. Gómez</option></select>
    <input id="campo-medico-otro-nombre"/>
    <div id="bloque-medico-otro" style="display:none;"></div>
    <select id="campo-sede-manual"></select>
    <input id="campo-ciclo" type="number"/>
    <input id="campo-sesion" type="number"/>
    <input id="campo-fecha" type="date"/>
    <input id="campo-premedicacion" type="checkbox"/>
    <div id="bloque-horario-manual"><input id="campo-horario-manual" type="time"/></div>
    <div id="bloque-sillon-backup" style="display:none;"><input id="campo-sillon-backup" type="checkbox"/></div>
    <label id="bloque-internado" style="display:none;"><input id="campo-internado" type="checkbox"/></label>
    <div id="bloque-prioridad-turno" style="display:none;"><select id="campo-prioridad-turno"></select></div>
    <input id="campo-nota-inicial-turno"/>
    <div id="contenedor-nota-inicial-turno"></div>
    <button id="boton-abrir-nota-inicial-turno"></button>
    <input id="campo-dias-turno" type="number"/>
    <div id="fecha-calculada-info"></div>
    <div id="bloque-dias-turno"></div>
    <div id="bloque-fecha-manual"></div>
    <div id="lista-protocolos"></div>
    <input id="campo-buscar-paciente"/>
    <div id="paciente-seleccionado"><span id="texto-paciente-seleccionado"></span></div>
    <div id="bloque-busqueda-paciente"></div>
    <div id="sede-automatica-info" style="display:none;"><span id="badge-sede-automatica"></span></div>
    <div id="aviso-sede-indefinida" style="display:none;"></div>
    <div id="resumen-duracion"></div>
    <script>${srcMotor}</script>
    <script>${srcCarga}</script>
    <script>${srcGrilla}</script>
    <script>${setupJs}</script>
  </body></html>`;
  const dom = new JSDOM(html, { runScripts: "dangerously", beforeParse(window) { window.__db = fsMock; } });
  return dom;
}

(async () => {
  const dom = await correrGuardadoInternadoConObservador();
  for (let i = 0; i < 50 && !dom.window.__listo; i++) { await new Promise(r => setTimeout(r, 0)); }
  assert(dom.window.document.getElementById("mensaje-general").textContent.includes("No se generó comprobante"), "[end-to-end] el mensaje menciona que no hay comprobante");
  assert(dom.window.document.getElementById("overlay-nuevo-turno-grilla").style.display === "flex", "[end-to-end] justo después de guardar, el modal TODAVÍA está abierto (el cierre es a los 900ms)");
  // Esperar los 900ms reales del setTimeout del observador, más margen.
  await new Promise(r => setTimeout(r, 1100));
  assert(dom.window.document.getElementById("overlay-nuevo-turno-grilla").style.display === "none", "[end-to-end, bug reportado] a los ~900ms el modal se cierra solo — antes se quedaba abierto");
  console.log("\nTODAS LAS PRUEBAS DE LA NOTIFICACIÓN/CIERRE DE MODAL PASARON\n");
})();
