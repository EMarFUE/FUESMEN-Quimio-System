// Lógica de la pantalla de historial de comprobantes (etapa 8).
// No depende de entregas.js, egresos.js, pacientes.js ni medicamentos.js: misma
// independencia por página que ya usa el resto del sistema.
//
// Criterio de carga (distinto al de catálogo/pacientes/stock, ver Handoff_etapa_8.md):
// "entregas" crece todos los días sin techo, así que acá NO se trae toda la colección
// de una vez. Se pagina con consultas a Firestore ordenadas por fecha (de a
// TAMANO_PAGINA registros, con "cargar más"), y los filtros disparan su propia
// consulta acotada en vez de filtrar sobre lo ya traído al navegador. Los cuatro
// modos son mutuamente excluyentes -uno a la vez- para no depender de índices
// compuestos innecesarios.
//
// Índices de Firestore que este archivo puede llegar a pedir la primera vez que se
// usa cada filtro (Firestore tira un enlace directo en la consola del navegador,
// F12, para crearlos con un clic si hace falta):
//   - "por paciente": paciente.id (==) + creadoEn (orderBy)
//   - "por ciclo y sesión": ciclo (==) + sesion (==) + creadoEn (orderBy)
// "Recientes" y "por rango de fechas" no piden índice adicional porque el rango y
// el orden caen sobre el mismo campo (creadoEn).

const TAMANO_PAGINA = 25;

let estadoFiltroHistorial = {
  modo: "recientes", // recientes | paciente | ciclo-sesion | fecha
  pacienteId: null,
  ciclo: null,
  sesion: null,
  fechaDesde: null,
  fechaHasta: null
};

let cursorHistorial = null;
let hayMasHistorial = true;
let cargandoHistorial = false;

let pacientesCacheHistorial = null; // null = todavía no se cargó
let cargandoPacientesHistorial = false;

function normalizarTexto(texto) {
  return (texto || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function soloDigitos(texto) {
  return (texto || "").toString().replace(/\D/g, "");
}

function formatearFechaHora(timestamp) {
  if (!timestamp) return "—";
  const fecha = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return fecha.toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function iniciarHistorial() {
  configurarTabsHistorial();
  document.getElementById("campo-buscar-paciente-historial").addEventListener("input", (e) => buscarPacienteHistorial(e.target.value));
  document.getElementById("campo-filtro-ciclo").addEventListener("input", (e) => { e.target.value = soloDigitos(e.target.value); });
  document.getElementById("campo-filtro-sesion").addEventListener("input", (e) => { e.target.value = soloDigitos(e.target.value); });

  // No se espera esta carga: la página ya se reveló (o está por revelarse) sin
  // depender de ella.
  cargarPaginaHistorial(true);
}

function configurarTabsHistorial() {
  document.querySelectorAll(".filtro-tab").forEach((btn) => {
    btn.addEventListener("click", () => cambiarModoFiltroHistorial(btn.dataset.modo));
  });
}

function cambiarModoFiltroHistorial(modo) {
  estadoFiltroHistorial.modo = modo;

  document.querySelectorAll(".filtro-tab").forEach((btn) => {
    btn.classList.toggle("activo", btn.dataset.modo === modo);
  });
  document.getElementById("bloque-filtro-paciente").style.display = modo === "paciente" ? "block" : "none";
  document.getElementById("bloque-filtro-ciclo-sesion").style.display = modo === "ciclo-sesion" ? "block" : "none";
  document.getElementById("bloque-filtro-fecha").style.display = modo === "fecha" ? "block" : "none";

  if (modo === "recientes") {
    cargarPaginaHistorial(true);
    return;
  }

  if (modo === "paciente") {
    cargarPacientesHistorialSiHaceFalta();
    if (estadoFiltroHistorial.pacienteId) {
      cargarPaginaHistorial(true);
    } else {
      mostrarPlaceholderHistorial("Elegí un paciente para ver su historial.");
    }
    return;
  }

  if (modo === "ciclo-sesion") {
    if (estadoFiltroHistorial.ciclo && estadoFiltroHistorial.sesion) {
      cargarPaginaHistorial(true);
    } else {
      mostrarPlaceholderHistorial("Completá ciclo y sesión y presioná «Buscar».");
    }
    return;
  }

  if (modo === "fecha") {
    if (estadoFiltroHistorial.fechaDesde && estadoFiltroHistorial.fechaHasta) {
      cargarPaginaHistorial(true);
    } else {
      mostrarPlaceholderHistorial("Completá el rango de fechas y presioná «Buscar».");
    }
  }
}

function mostrarPlaceholderHistorial(texto) {
  document.getElementById("cuerpo-tabla-historial").innerHTML =
    `<tr><td colspan="7" style="color:var(--color-muted);padding:16px 6px;">${texto}</td></tr>`;
  document.getElementById("zona-cargar-mas").style.display = "none";
}

// --- Construcción y ejecución de la consulta paginada ---

function construirConsultaHistorial() {
  let consulta = db.collection("entregas");

  if (estadoFiltroHistorial.modo === "paciente") {
    consulta = consulta.where("paciente.id", "==", estadoFiltroHistorial.pacienteId);
  } else if (estadoFiltroHistorial.modo === "ciclo-sesion") {
    consulta = consulta
      .where("ciclo", "==", estadoFiltroHistorial.ciclo)
      .where("sesion", "==", estadoFiltroHistorial.sesion);
  } else if (estadoFiltroHistorial.modo === "fecha") {
    consulta = consulta
      .where("creadoEn", ">=", estadoFiltroHistorial.fechaDesde)
      .where("creadoEn", "<=", estadoFiltroHistorial.fechaHasta);
  }

  consulta = consulta.orderBy("creadoEn", "desc").limit(TAMANO_PAGINA);
  if (cursorHistorial) consulta = consulta.startAfter(cursorHistorial);
  return consulta;
}

async function cargarPaginaHistorial(reset) {
  if (cargandoHistorial) return;
  cargandoHistorial = true;

  const tbody = document.getElementById("cuerpo-tabla-historial");
  const botonMas = document.getElementById("boton-cargar-mas");

  if (reset) {
    cursorHistorial = null;
    hayMasHistorial = true;
    tbody.innerHTML = `<tr><td colspan="7" style="color:var(--color-muted);">Cargando...</td></tr>`;
  }
  botonMas.disabled = true;
  botonMas.textContent = "Cargando...";

  try {
    const snapshot = await construirConsultaHistorial().get();

    if (reset) tbody.innerHTML = "";

    if (snapshot.empty && reset) {
      tbody.innerHTML = `<tr><td colspan="7" style="color:var(--color-muted);padding:16px 6px;">No hay comprobantes con ese filtro.</td></tr>`;
    } else {
      snapshot.docs.forEach((doc) => tbody.appendChild(filaHistorial(doc.id, doc.data())));
    }

    hayMasHistorial = snapshot.docs.length === TAMANO_PAGINA;
    if (snapshot.docs.length > 0) cursorHistorial = snapshot.docs[snapshot.docs.length - 1];
    actualizarBotonCargarMasHistorial();
  } catch (error) {
    console.error("Error al cargar el historial:", error);
    if (reset) {
      tbody.innerHTML = `<tr><td colspan="7" style="color:var(--color-danger);padding:16px 6px;">
        No se pudo cargar el historial. Si es la primera vez que se usa este filtro, puede
        faltar crear un índice en Firestore — abrí la consola del navegador (F12): el error
        trae un enlace directo para crearlo con un clic.
      </td></tr>`;
    }
    hayMasHistorial = false;
    actualizarBotonCargarMasHistorial();
  } finally {
    cargandoHistorial = false;
    botonMas.disabled = false;
    botonMas.textContent = "Cargar más";
  }
}

function cargarMasHistorial() {
  cargarPaginaHistorial(false);
}

function actualizarBotonCargarMasHistorial() {
  document.getElementById("zona-cargar-mas").style.display = hayMasHistorial ? "block" : "none";
}

function filaHistorial(id, d) {
  const tr = document.createElement("tr");
  const fecha = formatearFechaHora(d.creadoEn);
  const tipo = d.esDonacion
    ? '<span class="badge-donacion">donación</span>'
    : '<span class="badge-ingreso">ingreso</span>';
  const tratamiento = (d.egresoVinculadoId && d.ciclo && d.sesion)
    ? `ciclo ${d.ciclo} / sesión ${d.sesion}`
    : '<span style="color:var(--color-muted);">—</span>';
  const numero = d.numeroComprobante ? `N.° ${d.numeroComprobante}` : `ID ${id.slice(0, 8)}`;
  const paciente = d.paciente || {};

  tr.innerHTML = `
    <td>${fecha}</td>
    <td>${paciente.apellido || ""}, ${paciente.nombre || ""}<br><span style="color:var(--color-muted);font-size:12px;">${paciente.tipoDocumento || ""} ${paciente.numeroDocumento || ""}</span></td>
    <td>${d.deposito || ""}</td>
    <td>${tipo}</td>
    <td>${tratamiento}</td>
    <td>${numero}</td>
    <td class="acciones-fila"><a class="enlace-accion" href="comprobante.html?id=${id}" target="_blank">Reimprimir</a></td>
  `;
  return tr;
}

// --- Filtro por paciente: carga perezosa del listado (solo si se usa este filtro) ---

async function cargarPacientesHistorialSiHaceFalta() {
  if (pacientesCacheHistorial || cargandoPacientesHistorial) return;
  cargandoPacientesHistorial = true;

  const campo = document.getElementById("campo-buscar-paciente-historial");
  campo.disabled = true;
  campo.placeholder = "Cargando listado de pacientes…";

  try {
    const snapshot = await db.collection("pacientes").where("activo", "==", true).get();
    pacientesCacheHistorial = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error al cargar pacientes:", error);
    pacientesCacheHistorial = [];
  } finally {
    cargandoPacientesHistorial = false;
    campo.disabled = false;
    campo.placeholder = "Buscar por apellido, nombre o documento";
  }
}

function buscarPacienteHistorial(texto) {
  const cont = document.getElementById("resultados-busqueda-paciente-historial");
  const sinResultados = document.getElementById("sin-resultados-historial");
  cont.innerHTML = "";

  if (!texto.trim() || !pacientesCacheHistorial) {
    sinResultados.style.display = "none";
    return;
  }

  const norm = normalizarTexto(texto);
  const digitos = soloDigitos(texto);
  const encontrados = pacientesCacheHistorial.filter((p) => {
    const coincideNombre = normalizarTexto(`${p.apellido} ${p.nombre}`).includes(norm);
    const coincideDocumento = digitos && p.numeroDocumento.includes(digitos);
    return coincideNombre || coincideDocumento;
  });

  if (encontrados.length === 0) {
    sinResultados.style.display = "block";
    return;
  }
  sinResultados.style.display = "none";

  encontrados.slice(0, 8).forEach((p) => {
    const div = document.createElement("div");
    div.className = "resultado-busqueda";
    div.innerHTML = `<span>${p.apellido}, ${p.nombre} · ${p.tipoDocumento} ${p.numeroDocumento}</span>
      <button type="button" class="enlace-accion" data-id="${p.id}">usar</button>`;
    div.querySelector("button").addEventListener("click", () => seleccionarPacienteHistorial(p));
    cont.appendChild(div);
  });
}

function seleccionarPacienteHistorial(p) {
  estadoFiltroHistorial.pacienteId = p.id;

  document.getElementById("campo-buscar-paciente-historial").value = "";
  document.getElementById("resultados-busqueda-paciente-historial").innerHTML = "";
  document.getElementById("sin-resultados-historial").style.display = "none";
  document.getElementById("bloque-busqueda-paciente-historial").style.display = "none";

  const cont = document.getElementById("paciente-seleccionado-historial");
  cont.style.display = "flex";
  document.getElementById("texto-paciente-seleccionado-historial").innerHTML =
    `<strong>${p.apellido}, ${p.nombre}</strong> · ${p.tipoDocumento} ${p.numeroDocumento}`;

  cargarPaginaHistorial(true);
}

function quitarPacienteSeleccionadoHistorial() {
  estadoFiltroHistorial.pacienteId = null;

  document.getElementById("paciente-seleccionado-historial").style.display = "none";
  document.getElementById("bloque-busqueda-paciente-historial").style.display = "block";

  mostrarPlaceholderHistorial("Elegí un paciente para ver su historial.");
}

// --- Filtro por ciclo y sesión ---

function aplicarFiltroCicloSesion() {
  const ciclo = parseInt(document.getElementById("campo-filtro-ciclo").value, 10);
  const sesion = parseInt(document.getElementById("campo-filtro-sesion").value, 10);

  if (!ciclo || ciclo < 1 || !sesion || sesion < 1) {
    alert("Ingresá ciclo y sesión, ambos mayores o iguales a 1.");
    return;
  }

  estadoFiltroHistorial.ciclo = ciclo;
  estadoFiltroHistorial.sesion = sesion;
  cargarPaginaHistorial(true);
}

// --- Filtro por rango de fechas ---

function aplicarFiltroFecha() {
  const desdeStr = document.getElementById("campo-filtro-fecha-desde").value;
  const hastaStr = document.getElementById("campo-filtro-fecha-hasta").value;

  if (!desdeStr || !hastaStr) {
    alert("Completá las dos fechas.");
    return;
  }

  const desde = new Date(desdeStr + "T00:00:00");
  const hasta = new Date(hastaStr + "T23:59:59");

  if (desde > hasta) {
    alert('La fecha "desde" no puede ser posterior a la fecha "hasta".');
    return;
  }

  estadoFiltroHistorial.fechaDesde = desde;
  estadoFiltroHistorial.fechaHasta = hasta;
  cargarPaginaHistorial(true);
}
