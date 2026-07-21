// Lógica compartida de autenticación y roles.
// Cada página protegida llama a requireAuth(callback) al cargar.
//
// Patrón de visibilidad unificado (Etapa 7):
// - El <body> de cada página protegida arranca con style="visibility:hidden"
// - requireAuth inyecta un spinner mientras espera la respuesta de Firestore
// - Al confirmar el rol, revela el body de una sola vez (visibility:visible)
// - Así ningún contenido protegido se muestra antes de resolver los permisos

function _inyectarSpinner() {
  const spinner = document.createElement("div");
  spinner.id = "auth-spinner";
  spinner.style.cssText = [
    "position:fixed", "inset:0", "display:flex", "align-items:center",
    "justify-content:center", "background:#f5f7fa", "z-index:9999"
  ].join(";");
  spinner.innerHTML = `
    <style>@keyframes auth-spin{to{transform:rotate(360deg)}}</style>
    <div style="text-align:center;color:#888;font-size:14px;">
      <div style="width:28px;height:28px;border:3px solid #ddd;border-top-color:#5eb3e6;
        border-radius:50%;animation:auth-spin 0.7s linear infinite;margin:0 auto 12px;"></div>
      Verificando acceso…
    </div>
  `;
  document.body.appendChild(spinner);
}

function _revelarPagina() {
  document.body.style.visibility = "visible";
  const spinner = document.getElementById("auth-spinner");
  if (spinner) spinner.remove();
}

/**
 * Verifica que haya una sesión activa y que el usuario tenga un rol
 * asignado en Firestore (colección "usuarios", documento = uid).
 * Si todo está OK, ejecuta callback(user, datosUsuario) y revela la página.
 * Si no hay sesión, redirige a login.html.
 * Si hay sesión pero no tiene rol asignado, muestra un aviso y no continúa.
 *
 * loginPath: ruta relativa a login.html desde la página que llama
 */
function requireAuth(callback, loginPath = "login.html") {
  _inyectarSpinner();

  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = loginPath;
      return;
    }

    try {
      const doc = await db.collection("usuarios").doc(user.uid).get();

      if (!doc.exists) {
        mostrarErrorSinRol();
        _revelarPagina();
        return;
      }

      const datosUsuario = doc.data();

      if (datosUsuario.activo === false) {
        mostrarErrorSinRol("Este usuario fue dado de baja. Contactá al administrador.");
        _revelarPagina();
        return;
      }

      // Ejecutar el callback (sync o async) y luego revelar la página
      try {
        const resultado = callback(user, datosUsuario);
        if (resultado && typeof resultado.then === "function") {
          await resultado;
        }
      } catch (errorCallback) {
        console.error("Error en el callback de requireAuth:", errorCallback);
      }

      _revelarPagina();

    } catch (error) {
      console.error("Error al obtener el rol del usuario:", error);
      mostrarErrorSinRol("No se pudo verificar el rol del usuario. Reintentá en unos segundos.");
      _revelarPagina();
    }
  });
}

function mostrarErrorSinRol(mensaje = "Tu usuario todavía no tiene un rol asignado. Contactá al administrador.") {
  document.body.innerHTML = `
    <div class="pantalla-error">
      <p>${mensaje}</p>
      <button onclick="cerrarSesion()">Cerrar sesión</button>
    </div>
  `;
}

function cerrarSesion(loginPath = "login.html") {
  auth.signOut().then(() => {
    window.location.href = loginPath;
  });
}

// Traduce los códigos de error de Firebase Auth a mensajes en español
function traducirErrorAuth(codigo) {
  const mensajes = {
    "auth/invalid-email": "El formato del email no es válido.",
    "auth/user-not-found": "No existe un usuario con ese email.",
    "auth/wrong-password": "La contraseña es incorrecta.",
    "auth/invalid-credential": "Email o contraseña incorrectos.",
    "auth/too-many-requests": "Demasiados intentos fallidos. Esperá unos minutos y volvé a intentar.",
    "auth/user-disabled": "Este usuario fue deshabilitado.",
    "auth/network-request-failed": "Error de conexión. Revisá tu internet."
  };
  return mensajes[codigo] || "Ocurrió un error al iniciar sesión. Intentá de nuevo.";
}
