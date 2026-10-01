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

const SEDES = [
  { id: "sede1", nombre: "Emilio Civit", horaApertura: "08:00", horaCierre: "18:00",
    usaAtaduraDia: false, usaCuposPorcentaje: false,
    sillones: [{ numero: 1, tipo: "regular" }, { numero: 2, tipo: "regular" }] }
];
const MEDICOS = [{ id: "med1", nombre: "Dr. Gómez", diasPorSede: { "Emilio Civit": ["lunes"] } }];

const TURNO_INTERNADO = {
  id: "tInt", sedeId: "sede1", sedeNombre: "Emilio Civit", sedeAutomatica: false,
  medicoId: "med1", medicoNombre: "Dr. Gómez", esMedicoOtro: false, sillon: null,
  horarioInicio: "10:30", horarioFin: "11:30", fecha: "2026-10-05",
  protocolos: [{ protocoloId: "p1", nombre: "FEC", duracionMinutos: 60 }],
  premedicacion: false, ciclo: 1, sesion: 1, tipoSobreturno: null, internado: true,
  numeroComprobante: undefined,
  paciente: { id: "pac1", nombre: "Ana", apellido: "Pérez", obraSocial: "OSDE" }
};
const TURNO_COMUN = { ...TURNO_INTERNADO, id: "tComun", sillon: 1, numeroComprobante: "2026-000123" };
delete TURNO_COMUN.internado;

function domGrilla() {
  return `<!DOCTYPE html><html><body>
    <div id="overlay-detalle-turno-grilla"></div>
    <div id="contenido-detalle-turno-grilla"></div>
    <div id="overlay-motivo-arrastre-grilla"></div>
    <div id="texto-motivo-arrastre-grilla"></div>
    <input id="campo-motivo-arrastre-grilla"/>
    <div id="error-motivo-arrastre-grilla" style="display:none;"></div>
    <button id="boton-confirmar-motivo-arrastre-grilla"></button>
    <div id="mensaje-agenda"></div>
    <div id="overlay-reasignar-grilla" style="display:none;"></div>
    <div id="overlay-modificar-grilla" style="display:none;"></div>
    <div id="resumen-reasignar-grilla"></div>
    <label id="etiqueta-fecha-reasignar-grilla"></label>
    <input type="date" id="campo-fecha-reasignar-grilla"/>
    <div id="bloque-horario-manual-reasignar-grilla" style="display:none;"><input type="time" id="campo-horario-manual-reasignar-grilla"/></div>
    <div id="mensaje-reasignar-grilla"></div>
    <button id="boton-buscar-reasignar-grilla"></button>
    <button id="boton-horario-manual-reasignar-grilla" style="display:none;"></button>
    <script>${srcMotor}</script>
    <script>${srcCarga}</script>
    <script>${srcGrilla}</script>
  </body></html>`;
}

function setupComun() {
  return `
    sedesCacheGrilla = ${JSON.stringify(SEDES)}; sedesCacheCarga = ${JSON.stringify(SEDES)};
    sedeSeleccionadaGrilla = "sede1";
    medicosCacheGrilla = ${JSON.stringify(MEDICOS)}; medicosCacheCarga = ${JSON.stringify(MEDICOS)};
    cuposCacheGrilla = []; bloqueosCacheGrilla = []; bloqueosCacheCarga = [];
    turnosExistentes = [];
    usuarioActualGrilla = { uid: "u1" }; usuarioActualCarga = usuarioActualGrilla;
    cargarMedicosCarga = async function() {}; cargarSedesCarga = async function() {};
    cargarTurnosExistentes = async function() {}; cargarCuposCarga = async function() {};
    cargarBloqueosCarga = async function() {};
  `;
}

console.log("Setup OK, arrancando pruebas...");

// ============ GRUPO 1: anularYCrearTurnoGrilla nunca genera comprobante para internado ============

function armarFirestoreMock() {
  const docs = {};
  let contadorId = 0;
  function armarDocRef(coleccion, id) {
    const ref = {
      id,
      __coleccion: coleccion,
      async get() {
        const data = docs[`${coleccion}/${id}`];
        return { exists: !!data, data: () => data };
      },
      async update(cambios) {
        docs[`${coleccion}/${id}`] = { ...(docs[`${coleccion}/${id}`] || {}), ...cambios };
      }
    };
    return ref;
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
  return {
    collection(coleccion) { return { doc(id) { return armarDocRef(coleccion, id || `auto${++contadorId}`); } }; },
    batch: armarBatch,
    _docs: docs
  };
}

async function correrAnularYCrear(turnoOriginal, camposNuevos, tipoAccion) {
  const fsMock = armarFirestoreMock();
  const setupJs = setupComun() + `
    db = window.__db;
    firebase = { firestore: { FieldValue: { serverTimestamp: () => "TS", increment: (n) => ({ __increment: n }) } } };
    datosUsuarioActualGrilla = { nombre: "Admin Prueba" };
    window.__resultado = null;
    (async () => {
      window.__resultado = await anularYCrearTurnoGrilla(${JSON.stringify(turnoOriginal)}, ${JSON.stringify(camposNuevos)}, "motivo de prueba", ${JSON.stringify(tipoAccion)});
      window.__listo = true;
    })();
  `;
  const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously", beforeParse(window) { window.__db = fsMock; } });
  for (let i = 0; i < 50 && !dom.window.__listo; i++) { await new Promise(r => setTimeout(r, 0)); }
  return { nuevoId: dom.window.__resultado, fsMock };
}

(async () => {
  {
    const { nuevoId, fsMock } = await correrAnularYCrear(TURNO_INTERNADO, { ciclo: 2 }, "modificado");
    const nuevo = fsMock._docs[`turnos/${nuevoId}`];
    assert(nuevo.internado === true, "[anular-y-crear, internado] el turno nuevo hereda internado: true");
    assert(!("numeroComprobante" in nuevo), "[anular-y-crear, internado] el turno nuevo NO tiene numeroComprobante");
    assert(!fsMock._docs["contadores/comprobantesTurno"], "[anular-y-crear, internado] el contador de comprobantes no se toca");
  }
  {
    const { nuevoId, fsMock } = await correrAnularYCrear(TURNO_COMUN, { ciclo: 2 }, "modificado");
    const nuevo = fsMock._docs[`turnos/${nuevoId}`];
    assert("numeroComprobante" in nuevo, "[regresión, turno común] el turno nuevo SÍ tiene numeroComprobante");
    assert(!!fsMock._docs["contadores/comprobantesTurno"], "[regresión, turno común] el contador SÍ se incrementa");
    const original = fsMock._docs[`turnos/${TURNO_COMUN.id}`];
    assert(original.reemplazadoPorNumero, "[regresión, turno común] el turno viejo queda enlazado con reemplazadoPorNumero");
  }

  // --- GRUPO 3: puedeArrastrarTurnoGrilla, ampliado ---
  for (const [rol, esperado] of [["administrador", true], ["enfermeria", true], ["medico", false]]) {
    const setupJs = `rolActualGrilla = ${JSON.stringify(rol)}; datosUsuarioActualGrilla = { medicoId: "med1" }; medicosCacheGrilla = [];
      window.__puede = puedeArrastrarTurnoGrilla(${JSON.stringify(TURNO_INTERNADO)});`;
    const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
    assert(dom.window.__puede === esperado, `[arrastre internado, ampliado] rol ${rol} → ${esperado}`);
  }
  {
    // Regresión: turno común de médico-propio sigue arrastrable (no se tocó ese caso).
    const setupJs = `rolActualGrilla = "medico"; datosUsuarioActualGrilla = { medicoId: "med1" }; medicosCacheGrilla = [];
      window.__puede = puedeArrastrarTurnoGrilla(${JSON.stringify(TURNO_COMUN)});`;
    const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
    assert(dom.window.__puede === true, "[regresión] médico sigue pudiendo arrastrar su propio turno común");
  }

  console.log("\n--- Grupos 1 y 3 OK ---\n");
})();

(async () => {
  // ============ GRUPO 4: armarArrastreGrilla salta la búsqueda para internado ============
  {
    const setupJs = setupComun() + `
      rolActualGrilla = "administrador";
      turnosCacheGrilla = [${JSON.stringify(TURNO_INTERNADO)}];
      window.__llamoBusqueda = false;
      buscarHuecosSemanaEnSede = async function() { window.__llamoBusqueda = true; return {}; };
      const estado = { turno: turnosCacheGrilla[0], elementoTarjeta: document.createElement("div") };
      document.body.appendChild(estado.elementoTarjeta);
      window.__listo = false;
      armarArrastreGrilla(estado).then(() => {
        window.__esInternado = estado.esInternado;
        window.__huecosSemana = estado.huecosSemana;
        window.__listo = true;
      });
    `;
    const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
    for (let i = 0; i < 50 && !dom.window.__listo; i++) { await new Promise(r => setTimeout(r, 0)); }
    assert(dom.window.__llamoBusqueda === false, "[armarArrastreGrilla, internado] NO llama a buscarHuecosSemanaEnSede");
    assert(dom.window.__esInternado === true, "[armarArrastreGrilla, internado] marca estado.esInternado");
    assert(Object.keys(dom.window.__huecosSemana).length === 0, "[armarArrastreGrilla, internado] huecosSemana queda vacío");
  }
  {
    // Regresión: un turno común SÍ dispara la búsqueda de siempre.
    const setupJs = setupComun() + `
      rolActualGrilla = "administrador";
      turnosCacheGrilla = [${JSON.stringify(TURNO_COMUN)}];
      window.__llamoBusqueda = false;
      buscarHuecosSemanaEnSede = async function() { window.__llamoBusqueda = true; return {}; };
      obtenerDiasVisiblesGrilla = function() { return ["2026-10-05"]; };
      const estado = { turno: turnosCacheGrilla[0], elementoTarjeta: document.createElement("div") };
      document.body.appendChild(estado.elementoTarjeta);
      window.__listo = false;
      armarArrastreGrilla(estado).then(() => { window.__listo = true; });
    `;
    const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
    for (let i = 0; i < 50 && !dom.window.__listo; i++) { await new Promise(r => setTimeout(r, 0)); }
    assert(dom.window.__llamoBusqueda === true, "[regresión, armarArrastreGrilla turno común] SÍ llama a buscarHuecosSemanaEnSede");
  }

  // ============ GRUPO 5: actualizarCandidatoArrastreGrilla, camino internado ============
  {
    const setupJs = setupComun() + `
      document.body.innerHTML += '<div class="pista-dia-grilla" data-fecha="2026-10-06" style="position:absolute;top:0;left:0;width:200px;height:600px;"></div>';
      const pista = document.querySelector(".pista-dia-grilla");
      pista.getBoundingClientRect = () => ({ top: 0, left: 0, right: 200, bottom: 600 });
      document.elementFromPoint = () => pista;
      const estado = {
        turno: ${JSON.stringify(TURNO_INTERNADO)},
        esInternado: true,
        elementoGhost: document.createElement("div")
      };
      document.body.appendChild(estado.elementoGhost);
      actualizarCandidatoArrastreGrilla(estado, { clientX: 10, clientY: 120 }); // 08:00 + 120px = 10:00
      window.__candidato = estado.candidatoActual;
      window.__clasesGhost = estado.elementoGhost.className;
    `;
    const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
    const c = dom.window.__candidato;
    assert(!!c, "[candidato internado] siempre arma un candidato (nunca null)");
    assert(c.hueco.sillon === null, "[candidato internado] el hueco sintético tiene sillon: null");
    assert(c.fechaISO === "2026-10-06", "[candidato internado] toma la fecha de la pista donde se soltó");
    assert(c.hueco.horaInicio === "09:00", "[candidato internado] calcula el horario desde la posición del puntero");
    assert(dom.window.__clasesGhost.includes("valido-grilla") && !dom.window.__clasesGhost.includes("invalido-grilla"), "[candidato internado] el ghost siempre queda \"válido\" (verde)");
  }

  console.log("\n--- Grupos 4 y 5 OK ---\n");
})();

(async () => {
  // ============ GRUPO 6: abrirReasignarGrilla — visibilidad turno-aware ============
  async function correrVisibilidadReasignar(turno, rol) {
    const setupJs = setupComun() + `
      rolActualGrilla = ${JSON.stringify(rol)};
      datosUsuarioActualGrilla = { rol: ${JSON.stringify(rol)}, medicoId: "med1", nombre: "Prueba" };
      turnosCacheGrilla = [${JSON.stringify(turno)}];
      window.__listo = false;
      abrirReasignarGrilla(${JSON.stringify(turno.id)}).then(() => { window.__listo = true; });
    `;
    const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
    for (let i = 0; i < 50 && !dom.window.__listo; i++) { await new Promise(r => setTimeout(r, 0)); }
    return {
      horarioExacto: dom.window.document.getElementById("bloque-horario-manual-reasignar-grilla").style.display,
      buscar: dom.window.document.getElementById("boton-buscar-reasignar-grilla").style.display,
      etiqueta: dom.window.document.getElementById("etiqueta-fecha-reasignar-grilla").textContent
    };
  }

  {
    const r = await correrVisibilidadReasignar(TURNO_INTERNADO, "administrador");
    assert(r.horarioExacto === "block", "[reasignar internado, admin] horario exacto visible");
    assert(r.buscar === "none", "[reasignar internado, admin] \"Buscar disponibilidad\" oculto");
    assert(r.etiqueta === "Nueva fecha:", "[reasignar internado] etiqueta cambia a \"Nueva fecha:\"");
  }
  {
    const r = await correrVisibilidadReasignar(TURNO_INTERNADO, "enfermeria");
    assert(r.horarioExacto === "block", "[reasignar internado, enfermería] horario exacto visible (ampliado, antes era solo admin)");
    assert(r.buscar === "none", "[reasignar internado, enfermería] \"Buscar disponibilidad\" oculto");
  }
  {
    const r = await correrVisibilidadReasignar(TURNO_COMUN, "administrador");
    assert(r.horarioExacto === "block", "[regresión, reasignar turno común, admin] horario exacto sigue visible");
    assert(r.buscar === "block", "[regresión, reasignar turno común] \"Buscar disponibilidad\" sigue visible");
    assert(r.etiqueta === "Buscar disponibilidad a partir de:", "[regresión, reasignar turno común] etiqueta sin cambios");
  }
  {
    const r = await correrVisibilidadReasignar(TURNO_COMUN, "enfermeria");
    assert(r.horarioExacto === "none", "[regresión, reasignar turno común, enfermería] horario exacto SIGUE oculto (caso general sigue siendo solo admin)");
  }

  // ============ GRUPO 7: buscarReasignarHorarioManualGrilla enruta a guardarTurnoInternado ============
  async function correrReasignarHorarioExacto(turno) {
    const setupJs = setupComun() + `
      turnosCacheGrilla = [${JSON.stringify(turno)}];
      turnoIdReasignarActual = ${JSON.stringify(turno.id)};
      window.__spyInternado = null;
      window.__spyNormal = null;
      guardarTurnoInternado = async function(datosBasicos, horarioManualString) { window.__spyInternado = { datosBasicos, horarioManualString }; };
      buscarYGuardarConHorarioManual = async function(datosBasicos, horarioManualString) { window.__spyNormal = { datosBasicos, horarioManualString }; };
      document.getElementById("campo-fecha-reasignar-grilla").value = "2026-10-10";
      document.getElementById("campo-horario-manual-reasignar-grilla").value = "15:00";
      window.__listo = false;
      buscarReasignarHorarioManualGrilla().then(() => { window.__listo = true; });
    `;
    const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
    for (let i = 0; i < 50 && !dom.window.__listo; i++) { await new Promise(r => setTimeout(r, 0)); }
    return { spyInternado: dom.window.__spyInternado, spyNormal: dom.window.__spyNormal };
  }

  {
    const r = await correrReasignarHorarioExacto(TURNO_INTERNADO);
    assert(!!r.spyInternado, "[reasignar horario exacto, internado] llama a guardarTurnoInternado");
    assert(!r.spyNormal, "[reasignar horario exacto, internado] NO llama a buscarYGuardarConHorarioManual (nunca busca sillón)");
    assert(r.spyInternado.datosBasicos.modoReasignar === true, "[reasignar horario exacto, internado] modoReasignar true");
    assert(r.spyInternado.datosBasicos.turnoIdParaReasignar === "tInt", "[reasignar horario exacto, internado] turnoIdParaReasignar correcto");
    assert(r.spyInternado.horarioManualString === "15:00", "[reasignar horario exacto, internado] horario correcto");
  }
  {
    const r = await correrReasignarHorarioExacto(TURNO_COMUN);
    assert(!!r.spyNormal, "[regresión, reasignar horario exacto turno común] sigue llamando a buscarYGuardarConHorarioManual");
    assert(!r.spyInternado, "[regresión, reasignar horario exacto turno común] NO llama a guardarTurnoInternado");
  }

  console.log("\n--- Grupos 6 y 7 OK ---\n");
})();

// ============ GRUPO 8: botón Reasignar en el detalle, turno-aware ============
{
  const setupJs = `
    sedesCacheGrilla = ${JSON.stringify(SEDES)}; sedeSeleccionadaGrilla = "sede1";
    turnosCacheGrilla = [${JSON.stringify(TURNO_INTERNADO)}];
    rolActualGrilla = "medico"; datosUsuarioActualGrilla = { medicoId: "med1" }; medicosCacheGrilla = [];
    abrirDetalleTurnoGrilla("tInt");
    window.__html = document.getElementById("contenido-detalle-turno-grilla").innerHTML;
  `;
  const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  const html = dom.window.__html;
  // Etapa 5C, ajuste del 2.1 (decisión de Elías, cambia la decisión anterior): con un
  // internado solo interactúan administrador y enfermería — el médico ya no ve
  // Modificar/Eliminar ni siquiera en un internado propio.
  assert(!html.includes("abrirModificarGrilla") && !html.includes("abrirEliminarGrilla"), "[detalle, médico dueño de un internado] Modificar y Eliminar YA NO aparecen (solo admin/enfermería)");
  assert(!html.includes("abrirReasignarGrilla"), "[detalle, médico dueño de un internado] Reasignar NO aparece (solo admin/enfermería pueden)");
}
{
  const setupJs = `
    sedesCacheGrilla = ${JSON.stringify(SEDES)}; sedeSeleccionadaGrilla = "sede1";
    turnosCacheGrilla = [${JSON.stringify(TURNO_INTERNADO)}];
    rolActualGrilla = "administrador"; datosUsuarioActualGrilla = { medicoId: "med1" };
    abrirDetalleTurnoGrilla("tInt");
    window.__html = document.getElementById("contenido-detalle-turno-grilla").innerHTML;
  `;
  const dom = new JSDOM(domGrilla().replace("</body>", `<script>${setupJs}</script></body>`), { runScripts: "dangerously" });
  assert(dom.window.__html.includes("abrirReasignarGrilla"), "[detalle, administrador, internado] Reasignar SÍ aparece ahora (antes estaba bloqueado)");
}

console.log("\n--- Grupo 8 OK ---\n");
console.log("\nTODAS LAS PRUEBAS DE LA AMPLIACIÓN 2.1 PASARON\n");
