// Lógica del catálogo de pacientes (etapa 4).
// Colección "pacientes", ID de documento = `${tipoDocumento}-${numeroDocumento}`.
// Se usa esa combinación como ID porque el número de documento puede repetirse
// entre tipos distintos (DNI, LC, LE), a diferencia de un DNI que es único por sí solo.

const OBRAS_SOCIALES = [
  "ACLISA",
  "ACONCAGUA MEDICINA PREVENTIVA S.A",
  "ASOC MUTUAL 20 DE OCTUBRE",
  "PAPSI - ASOC. COOP HOSP CENTRAL PAPSI",
  "POP - ASOC. COOP HOSP CENTRAL PROG.ESPECIALES",
  "ASOCIACION MUTUAL SANCOR",
  "BOREAL - COBERTURA DE SALUD (BOREAL)",
  "PAMI - INSSJP - COIR SR",
  "CONFERENCIA EPISCOPAL ARGENTINA",
  "DAMSU-DPT.AS.ME.SO.U",
  "DASUTEN",
  "DELTA S.A.",
  "GALENO ARGENTINA S.A.",
  "GERENCIAMIENTO MEDICO SA",
  "HOSPITAL TEODORO SCHESTAKOW",
  "IOSFA",
  "ITER MEDICINA SA",
  "MEDICUS SA",
  "MEDIFE ASOCIACION CIVIL",
  "MUTUAL DEL PERSONAL DE AGUA Y ENERGIA",
  "OBRA SOCIAL DE PETROLEROS",
  "OBRA SOCIAL DEL PERSONAL DE FARMACIAS",
  "OBRA SOCIAL DEL PODER JUDICIAL DE LA NACION",
  "OBRA SOCIAL UNION PERS DE LA UNION PERS CIVIL DE LA NACION",
  "OMINT",
  "OSDE ORGANIZ DE SS DIRECTOS EMPRESARIOS",
  "OSDEPYM",
  "OSEP",
  "OSPELSYM",
  "OSPIA DELEG MENDOZA",
  "OSPJERA",
  "OSPSA - PERS.SANID.ARG",
  "OSSEG",
  "OSTES",
  "PARTICULAR",
  "POLICIA FED ARGENTINA",
  "PREVENCION SALUD SA",
  "PROFE - MENDOZA",
  "ROI SA",
  "SER SALUD PRESTACIONES SA",
  "SISTEMA DE COBERTURA INT. DE SALUD SA",
  "SUMA SALUD",
  "SWISS MEDICAL SA",
  "VISITAR SRL"
];

const TIPOS_DOCUMENTO = ["DNI", "LC", "LE"];
const OTRA_OBRA_SOCIAL = "OTRA";

let pacientesCache = [];
let rolActual = null;
let idEnEdicion = null;

function normalizarTexto(texto) {
  return (texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function soloDigitos(texto) {
  return (texto || "").replace(/\D/g, "");
}

function formatearNumeroDocumento(numero) {
  return (numero || "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function idPaciente(tipoDocumento, numeroDocumento) {
  return `${tipoDocumento}-${numeroDocumento}`;
}

function poblarSelectObraSocial(select) {
  select.innerHTML = "";
  const optVacia = document.createElement("option");
  optVacia.value = "";
  optVacia.textContent = "sin especificar";
  select.appendChild(optVacia);

  OBRAS_SOCIALES.forEach((os) => {
    const opt = document.createElement("option");
    opt.value = os;
    opt.textContent = os;
    select.appendChild(opt);
  });

  const optOtra = document.createElement("option");
  optOtra.value = OTRA_OBRA_SOCIAL;
  optOtra.textContent = "otra (especificar)";
  select.appendChild(optOtra);
}

function inicializarFormulario() {
  const selectObraSocial = document.getElementById("campo-obra-social");
  const inputOtraObraSocial = document.getElementById("campo-otra-obra-social");
  poblarSelectObraSocial(selectObraSocial);

  selectObraSocial.addEventListener("change", () => {
    const esOtra = selectObraSocial.value === OTRA_OBRA_SOCIAL;
    inputOtraObraSocial.style.display = esOtra ? "block" : "none";
    if (!esOtra) inputOtraObraSocial.value = "";
  });

  document.getElementById("campo-numero-documento").addEventListener("input", (e) => {
    e.target.value = soloDigitos(e.target.value).slice(0, 9);
  });

  document.getElementById("form-paciente").addEventListener("submit", async (e) => {
    e.preventDefault();
    await guardarPaciente();
  });

  document.getElementById("boton-cancelar-edicion").addEventListener("click", () => {
    resetearFormulario();
  });

  document.getElementById("campo-busqueda").addEventListener("input", (e) => {
    renderizarListado(e.target.value);
  });
}

function resetearFormulario() {
  idEnEdicion = null;
  document.getElementById("form-paciente").reset();
  document.getElementById("campo-otra-obra-social").style.display = "none";
  document.getElementById("campo-tipo-documento").disabled = false;
  document.getElementById("campo-numero-documento").disabled = false;
  document.getElementById("boton-cancelar-edicion").style.display = "none";
  document.getElementById("titulo-formulario").textContent = "Nuevo Paciente";
  document.getElementById("mensaje-form").style.display = "none";
}

function mostrarMensajeForm(texto, tipo) {
  const el = document.getElementById("mensaje-form");
  el.textContent = texto;
  el.className = `mensaje-info ${tipo}`;
  el.style.display = "block";
}

async function guardarPaciente() {
  const tipoDocumento = document.getElementById("campo-tipo-documento").value;
  const numeroDocumento = soloDigitos(document.getElementById("campo-numero-documento").value);
  const nombre = document.getElementById("campo-nombre").value.trim();
  const apellido = document.getElementById("campo-apellido").value.trim();
  const selectObraSocial = document.getElementById("campo-obra-social").value;
  const otraObraSocial = document.getElementById("campo-otra-obra-social").value.trim();

  if (numeroDocumento.length < 7 || numeroDocumento.length > 9) {
    mostrarMensajeForm("El número de documento debe tener entre 7 y 9 dígitos.", "error");
    return;
  }
  if (!nombre || !apellido) {
    mostrarMensajeForm("Nombre y apellido son obligatorios.", "error");
    return;
  }
  if (selectObraSocial === OTRA_OBRA_SOCIAL && !otraObraSocial) {
    mostrarMensajeForm("Especificá el nombre de la obra social.", "error");
    return;
  }

  const obraSocial = selectObraSocial === OTRA_OBRA_SOCIAL ? otraObraSocial : selectObraSocial;
  const id = idPaciente(tipoDocumento, numeroDocumento);
  const botonGuardar = document.getElementById("boton-guardar");
  botonGuardar.disabled = true;

  try {
    if (idEnEdicion) {
      await db.collection("pacientes").doc(idEnEdicion).update({
        nombre,
        apellido,
        obraSocial
      });
      mostrarMensajeForm("Paciente actualizado.", "exito");
    } else {
      const existente = await db.collection("pacientes").doc(id).get();
      if (existente.exists) {
        mostrarMensajeForm("Ya existe un paciente registrado con ese documento.", "error");
        botonGuardar.disabled = false;
        return;
      }
      await db.collection("pacientes").doc(id).set({
        tipoDocumento,
        numeroDocumento,
        nombre,
        apellido,
        obraSocial,
        activo: true,
        creadoEn: firebase.firestore.FieldValue.serverTimestamp()
      });
      mostrarMensajeForm("Paciente creado.", "exito");
    }
    resetearFormulario();
    await cargarPacientes();
  } catch (error) {
    console.error("Error al guardar paciente:", error);
    mostrarMensajeForm("No se pudo guardar. Reintentá en unos segundos.", "error");
  } finally {
    botonGuardar.disabled = false;
  }
}

function editarPaciente(id) {
  const paciente = pacientesCache.find((p) => p.id === id);
  if (!paciente) return;

  idEnEdicion = id;
  document.getElementById("campo-tipo-documento").value = paciente.tipoDocumento;
  document.getElementById("campo-tipo-documento").disabled = true;
  document.getElementById("campo-numero-documento").value = formatearNumeroDocumento(paciente.numeroDocumento);
  document.getElementById("campo-numero-documento").disabled = true;
  document.getElementById("campo-nombre").value = paciente.nombre;
  document.getElementById("campo-apellido").value = paciente.apellido;

  const selectObraSocial = document.getElementById("campo-obra-social");
  const inputOtraObraSocial = document.getElementById("campo-otra-obra-social");
  const esListada = OBRAS_SOCIALES.includes(paciente.obraSocial);
  if (paciente.obraSocial && !esListada) {
    selectObraSocial.value = OTRA_OBRA_SOCIAL;
    inputOtraObraSocial.style.display = "block";
    inputOtraObraSocial.value = paciente.obraSocial;
  } else {
    selectObraSocial.value = paciente.obraSocial || "";
    inputOtraObraSocial.style.display = "none";
  }

  document.getElementById("boton-cancelar-edicion").style.display = "inline-block";
  document.getElementById("titulo-formulario").textContent = "editar paciente";
  document.getElementById("mensaje-form").style.display = "none";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function cambiarEstadoPaciente(id, activo) {
  try {
    await db.collection("pacientes").doc(id).update({ activo });
    await cargarPacientes();
  } catch (error) {
    console.error("Error al cambiar estado del paciente:", error);
    alert("No se pudo actualizar el estado del paciente.");
  }
}

async function cargarPacientes() {
  const snapshot = await db.collection("pacientes").get();
  pacientesCache = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  pacientesCache.sort((a, b) =>
    `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, "es", { sensitivity: "base" })
  );
  renderizarListado(document.getElementById("campo-busqueda").value);
}

function renderizarListado(filtro) {
  const cuerpo = document.getElementById("cuerpo-tabla-pacientes");
  const filtroNormalizado = normalizarTexto(filtro);
  const filtroDigitos = soloDigitos(filtro);

  const filtrados = pacientesCache.filter((p) => {
    if (!filtroNormalizado && !filtroDigitos) return true;
    const coincideNombre = normalizarTexto(`${p.apellido} ${p.nombre}`).includes(filtroNormalizado);
    const coincideDocumento = filtroDigitos && p.numeroDocumento.includes(filtroDigitos);
    return coincideNombre || coincideDocumento;
  });

  cuerpo.innerHTML = "";

  if (filtrados.length === 0) {
    cuerpo.innerHTML = `<tr><td colspan="5" style="color:var(--color-muted);padding:16px 6px;">No se encontraron pacientes.</td></tr>`;
    return;
  }

  filtrados.forEach((p) => {
    const fila = document.createElement("tr");
    if (p.activo === false) fila.className = "inactivo";

    const puedeEditar = rolActual === "administrador" || rolActual === "enfermeria";
    const acciones = puedeEditar
      ? `<button class="enlace-accion" onclick="editarPaciente('${p.id}')">editar</button>
         <button class="enlace-accion peligro" onclick="cambiarEstadoPaciente('${p.id}', ${p.activo === false})">
           ${p.activo === false ? "reactivar" : "dar de baja"}
         </button>`
      : "";

    fila.innerHTML = `
      <td>${p.tipoDocumento}</td>
      <td>${formatearNumeroDocumento(p.numeroDocumento)}</td>
      <td>${p.apellido}, ${p.nombre}${p.activo === false ? ' <span class="badge">inactivo</span>' : ""}</td>
      <td>${p.obraSocial ? p.obraSocial : '<span style="color:var(--color-muted);">—</span>'}</td>
      <td class="acciones-fila">${acciones}</td>
    `;
    cuerpo.appendChild(fila);
  });
}

function aplicarPermisos(rol) {
  rolActual = rol;
  const puedeEditar = rol === "administrador" || rol === "enfermeria";
  document.getElementById("tarjeta-form-paciente").style.display = puedeEditar ? "block" : "none";
}
