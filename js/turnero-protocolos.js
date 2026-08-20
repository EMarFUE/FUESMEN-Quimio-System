// Lógica del catálogo de protocolos del módulo de Turnero (etapa T0).
// Colección "turneroProtocolos". Mismo patrón que medicamentos.js (etapa 3 de Medicación):
// alta manual, edición y baja lógica (activo:false), más importación masiva desde Excel.
// Pantalla exclusiva de administrador (ver punto 16 del alcance de Turnero).

let protocolosCache = [];
let protocolosImportacionPendientes = [];
let filtroProtocolos = "";

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

// Quita tildes, espacios extra y pasa a minúscula, para comparar sin falsos duplicados
// por mayúsculas o acentos distintos. Mismo criterio que medicamentos.js.
function normalizarTexto(texto) {
  return (texto || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

function iniciarProtocolos() {
  document.getElementById("form-protocolo").addEventListener("submit", onGuardarProtocolo);
  document.getElementById("input-excel-protocolos").addEventListener("change", onArchivoExcelSeleccionado);
  document.getElementById("boton-confirmar-importacion-protocolos").addEventListener("click", onConfirmarImportacion);
  document.getElementById("input-buscar-protocolo").addEventListener("input", (e) => {
    filtroProtocolos = normalizarTexto(e.target.value);
    renderizarTabla();
  });
  cargarProtocolos();
}

function mostrarMensaje(texto, tipo) {
  const contenedor = document.getElementById("mensaje-protocolos");
  contenedor.textContent = texto;
  contenedor.className = "mensaje-info " + (tipo || "info");
  contenedor.style.display = "block";
  setTimeout(() => { contenedor.style.display = "none"; }, 5000);
}

async function cargarProtocolos() {
  const tbody = document.getElementById("cuerpo-tabla-protocolos");
  tbody.innerHTML = `<tr><td colspan="3" style="color:var(--color-muted);">Cargando...</td></tr>`;

  try {
    const snapshot = await db.collection("turneroProtocolos").get();
    protocolosCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    protocolosCache.sort((a, b) => (a.nombre || "").localeCompare(b.nombre || "", "es"));
    renderizarTabla();
  } catch (error) {
    console.error("Error al cargar protocolos:", error);
    tbody.innerHTML = `<tr><td colspan="3" style="color:var(--color-danger);">No se pudo cargar el catálogo.</td></tr>`;
  }
}

function renderizarTabla() {
  const tbody = document.getElementById("cuerpo-tabla-protocolos");
  const lista = filtroProtocolos
    ? protocolosCache.filter(p => normalizarTexto(p.nombre).includes(filtroProtocolos))
    : protocolosCache;

  if (protocolosCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="color:var(--color-muted);">Todavía no hay protocolos cargados.</td></tr>`;
    return;
  }

  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="color:var(--color-muted);">Ningún protocolo coincide con la búsqueda.</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(p => {
    const inactivo = p.activo === false;
    const filaClase = inactivo ? "inactivo" : "";
    const badgeInactivo = inactivo ? ` <span class="badge">inactivo</span>` : "";

    let acciones = "";
    if (inactivo) {
      acciones = `<button type="button" class="enlace-accion" onclick="reactivarProtocolo('${p.id}')">reactivar</button>`;
    } else {
      acciones = `
        <button type="button" class="enlace-accion" onclick="editarProtocolo('${p.id}')">editar</button>
        <button type="button" class="enlace-accion peligro" onclick="eliminarProtocolo('${p.id}')">eliminar</button>
      `;
    }

    return `
      <tr class="${filaClase}" data-id="${p.id}">
        <td>${escaparHtml(p.nombre)}${badgeInactivo}</td>
        <td>${p.duracionMinutos} min</td>
        <td class="acciones-fila">${acciones}</td>
      </tr>
    `;
  }).join("");
}

async function onGuardarProtocolo(evento) {
  evento.preventDefault();

  const inputNombre = document.getElementById("input-nombre-protocolo");
  const inputDuracion = document.getElementById("input-duracion-protocolo");
  const nombre = inputNombre.value.trim();
  const duracionMinutos = parseInt(inputDuracion.value, 10);

  if (!nombre) {
    mostrarMensaje("El nombre del protocolo es obligatorio.", "error");
    return;
  }
  if (!duracionMinutos || duracionMinutos <= 0) {
    mostrarMensaje("La duración tiene que ser un número mayor a cero.", "error");
    return;
  }

  const clave = normalizarTexto(nombre);
  const yaExiste = protocolosCache.some(p => p.activo !== false && normalizarTexto(p.nombre) === clave);
  if (yaExiste) {
    mostrarMensaje("Ese protocolo ya está cargado en el catálogo.", "error");
    return;
  }

  try {
    await db.collection("turneroProtocolos").add({
      nombre,
      duracionMinutos,
      activo: true,
      claveNormalizada: clave,
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    inputNombre.value = "";
    inputDuracion.value = "";
    mostrarMensaje("Protocolo guardado.", "exito");
    cargarProtocolos();
  } catch (error) {
    console.error("Error al guardar protocolo:", error);
    mostrarMensaje("No se pudo guardar el protocolo.", "error");
  }
}

async function editarProtocolo(id) {
  const protocolo = protocolosCache.find(p => p.id === id);
  if (!protocolo) return;

  const nuevoNombre = prompt("Protocolo / droga:", protocolo.nombre);
  if (nuevoNombre === null) return;
  const nuevaDuracionTexto = prompt("Duración (minutos):", protocolo.duracionMinutos);
  if (nuevaDuracionTexto === null) return;

  const nuevaDuracion = parseInt(nuevaDuracionTexto, 10);
  if (!nuevoNombre.trim()) {
    mostrarMensaje("El nombre del protocolo es obligatorio.", "error");
    return;
  }
  if (!nuevaDuracion || nuevaDuracion <= 0) {
    mostrarMensaje("La duración tiene que ser un número mayor a cero.", "error");
    return;
  }

  try {
    await db.collection("turneroProtocolos").doc(id).update({
      nombre: nuevoNombre.trim(),
      duracionMinutos: nuevaDuracion,
      claveNormalizada: normalizarTexto(nuevoNombre)
    });
    mostrarMensaje("Protocolo actualizado.", "exito");
    cargarProtocolos();
  } catch (error) {
    console.error("Error al editar protocolo:", error);
    mostrarMensaje("No se pudo actualizar el protocolo.", "error");
  }
}

async function eliminarProtocolo(id) {
  if (!confirm("¿Dar de baja este protocolo? No va a aparecer como opción al cargar un turno, pero se conserva en el historial.")) return;

  try {
    await db.collection("turneroProtocolos").doc(id).update({ activo: false });
    mostrarMensaje("Protocolo dado de baja.", "exito");
    cargarProtocolos();
  } catch (error) {
    console.error("Error al dar de baja el protocolo:", error);
    mostrarMensaje("No se pudo dar de baja el protocolo.", "error");
  }
}

async function reactivarProtocolo(id) {
  try {
    await db.collection("turneroProtocolos").doc(id).update({ activo: true });
    mostrarMensaje("Protocolo reactivado.", "exito");
    cargarProtocolos();
  } catch (error) {
    console.error("Error al reactivar el protocolo:", error);
    mostrarMensaje("No se pudo reactivar el protocolo.", "error");
  }
}

// --- Importación desde Excel ---
// Reconoce las columnas del listado real ("Estudio", "Duración (min.)", "Estudio Id"),
// pero también nombres más genéricos por si se reimporta un archivo con otro formato.

function obtenerValorColumna(fila, nombresPosibles) {
  const claves = Object.keys(fila);
  for (const clave of claves) {
    if (nombresPosibles.includes(normalizarTexto(clave))) {
      return fila[clave];
    }
  }
  return "";
}

function onArchivoExcelSeleccionado(evento) {
  const archivo = evento.target.files[0];
  if (!archivo) return;

  const lector = new FileReader();
  lector.onload = (e) => {
    try {
      const datos = new Uint8Array(e.target.result);
      const libro = XLSX.read(datos, { type: "array" });
      const hoja = libro.Sheets[libro.SheetNames[0]];
      const filas = XLSX.utils.sheet_to_json(hoja, { defval: "" });
      procesarFilasImportadas(filas, archivo.name);
    } catch (error) {
      console.error("Error al leer el Excel:", error);
      mostrarMensaje("No se pudo leer el archivo. Verificá que sea un .xlsx válido.", "error");
    }
  };
  lector.readAsArrayBuffer(archivo);
}

function procesarFilasImportadas(filas, nombreArchivo) {
  const clavesExistentes = new Set(
    protocolosCache.filter(p => p.activo !== false).map(p => normalizarTexto(p.nombre))
  );
  const vistasEnEsteArchivo = new Set();

  protocolosImportacionPendientes = [];

  filas.forEach(fila => {
    const nombre = String(obtenerValorColumna(fila, ["estudio", "protocolo", "nombre", "droga"]) || "").trim();
    const duracionTexto = obtenerValorColumna(fila, ["duracion (min.)", "duracion", "duracion_min", "minutos", "duracion minutos"]);
    const duracionMinutos = parseInt(duracionTexto, 10);
    const idOrigenTexto = obtenerValorColumna(fila, ["estudio id", "id"]);
    const idOrigen = idOrigenTexto !== "" ? parseInt(idOrigenTexto, 10) : null;

    if (!nombre || !duracionMinutos || duracionMinutos <= 0) return;

    const clave = normalizarTexto(nombre);
    let estado = "nuevo";

    if (clavesExistentes.has(clave) || vistasEnEsteArchivo.has(clave)) {
      estado = "existe";
    } else {
      vistasEnEsteArchivo.add(clave);
    }

    protocolosImportacionPendientes.push({ nombre, duracionMinutos, idOrigen, clave, estado });
  });

  renderizarPreviaImportacion(nombreArchivo);
}

function renderizarPreviaImportacion(nombreArchivo) {
  const contenedor = document.getElementById("previa-importacion-protocolos");
  const cuerpoTabla = document.getElementById("cuerpo-tabla-previa-protocolos");
  const nuevos = protocolosImportacionPendientes.filter(f => f.estado === "nuevo").length;

  document.getElementById("nombre-archivo-importacion-protocolos").textContent = nombreArchivo;

  cuerpoTabla.innerHTML = protocolosImportacionPendientes.map(fila => `
    <tr>
      <td>${escaparHtml(fila.nombre)}</td>
      <td>${fila.duracionMinutos} min</td>
      <td>${fila.estado === "nuevo"
        ? `<span class="badge badge-nuevo">nuevo</span>`
        : `<span class="badge">ya existe, se omite</span>`}</td>
    </tr>
  `).join("");

  document.getElementById("boton-confirmar-importacion-protocolos").textContent = `Confirmar importación (${nuevos} nuevos)`;
  document.getElementById("boton-confirmar-importacion-protocolos").disabled = nuevos === 0;
  contenedor.style.display = "block";
}

async function onConfirmarImportacion() {
  const nuevos = protocolosImportacionPendientes.filter(f => f.estado === "nuevo");
  if (nuevos.length === 0) return;

  const boton = document.getElementById("boton-confirmar-importacion-protocolos");
  boton.disabled = true;
  boton.textContent = "Importando...";

  try {
    // Firestore permite hasta 500 operaciones por batch; el listado real (438 filas)
    // entra en un solo batch, pero se divide en bloques de 400 por margen de seguridad
    // ante catálogos más grandes en el futuro.
    const bloques = [];
    for (let i = 0; i < nuevos.length; i += 400) {
      bloques.push(nuevos.slice(i, i + 400));
    }

    for (const bloque of bloques) {
      const batch = db.batch();
      bloque.forEach(fila => {
        const ref = db.collection("turneroProtocolos").doc();
        batch.set(ref, {
          nombre: fila.nombre,
          duracionMinutos: fila.duracionMinutos,
          idOrigen: fila.idOrigen,
          activo: true,
          claveNormalizada: fila.clave,
          creadoEn: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
      await batch.commit();
    }

    mostrarMensaje(`Se importaron ${nuevos.length} protocolos.`, "exito");
    protocolosImportacionPendientes = [];
    document.getElementById("previa-importacion-protocolos").style.display = "none";
    document.getElementById("input-excel-protocolos").value = "";
    cargarProtocolos();
  } catch (error) {
    console.error("Error al importar protocolos:", error);
    mostrarMensaje("No se pudo completar la importación.", "error");
  } finally {
    boton.disabled = false;
  }
}
