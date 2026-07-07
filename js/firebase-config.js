// Configuración del proyecto Firebase (fuesmen---quimio-system)
// Se usa el SDK "compat" para no requerir herramientas de build (npm, webpack, etc.)

const firebaseConfig = {
  apiKey: "AIzaSyCIK_2HuX0BF6o0-xOlhdeX4kQUv0Fudmc",
  authDomain: "fuesmen---quimio-system.firebaseapp.com",
  projectId: "fuesmen---quimio-system",
  storageBucket: "fuesmen---quimio-system.firebasestorage.app",
  messagingSenderId: "76631851393",
  appId: "1:76631851393:web:cc4127a7d31a3bc9d06880"
};

firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// Etiquetas legibles para cada rol, usadas en toda la interfaz
const ROLES = {
  administrador: "Administrador",
  enfermeria: "Enfermería",
  medico: "Médico",
  administrativo: "Administrativo"
};
