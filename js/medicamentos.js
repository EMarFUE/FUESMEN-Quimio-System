// Lógica del catálogo de medicamentos (etapa 3).
// Requiere que firebase-config.js y auth.js ya estén cargados antes que este archivo,
// y que la librería SheetJS (xlsx.full.min.js) esté cargada para la importación.

const ROLES_EDICION_CATALOGO = ["administrador", "enfermeria"];

let medicamentosCache = [];
let puedeEditarCatalogo = false;
let filasImportacionPendientes = [];

// Quita tildes, espacios extra y pasa a minúscula, para comparar sin falsos duplicados
// por mayúsculas o acentos distintos.
function normalizarTexto(texto) {
  return (texto || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function claveMedicamento(droga, marca) {
  return normalizarTexto(droga) + "|" + normalizarTexto(marca);
}

function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto == null ? "" : String(texto);
  return div.innerHTML;
}

function iniciarCatalogo(datosUsuario) {
  puedeEditarCatalogo = ROLES_EDICION_CATALOGO.includes(datosUsuario.rol);

  if (!puedeEditarCatalogo) {
    document.getElementById("bloque-alta").style.display = "none";
    document.getElementById("bloque-importacion").style.display = "none";
  } else {
    document.getElementById("form-medicamento").addEventListener("submit", onGuardarMedicamento);
    document.getElementById("input-excel").addEventListener("change", onArchivoExcelSeleccionado);
    document.getElementById("boton-confirmar-importacion").addEventListener("click", onConfirmarImportacion);
  }

  cargarMedicamentos();
}

function mostrarMensaje(texto, tipo) {
  const contenedor = document.getElementById("mensaje-catalogo");
  contenedor.textContent = texto;
  contenedor.className = "mensaje-info " + (tipo || "info");
  contenedor.style.display = "block";
  setTimeout(() => { contenedor.style.display = "none"; }, 5000);
}

async function cargarMedicamentos() {
  const tbody = document.getElementById("cuerpo-tabla-medicamentos");
  tbody.innerHTML = `<tr><td colspan="3" style="color:var(--color-muted);">Cargando...</td></tr>`;

  try {
    const snapshot = await db.collection("medicamentos").orderBy("droga").get();
    medicamentosCache = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    renderizarTabla();
  } catch (error) {
    console.error("Error al cargar medicamentos:", error);
    tbody.innerHTML = `<tr><td colspan="3" style="color:var(--color-danger);">No se pudo cargar el catálogo.</td></tr>`;
  }
}

function renderizarTabla() {
  const tbody = document.getElementById("cuerpo-tabla-medicamentos");

  if (medicamentosCache.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="color:var(--color-muted);">Todavía no hay medicamentos cargados.</td></tr>`;
    return;
  }

  tbody.innerHTML = medicamentosCache.map(med => {
    const inactivo = med.activo === false;
    const filaClase = inactivo ? "inactivo" : "";
    const marca = med.marca ? med.marca : "—";
    const badgeInactivo = inactivo ? ` <span class="badge">inactivo</span>` : "";

    let acciones = "";
    if (puedeEditarCatalogo) {
      if (inactivo) {
        acciones = `<button type="button" class="enlace-accion" onclick="reactivarMedicamento('${med.id}')">reactivar</button>`;
      } else {
        acciones = `
          <button type="button" class="enlace-accion" onclick="editarMedicamento('${med.id}')">editar</button>
          <button type="button" class="enlace-accion peligro" onclick="eliminarMedicamento('${med.id}')">eliminar</button>
        `;
      }
    }

    return `
      <tr class="${filaClase}" data-id="${med.id}">
        <td>${escaparHtml(med.droga)}${badgeInactivo}</td>
        <td>${escaparHtml(marca)}</td>
        <td class="acciones-fila">${acciones}</td>
      </tr>
    `;
  }).join("");
}

async function onGuardarMedicamento(evento) {
  evento.preventDefault();

  const inputDroga = document.getElementById("input-droga");
  const inputMarca = document.getElementById("input-marca");
  const droga = inputDroga.value.trim();
  const marca = inputMarca.value.trim();

  if (!droga) {
    mostrarMensaje("La droga es obligatoria.", "error");
    return;
  }

  const clave = claveMedicamento(droga, marca);
  const yaExiste = medicamentosCache.some(
    med => med.activo !== false && claveMedicamento(med.droga, med.marca) === clave
  );

  if (yaExiste) {
    mostrarMensaje("Ese medicamento ya está cargado en el catálogo.", "error");
    return;
  }

  try {
    await db.collection("medicamentos").add({
      droga,
      marca,
      activo: true,
      claveNormalizada: clave,
      creadoEn: firebase.firestore.FieldValue.serverTimestamp()
    });
    inputDroga.value = "";
    inputMarca.value = "";
    mostrarMensaje("Medicamento guardado.", "exito");
    cargarMedicamentos();
  } catch (error) {
    console.error("Error al guardar medicamento:", error);
    mostrarMensaje("No se pudo guardar el medicamento.", "error");
  }
}

async function editarMedicamento(id) {
  const medicamento = medicamentosCache.find(med => med.id === id);
  if (!medicamento) return;

  const nuevaDroga = prompt("Droga:", medicamento.droga);
  if (nuevaDroga === null) return;
  const nuevaMarca = prompt("Marca (opcional):", medicamento.marca || "");
  if (nuevaMarca === null) return;

  if (!nuevaDroga.trim()) {
    mostrarMensaje("La droga es obligatoria.", "error");
    return;
  }

  try {
    await db.collection("medicamentos").doc(id).update({
      droga: nuevaDroga.trim(),
      marca: nuevaMarca.trim(),
      claveNormalizada: claveMedicamento(nuevaDroga, nuevaMarca)
    });
    mostrarMensaje("Medicamento actualizado.", "exito");
    cargarMedicamentos();
  } catch (error) {
    console.error("Error al editar medicamento:", error);
    mostrarMensaje("No se pudo actualizar el medicamento.", "error");
  }
}

async function eliminarMedicamento(id) {
  if (!confirm("¿Dar de baja este medicamento? No va a aparecer como opción, pero se conserva en el historial.")) return;

  try {
    await db.collection("medicamentos").doc(id).update({ activo: false });
    mostrarMensaje("Medicamento dado de baja.", "exito");
    cargarMedicamentos();
  } catch (error) {
    console.error("Error al dar de baja el medicamento:", error);
    mostrarMensaje("No se pudo dar de baja el medicamento.", "error");
  }
}

async function reactivarMedicamento(id) {
  try {
    await db.collection("medicamentos").doc(id).update({ activo: true });
    mostrarMensaje("Medicamento reactivado.", "exito");
    cargarMedicamentos();
  } catch (error) {
    console.error("Error al reactivar el medicamento:", error);
    mostrarMensaje("No se pudo reactivar el medicamento.", "error");
  }
}

// --- Importación desde Excel ---

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

function obtenerValorColumna(fila, nombresPosibles) {
  const claves = Object.keys(fila);
  for (const clave of claves) {
    if (nombresPosibles.includes(normalizarTexto(clave))) {
      return fila[clave];
    }
  }
  return "";
}

function procesarFilasImportadas(filas, nombreArchivo) {
  const clavesExistentes = new Set(
    medicamentosCache.filter(med => med.activo !== false).map(med => claveMedicamento(med.droga, med.marca))
  );
  const vistasEnEsteArchivo = new Set();

  filasImportacionPendientes = [];

  filas.forEach(fila => {
    const droga = String(obtenerValorColumna(fila, ["droga", "medicamento"]) || "").trim();
    const marca = String(obtenerValorColumna(fila, ["marca"]) || "").trim();

    if (!droga) return;

    const clave = claveMedicamento(droga, marca);
    let estado = "nuevo";

    if (clavesExistentes.has(clave) || vistasEnEsteArchivo.has(clave)) {
      estado = "existe";
    } else {
      vistasEnEsteArchivo.add(clave);
    }

    filasImportacionPendientes.push({ droga, marca, clave, estado });
  });

  renderizarPreviaImportacion(nombreArchivo);
}

function renderizarPreviaImportacion(nombreArchivo) {
  const contenedor = document.getElementById("previa-importacion");
  const cuerpoTabla = document.getElementById("cuerpo-tabla-previa");
  const nuevos = filasImportacionPendientes.filter(f => f.estado === "nuevo").length;

  document.getElementById("nombre-archivo-importacion").textContent = nombreArchivo;

  cuerpoTabla.innerHTML = filasImportacionPendientes.map(fila => `
    <tr>
      <td>${escaparHtml(fila.droga)}</td>
      <td>${escaparHtml(fila.marca || "—")}</td>
      <td>${fila.estado === "nuevo"
        ? `<span class="badge badge-nuevo">nuevo</span>`
        : `<span class="badge">ya existe, se omite</span>`}</td>
    </tr>
  `).join("");

  document.getElementById("boton-confirmar-importacion").textContent = `Confirmar importación (${nuevos} nuevos)`;
  document.getElementById("boton-confirmar-importacion").disabled = nuevos === 0;
  contenedor.style.display = "block";
}

async function onConfirmarImportacion() {
  const nuevos = filasImportacionPendientes.filter(f => f.estado === "nuevo");
  if (nuevos.length === 0) return;

  try {
    const batch = db.batch();
    nuevos.forEach(fila => {
      const ref = db.collection("medicamentos").doc();
      batch.set(ref, {
        droga: fila.droga,
        marca: fila.marca,
        activo: true,
        claveNormalizada: fila.clave,
        creadoEn: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
    await batch.commit();

    mostrarMensaje(`Se importaron ${nuevos.length} medicamentos.`, "exito");
    filasImportacionPendientes = [];
    document.getElementById("previa-importacion").style.display = "none";
    document.getElementById("input-excel").value = "";
    cargarMedicamentos();
  } catch (error) {
    console.error("Error al importar medicamentos:", error);
    mostrarMensaje("No se pudo completar la importación.", "error");
  }
}
