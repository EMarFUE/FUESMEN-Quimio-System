// Plan de consolidación del catálogo de protocolos (Etapa 3, punto 7).
// Uso único: decisiones ya confirmadas por Elías sobre el archivo de revisión
// (Revision_protocolos_FUESMEN.xlsx). Lógica pura, sin Firebase, para poder
// probarse con Node antes de ejecutarse contra la base real.
// El caso ACTINOMICINA/DACTINOMICINA fusiona hacia "DACTINOMICINA" (nombre
// DCI/INN internacional correcto; Elías pidió elegir "según corresponda").

// Misma normalización que turnero-protocolos.js, para consistencia con claveNormalizada.
function normalizarTexto(texto) {
  return (texto || "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

const PLAN_CONSOLIDACION = [
  // --- Fusiones (2 docs -> 1 activo, el otro pasa a activo:false) ---
  { tipo: "fusion", caso: "A - Paclitaxel/Carboplatino (formato)",
    buscar_mantener: "PACLITAXEL - CARBOPLATINO", nombre_final: "PACLITAXEL - CARBOPLATINO",
    buscar_eliminar: "PACLITAXEL-CARBOPLATINO" },

  { tipo: "fusion", caso: "B - Pembrolizumab/Bevacizumab (formato)",
    buscar_mantener: "PEMBROLIZUMAB-BEVACIZUMAB", nombre_final: "PEMBROLIZUMAB-BEVACIZUMAB",
    buscar_eliminar: "PEMBROLIZUMAB - BEVACIZUMAB" },

  { tipo: "fusion", caso: "C - Pemetrexed/Pembrolizumab (formato + renombre pedido)",
    buscar_mantener: "PEMETREXED-PEMBROLIZUMAB", nombre_final: "PEMETREXED - PEMBROLIZUMAB",
    buscar_eliminar: "PEMETREXED - PEMBROLIZUMAB" },

  { tipo: "fusion", caso: "D - Atezolizumab SC (typo)",
    buscar_mantener: "ATEZOLIZUMAB SC", nombre_final: "ATEZOLIZUMAB SC",
    buscar_eliminar: "ATEZOLIZUZUMAB SC" },

  { tipo: "fusion", caso: "E - Etoposido/Carboplatino/Atezolizumab (typo + orden)",
    buscar_mantener: "ETOPOSIDO - CARBOPLATINO - ATEZOLIZUMAB", nombre_final: "ETOPOSIDO - CARBOPLATINO - ATEZOLIZUMAB",
    buscar_eliminar: "CARBOPLATINO - ESTOPOSIDO - ATEZOLIZUMAB" },

  { tipo: "fusion", caso: "F - Folfiri + Cetuximab (separador)",
    buscar_mantener: "FOLFIRI - CETUXIMAB", nombre_final: "FOLFIRI - CETUXIMAB",
    buscar_eliminar: "FOLFIRI + CETUXIMAB" },

  { tipo: "fusion", caso: "G - Vinflunina (typo)",
    buscar_mantener: "VINFLUNINA", nombre_final: "VINFLUNINA",
    buscar_eliminar: "VINFLUVINA" },

  // Caso H: NO es fusión — Elías pidió mantener las dos entradas activas, cada una
  // renombrada para mostrar ambos nombres (no hay forma unívoca de saber cuál usa
  // cada médico al cargar un turno).
  { tipo: "renombrar", caso: "H1 - Actinomicina (mantiene entrada, nombre combinado)",
    buscar: "ACTINOMICINA", nombre_final: "ACTINOMICINA O DACTINOMICINA" },

  { tipo: "renombrar", caso: "H2 - Dactinomicina (mantiene entrada, nombre combinado)",
    buscar: "DACTINOMICINA", nombre_final: "DACTINOMICINA O ACTINOMICINA" },

  // --- Solo renombrar (1 doc, sin duplicado) ---
  { tipo: "renombrar", caso: "I - typo Metotrexato",
    buscar: "DOXORRUBICINA - METROTEXATO", nombre_final: "DOXORRUBICINA - METOTREXATO" },

  { tipo: "renombrar", caso: "J - typo Trabectedina",
    buscar: "DOXORRUBICINA-TRABECTIDINA", nombre_final: "DOXORRUBICINA-TRABECTEDINA" },

  { tipo: "renombrar", caso: "K - typo Panitumumab",
    buscar: "IFL PANITUNUMAB", nombre_final: "IFL PANITUMUMAB" },

  { tipo: "renombrar", caso: "L - typo Obinutuzumab",
    buscar: "OBITUZUMAB - BENDAMUSTINE", nombre_final: "OBINUTUZUMAB - BENDAMUSTINE" },

  { tipo: "renombrar", caso: "M - falta B + espacios pedidos",
    buscar: "PACLITAXEL-CARBOPLATINO-BEVACIZUMAB-ATEZOLIZUMA",
    nombre_final: "PACLITAXEL - CARBOPLATINO - BEVACIZUMAB - ATEZOLIZUMAB" },

  { tipo: "renombrar", caso: "N - typo Ciclofosfamida + espacios pedidos",
    buscar: "RITUXIMAB-CICLOFOFAMIDA-VINCRISTINA",
    nombre_final: "RITUXIMAB - CICLOFOSFAMIDA - VINCRISTINA" },

  // --- Baja lógica (datos de prueba) ---
  { tipo: "baja", caso: "O - dato de prueba", buscar: "prueba1000" },
  { tipo: "baja", caso: "P - dato de prueba", buscar: "Prueba1001" },
];

// catalogoDocs: [{id, nombre, duracionMinutos, activo, claveNormalizada}, ...]
// Devuelve {resueltas, errores} sin escribir nada — solo arma el plan contra el catálogo real.
function construirPlan(catalogoDocs, planOperaciones) {
  planOperaciones = planOperaciones || PLAN_CONSOLIDACION;
  const porNombreExacto = new Map();
  const porNombreNormalizado = new Map();
  catalogoDocs.forEach(d => {
    const clave = (d.nombre || "").toString().trim();
    if (!porNombreExacto.has(clave)) porNombreExacto.set(clave, []);
    porNombreExacto.get(clave).push(d);

    const claveNorm = normalizarTexto(d.nombre);
    if (!porNombreNormalizado.has(claveNorm)) porNombreNormalizado.set(claveNorm, []);
    porNombreNormalizado.get(claveNorm).push(d);
  });

  // Busca primero por texto exacto (tal como está escrito en el plan). Si no hay
  // exactamente 1 activo, intenta por texto normalizado (sin tildes/mayúsculas/espacios
  // dobles) como red de seguridad ante diferencias menores de tipeo entre el Excel
  // revisado y lo que realmente hay en Firestore. Ese segundo caso queda marcado
  // como "aproximado" para revisar visualmente antes de ejecutar.
  function buscarActivosPorNombre(nombreBuscado) {
    const exactos = (porNombreExacto.get((nombreBuscado || "").trim()) || [])
      .filter(d => d.activo !== false);
    if (exactos.length === 1) {
      return { docs: exactos, aproximado: false };
    }
    if (exactos.length === 0) {
      const aproximados = (porNombreNormalizado.get(normalizarTexto(nombreBuscado)) || [])
        .filter(d => d.activo !== false);
      if (aproximados.length >= 1) {
        return { docs: aproximados, aproximado: true };
      }
    }
    return { docs: exactos, aproximado: false };
  }

  const resueltas = [];
  const errores = [];

  planOperaciones.forEach(op => {
    if (op.tipo === "fusion") {
      const mantener = buscarActivosPorNombre(op.buscar_mantener);
      const eliminar = buscarActivosPorNombre(op.buscar_eliminar);
      if (mantener.docs.length !== 1) {
        errores.push({ caso: op.caso, motivo: `No se encontró 1 doc activo llamado "${op.buscar_mantener}" (encontrados: ${mantener.docs.length}).` });
        return;
      }
      if (eliminar.docs.length !== 1) {
        errores.push({ caso: op.caso, motivo: `No se encontró 1 doc activo llamado "${op.buscar_eliminar}" (encontrados: ${eliminar.docs.length}).` });
        return;
      }
      const docMantener = mantener.docs[0];
      const docEliminar = eliminar.docs[0];
      if (docMantener.id === docEliminar.id) {
        errores.push({ caso: op.caso, motivo: `El doc a mantener y el doc a eliminar son el mismo documento (id ${docMantener.id}).` });
        return;
      }
      resueltas.push({
        tipo: "fusion",
        caso: op.caso,
        docMantenerId: docMantener.id,
        docMantenerNombreActual: docMantener.nombre,
        docMantenerNombreFinal: op.nombre_final,
        docMantenerDuracion: docMantener.duracionMinutos,
        renombrar: docMantener.nombre.toString().trim() !== op.nombre_final,
        docEliminarId: docEliminar.id,
        docEliminarNombre: docEliminar.nombre,
        docEliminarDuracion: docEliminar.duracionMinutos,
        aproximado: mantener.aproximado || eliminar.aproximado,
      });
    } else if (op.tipo === "renombrar") {
      const encontrados = buscarActivosPorNombre(op.buscar);
      if (encontrados.docs.length !== 1) {
        errores.push({ caso: op.caso, motivo: `No se encontró 1 doc activo llamado "${op.buscar}" (encontrados: ${encontrados.docs.length}).` });
        return;
      }
      const doc = encontrados.docs[0];
      resueltas.push({
        tipo: "renombrar",
        caso: op.caso,
        docId: doc.id,
        nombreActual: doc.nombre,
        nombreFinal: op.nombre_final,
        duracion: doc.duracionMinutos,
        aproximado: encontrados.aproximado,
      });
    } else if (op.tipo === "baja") {
      const encontrados = buscarActivosPorNombre(op.buscar);
      if (encontrados.docs.length !== 1) {
        errores.push({ caso: op.caso, motivo: `No se encontró 1 doc activo llamado "${op.buscar}" (encontrados: ${encontrados.docs.length}).` });
        return;
      }
      const doc = encontrados.docs[0];
      resueltas.push({
        tipo: "baja",
        caso: op.caso,
        docId: doc.id,
        nombreActual: doc.nombre,
        duracion: doc.duracionMinutos,
        aproximado: encontrados.aproximado,
      });
    }
  });

  return { resueltas, errores };
}

if (typeof module !== "undefined") {
  module.exports = { normalizarTexto, PLAN_CONSOLIDACION, construirPlan };
}
