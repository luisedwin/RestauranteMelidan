# Restaurante Melidan — Sistema Web Gastronómico (v3.4.0)

Aplicación web responsive (**PC, Tablet y Móvil + PWA**) construida con **HTML5 + CSS3 + JavaScript**, **Node.js + Express 5** y **PostgreSQL 18 (`melidan_db`)**.

## Usuarios y Credenciales por Rol

Todos los usuarios precargados en `melidan_db` ([database/init.sql](database/init.sql)) utilizan la contraseña **`password123`**.

### Acceso Rápido (1 cuenta principal por cada rol)

| Rol (`rol_usuario`) | Nombre | Correo (Login) | Contraseña | Pantalla Inicial | Módulos Permitidos |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **`administrador`** | Don Roberto | `admin@melidan.com` | `password123` | `/admin.html` | Todo el sistema (`Admin`, `Mesas`, `Carta`, `Cocina KDS`, `Caja`, Historial y Excel de Ventas) |
| **`mozo`** | Diego Vargas | `mozo@melidan.com` | `password123` | `/mozo.html` | Control de Mesas (`/mozo.html`) y Carta Digital (`/carta.html`) |
| **`cajero`** | Renato Quispe | `cajero@melidan.com` | `password123` | `/cajero.html` | Caja POS, Cobro Consolidado por Mesa y Boletas/Facturas PDF (`/cajero.html`) |
| **`cocina`** | Marco Antonio (Chef) | `chef@melidan.com` | `password123` | `/cocina.html` | Pantalla de Cocina KDS en tiempo real (`/cocina.html`) |
| **`recepcionista`** | Lucía Flores (Recepción) | `recepcion@melidan.com` | `password123` | `/mozo.html` | Control de Mesas/Aforo (`/mozo.html`) y Carta Digital (`/carta.html`) |
| **`cliente`** | Camila Torres | `cliente@melidan.com` | `password123` | `/carta.html` | Carta Digital, Carruseles, Especial del Día y Carrito (`/carta.html`) |

### Cuentas Adicionales Registradas en PostgreSQL

| Rol (`rol_usuario`) | Nombre | Correo (Login) | Contraseña | Estado / Notas |
| :--- | :--- | :--- | :--- | :--- |
| `mozo` | Carlos Paredes | `carlos.p@melidan.com` | `password123` | Activo (Turno Mañana) |
| `mozo` | Jean-Pierre Dubois | `jean.dubois@melidan.com` | `password123` | Activo (Extranjero · Carné de Extranjería) |
| `mozo` | Jorge Ruiz | `jorge.r@melidan.com` | `password123` | Inactivo (cuenta de prueba para estado Inactivo) |
| `cajero` | María Salazar | `maria.s@melidan.com` | `password123` | Activo (Turno Tarde) |
| `cocina` | Valeria Mendoza (Sous Chef) | `valeria.cocina@melidan.com` | `password123` | Activo (Turno Tarde) |
| `cliente` | Sarah Jenkins | `sarah.j@gmail.com` | `password123` | Activo (Extranjero · Pasaporte) |
| `cliente` | Alessandro Rossi | `alessandro.rossi@gmail.com` | `password123` | Activo (Extranjero · Pasaporte) |
| `cliente` | Mateo Gómez | `mateo.gomez@gmail.com` | `password123` | Activo (Extranjero · Carné de Extranjería) |

---

## Estructura del Proyecto

```text
RestauranteMelidan/
├── abrir_sistema.bat                # Arranque directo: configura entorno, conecta PostgreSQL y abre Chrome en /login
├── package.json                     # Configuración Node.js (v3.4.0) y scripts
├── .env.example                     # Plantilla de variables de entorno
├── CORRECCIONES_VERSION_3.3.0.txt   # Registro técnico de auditoría, correcciones y notas de versión (v3.3.0 - v3.4.0)
├── src/                             # Backend modular Node.js + Express 5
│   ├── server.js                    # Punto de entrada HTTP y rutas limpias (/login, /admin, /mozo, /carta, /cocina, /cajero)
│   ├── config/
│   │   └── db.js                    # Pool de conexión PostgreSQL 18
│   ├── routes/
│   │   └── api.js                   # Endpoints REST (/health, /auth, /staff, /menu, /daily-specials, /mesas, /orders, /dashboard, /billing, /purchases-history, /reports/sales-excel)
│   └── utils/
│       ├── authToken.js             # Tokens firmados HMAC-SHA256 y protección RBAC
│       ├── receiptPdf.js            # Generador nativo de Boleta/Factura electrónica PDF con cupón promocional
│       ├── salesExcel.js            # Generador nativo de reporte Excel (.xlsx) con 4 hojas, gráfico de barras y pastel
│       ├── syncCartaMarketing.js    # Migración idempotente de los 46 productos, precios .90, promos e imágenes verificadas
│       └── validators.js            # Validaciones DNI / Pasaporte / CE, teléfonos y roles
├── public/                          # Frontend estático y PWA
│   ├── index.html                   # Portal de Inicio de Sesión, Registro, Recuperación OTP y SPA
│   ├── data/
│   │   └── carta-imagenes.json      # Diccionario JSON oficial con las 46 URLs directas verificadas + respaldos
│   ├── pages/                       # Módulos operativos independientes
│   │   ├── admin.html               # Dashboard Ejecutivo, Excel de Ventas, Historial y CRUD de Personal (Soft Delete)
│   │   ├── mozo.html                # Control de 15 Mesas, Aforo y Toma de Comandas
│   │   ├── carta.html               # Carta Digital, Carrusel de Platos/Promos, Especial del Día (-25%) y Complementos (-20%)
│   │   ├── cocina.html              # Pantalla KDS en tiempo real (Nuevas/Cocinando/Listas + Filtros por estación)
│   │   └── cajero.html              # Punto de Venta (POS), Cuenta Consolidada por Mesa, Yape/Plin y PDF
│   ├── css/                         # Hojas de estilo modulares, animaciones y Modo Oscuro completo
│   ├── js/                          # Controladores cliente, RBAC, tema oscuro y diccionario JS de imágenes (dishImages.js)
│   ├── img/                         # Iconos PWA
│   ├── manifest.webmanifest         # Manifiesto Web App
│   └── sw.js                        # Service Worker v12 (Network-First same-origin con respaldo offline)
├── database/
│   └── init.sql                     # Esquema completo y semilla PostgreSQL 18 (melidan_db)
├── docs/                            # Documentación complementaria e historial
├── prototipo/                       # Recursos de diseño inicial
└── tests/
    └── test_crud_validations.js     # Suite de pruebas automatizadas unitarias y E2E (no destructiva)
```

## Inicio Rápido (Windows)

Ejecuta **`abrir_sistema.bat`** con doble clic:
1. Configura automáticamente la conexión a PostgreSQL (`postgres` / `root`, base `melidan_db`).
2. Verifica dependencias, sincroniza automáticamente el catálogo (46 productos e imágenes verificadas) y levanta Express en `http://localhost:8000`.
3. Abre **Google Chrome** directamente en **`http://localhost:8000/login`**.

> Si tenías una versión anterior abierta en el navegador, presiona **`Ctrl + F5`** una vez para actualizar el Service Worker (`melidan-shell-v12`).

### Comandos NPM

```bash
npm start   # Inicia el servidor en http://localhost:8000/login
npm test    # Ejecuta la suite de pruebas automatizadas
```
