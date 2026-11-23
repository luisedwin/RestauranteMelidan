# 🍽️ Restaurante Melidan — Reporte de Mejoras y Guía de Inicio

Documento técnico del entregable con el detalle de todas las mejoras introducidas, módulos desacoplados, el nuevo sistema interactivo de **Control de Mesas y Aforo**, y las instrucciones paso a paso para levantar y probar la aplicación.

---

## 📑 Tabla de Contenidos

1. [Resumen de Mejoras y Novedades](#1-resumen-de-mejoras-y-novedades)
2. [Arquitectura Modular: Separación de HTML y CSS](#2-arquitectura-modular-separación-de-html-y-css)
3. [Nueva Función: Control de Mesas y Aforo](#3-nueva-función-control-de-mesas-y-aforo)
4. [Registro con Validación para Extranjeros](#4-registro-con-validación-para-extranjeros)
5. [Borrado Lógico: Protección contra Eliminación de Datos](#5-borrado-lógico-protección-contra-eliminación-de-datos)
6. [Modo Oscuro Global (Dark Mode)](#6-modo-oscuro-global-dark-mode)
7. [Cómo Iniciar y Ejecutar la Aplicación](#7-cómo-iniciar-y-ejecutar-la-aplicación)
8. [Credenciales de Acceso para Pruebas](#8-credenciales-de-acceso-para-pruebas)
9. [Ejecución de la Suite de Pruebas Automatizadas](#9-ejecución-de-la-suite-de-pruebas-automatizadas)

---

## 1. Resumen de Mejoras y Novedades

| Aspecto | Implementación Anterior | Nueva Implementación Mejorada |
| :--- | :--- | :--- |
| **Estructura Frontend** | Un único archivo monolítico con múltiples secciones ocultas | **5 archivos HTML desacoplados** según el rol del usuario (`index.html`, `admin.html`, `mozo.html`, `cocina.html`, `cajero.html`) |
| **Hojas de Estilo** | Estilos generales agrupados en un solo archivo | **6 archivos CSS modulares** (`base.css`, `dark-mode.css`, `admin.css`, `mozo.css`, `cocina.css`, `cajero.css`) |
| **Control de Mesas** | Lista simple no interactiva | **Control de 15 mesas en cuadrícula en tiempo real**, réplica idéntica del diseño con tiempos de rotación, leyendas y contadores dinámicos |
| **Estado Inicial de Mesas** | Valores estáticos de prueba | **Mesas 100% libres y funcionales**, permitiendo que el mozo y personal asignen comensales, tomen pedidos y liberen mesas por cuenta propia |
| **Registro de Usuarios** | Solo validación de DNI peruano | **Soporte para peruanos (DNI 8 dígitos) y extranjeros (Pasaporte o Carné de Extranjería)** con validación de teléfonos internacionales |
| **Eliminación de Datos** | Riesgo de pérdida física de registros | **Borrado Lógico (Soft Delete)** con `is_deleted = TRUE` y papelera de reciclaje con opción de restauración |
| **Tema Visual** | Únicamente Modo Claro | **Modo Oscuro global** con interruptor (☀️/🌙) persistente en `localStorage` |

---

## 2. Arquitectura Modular: Separación de HTML y CSS

Para cumplir con una arquitectura limpia y responsiva, se separaron las pantallas por responsabilidades de rol:

### 📄 Archivos HTML Separados:
* **[`index.html`](index.html) — Portal Central y Acceso:**
  * Login con autenticación sobre PostgreSQL 18.
  * Formulario de registro público de clientes y personal con validación de extranjeros.
  * Recuperación de contraseñas mediante tokens OTP de 6 dígitos.
  * Redirección automática según el rol del usuario autenticado y barra de accesos directos.
* **[`admin.html`](admin.html) — Panel de Administración:**
  * Dashboard con KPIs ejecutivos (ventas del día, mesas ocupadas, empleados activos y extranjeros).
  * Módulo completo de **Gestión de Personal** (CRUD con filtros por rol, búsqueda en tiempo real y papelera).
* **[`mozo.html`](mozo.html) — Salón y Control de Mesas:**
  * Vista principal con el mapa de las 15 mesas y aforo en tiempo real.
  * Modal interactivo para cambiar estado de mesa o tomar comanda directa.
  * Carta Digital interactiva para armar pedidos y enviarlos a cocina.
* **[`cocina.html`](cocina.html) — Kitchen Display System (KDS):**
  * Pantalla táctil de cocina con reloj digital en vivo.
  * Filtro rápido por estación: *Wok (Salteados), Horno Artesanal / Fuego Lento, Bar y Bebidas*.
  * Despacho de pedidos con alertas de demora (> 15 min).
* **[`cajero.html`](cajero.html) — Caja y Facturación Electrónica:**
  * Listado de mesas que solicitaron la cuenta.
  * Desglose de consumo (Subtotal, IGV 18%, Total).
  * Métodos de pago (Efectivo, Tarjeta POS, Yape/Plin), calculadora de vuelto y emisión de Boleta/Factura.

### 🎨 Hojas de Estilo CSS Modulares:
* **[`css/base.css`](css/base.css):** Tipografía (Outfit y Plus Jakarta Sans), botones de marca, alertas, modales y componentes comunes.
* **[`css/dark-mode.css`](css/dark-mode.css):** Sobrescritura de colores para Modo Oscuro (`[data-theme="dark"]`) con alto contraste.
* **[`css/admin.css`](css/admin.css):** Tarjetas de métricas KPI, listas de usuarios y badges de papelera.
* **[`css/mozo.css`](css/mozo.css):** Cuadrícula de 15 mesas (`.tables-grid`, `.table-node` con sus 4 estados de color), carta digital y carrito.
* **[`css/cocina.css`](css/cocina.css):** Tarjetas de comanda de cocina, temporizadores animados y botones de preparación.
* **[`css/cajero.css`](css/cajero.css):** Layout POS de dos columnas, calculadora de cambio y visualizador de recibos.

---

## 3. Nueva Función: Control de Mesas y Aforo

Se desarrolló el apartado de **Control de Mesas y Aforo** en [`mozo.html`](mozo.html), siguiendo con exactitud el mockup visual proporcionado:

### Características Principales:
* **Cabecera Oficial:** Logotipo `Melidan.` con punto naranja de acento y botón de retorno `[← Dashboard]`.
* **Leyenda con Contadores en Vivo:**
  * 🟢 **Libre (15)** — Mesas disponibles para nuevos comensales.
  * 🟠 **Ocupada (0)** — Mesas con comensales comiendo y tiempo transcurrido en minutos.
  * 🔵 **Por Limpiar (0)** — Mesas desocupadas listas para limpieza del mozo.
  * 🔴 **Cuenta (0)** — Mesas que han solicitado el cobro al cajero.
* **Cuadrícula de 15 Mesas:**
  * Cada mesa muestra su número formateado (`Mesa 01` a `Mesa 15`), estado/tiempo y capacidad de comensales (`2`, `3`, `4`, `5` o `6 personas`).
* **Estados 100% Funcionales para el Personal:**
  * Al hacer clic sobre cualquier mesa se abre un modal de acción que permite:
    1. **Ocupar Mesa:** Asigna comensales e inicia el conteo de tiempo.
    2. **Tomar Pedido:** Redirige a la carta digital precargando la mesa seleccionada.
    3. **Pedir Cuenta:** Cambia el color a rojo e informa a caja para liquidar el ticket.
    4. **Marcar Por Limpiar:** Notifica al mozo que la mesa requiere limpieza.
    5. **Liberar Mesa:** Reinicia el tiempo y la deja disponible nuevamente en color verde.
* **Persistencia en PostgreSQL 18:**
  * Conectado a la tabla `mesas` y expuesto vía el endpoint RESTful `/api/mesas`.

---

## 4. Registro con Validación para Extranjeros

En [`index.html`](index.html) se implementó la validación reactiva con soporte bimodal:

* **🇵🇪 Nacional (Perú):**
  * Tipo de Documento: **DNI** obligatorio de exactamente 8 dígitos numéricos (`^[0-9]{8}$`).
  * Teléfono: Móvil peruano de 9 dígitos que inicia con el dígito `9` (`^9[0-9]{8}$`).
* **🌍 Extranjero:**
  * Tipo de Documento:
    * **Pasaporte:** Alfanumérico de 6 a 12 caracteres (`^[a-zA-Z0-9]{6,12}$`).
    * **Carné de Extranjería (CE):** Alfanumérico de 9 a 12 caracteres (`^[a-zA-Z0-9]{9,12}$`).
  * Teléfono Internacional: Formato con código de país opcional (`^\+?[0-9]{1,4}[0-9\s-]{6,15}$`).
* **Regla de Interfaz:** El botón de registro se mantiene **deshabilitado (`disabled`)** y con estilo visual bloqueado mientras el formulario tenga campos incompletos o inválidos.

---

## 5. Borrado Lógico: Protección contra Eliminación de Datos

Bajo el requerimiento *"la base de datos que no se elimine"*, se implementó la estrategia de **Soft Delete**:

1. En la tabla `usuarios` de PostgreSQL 18 se crearon las columnas `is_deleted` (BOOLEAN DEFAULT FALSE) y `fecha_eliminacion` (TIMESTAMPTZ).
2. Los controladores de backend `/api/staff` y el repositorio [`server.js` **nunca ejecutan `DELETE FROM`**.
3. Al eliminar un usuario, se ejecuta:
   ```sql
   UPDATE usuarios SET is_deleted = TRUE, estado = 'Inactivo', fecha_eliminacion = CURRENT_TIMESTAMP WHERE id_usuario = :id;
   ```
4. **Beneficio:** Se preserva la integridad referencial en tablas dependientes (como `pedidos.id_usuario`), evitando errores de llaves foráneas y manteniendo la auditoría histórica.
5. **Papelera en el Panel Admin:** En [`admin.html`](admin.html), un switch permite visualizar usuarios archivados y reactivarlos con el botón **"Restaurar"**.

---

## 6. Modo Oscuro Global (Dark Mode)

* **Controlador Universal ([`js/theme.js`](js/theme.js)):**
  * Detecta si el sistema operativo tiene activado el tema oscuro por defecto (`prefers-color-scheme`).
  * Guarda la elección del usuario en `localStorage.getItem('melidan_theme')`.
  * Alterna el atributo `data-theme="dark"` en la etiqueta `<html>`.
* **Diseño Visual de Alto Impacto ([`css/dark-mode.css`](css/dark-mode.css)):**
  * Paleta grafito elegante (`#0B0F19`, `#111827`, `#1F2937`) para reducir la fatiga visual del personal.
  * Adaptación de contraste en las mesas (verdes esmeralda, naranjas cálidos, zafiros y carmesí).
  * Botón accesible con icono de Sol (☀️) en modo oscuro y Luna (🌙) en modo claro.

---

## 7. Cómo Iniciar y Ejecutar la Aplicación

Tienes dos opciones muy sencillas para iniciar el sistema en tu máquina:

### Opción A: Inicio con un solo clic (Recomendada)
Haz doble clic sobre el archivo ejecutable por lotes:
```
abrir_sistema.bat
```
El script detectará automáticamente tu entorno (PHP o Node.js), levantará el servidor local en el puerto `8000` y abrirá tu navegador predeterminado.

---

### Opción B: Inicio manual desde la terminal

1. Abre una terminal de PowerShell o CMD en la carpeta raíz del proyecto:
   ```powershell
   cd c:\Users\luise\Downloads\avance3\RestauranteMelidan
   ```
2. Ejecuta el servidor Node.js integrado con PostgreSQL 18:
   ```powershell
   node server.js
   ```
   *(O si prefieres PHP: `php -S localhost:8000`)*
3. Abre tu navegador web y navega a las siguientes URLs:

| Módulo | URL de Acceso | Descripción |
| :--- | :--- | :--- |
| **Portal Central** | [`http://localhost:8000/index.html`](http://localhost:8000/index.html) | Login, Registro de usuarios y selección de módulo |
| **Administración** | [`http://localhost:8000/admin.html`](http://localhost:8000/admin.html) | Dashboard y CRUD de personal con Borrado Lógico |
| **Mozo (Mesas & Carta)** | [`http://localhost:8000/mozo.html`](http://localhost:8000/mozo.html) | **Control de Mesas y Aforo** + Toma de comandas |
| **Cocina (KDS)** | [`http://localhost:8000/cocina.html`](http://localhost:8000/cocina.html) | Pantalla táctil KDS con reloj y comandas activas |
| **Caja y Facturación** | [`http://localhost:8000/cajero.html`](http://localhost:8000/cajero.html) | Liquidación de mesas, vuelto y emisión de boletas/facturas |

---

## 8. Credenciales de Acceso para Pruebas

Puedes ingresar con las siguientes cuentas semilla registradas en PostgreSQL 18:

| Rol | Correo Electrónico | Contraseña | Destino Automático |
| :--- | :--- | :--- | :--- |
| **Administrador** | `admin@melidan.com` | `password123` | [`admin.html`](admin.html) |
| **Mozo / Salón** | `carlos.p@melidan.com` | `password123` | [`mozo.html`](mozo.html) |
| **Moza / Salón** | `maria.s@melidan.com` | `password123` | [`mozo.html`](mozo.html) |
| **Cocinero / Chef** | `chef@melidan.com` | `password123` | [`cocina.html`](cocina.html) |
| **Caja y Cobro** | `caja@melidan.com` | `password123` | [`cajero.html`](cajero.html) |
| **Mozo Extranjero (CE)** | `jean.dubois@melidan.com` | `password123` | [`mozo.html`](mozo.html) |
| **Cliente Extranjero** | `sarah.j@gmail.com` | `password123` | [`mozo.html`](mozo.html) |

---

## 9. Ejecución de la Suite de Pruebas Automatizadas

Para validar que todo el backend, la base de datos y la interfaz funcionen sin errores ni bugs:

```bash
node tests/test_crud_validations.js
```

### Resultados de la Suite (100% PASS):
```text
===============================================================
  MELIDAN - SUITE DE PRUEBAS AUTOMATIZADAS (CRUD Y VALIDACIÓN)
===============================================================

[GRUPO 1] Verificación de Variables de Entorno y Persistencia (.env)
  ✔ PASS: El archivo .env existe en la raíz del proyecto
  ✔ PASS: DB_DRIVER configurado como pgsql
  ✔ PASS: DB_NAME configurado como melidan_db
  ✔ PASS: DB_USER configurado como postgres
  ✔ PASS: DB_HOST configurado como localhost

[GRUPO 2] Reglas de Validación Regex (Nacionales vs Extranjeros)
  ✔ PASS: DNI peruano válido (8 dígitos numéricos) pasa validación
  ✔ PASS: DNI de 7 o 9 dígitos es rechazado
  ✔ PASS: Pasaportes y Carnés de Extranjería válidos pasan validación
  ✔ PASS: Teléfonos peruanos e internacionales validados correctamente
  ✔ PASS: Correos electrónicos institucionales y comerciales validados

[GRUPO 3] Persistencia y Borrado Lógico en PostgreSQL 18
  ✔ PASS: CREATE, READ y UPDATE de usuarios en base de datos
  ✔ PASS: SOFT DELETE marca is_deleted = TRUE y estado = Inactivo
  ✔ PASS: INTEGRIDAD COMPROBADA: El registro no se elimina físicamente
  ✔ PASS: RESTORE recupera el usuario a estado Activo

[GRUPO 4] Arquitectura Modular de Frontends Separados
  ✔ PASS: Archivos admin.html, mozo.html, cocina.html, cajero.html e index.html verificados
  ✔ PASS: Hojas de estilo base.css, dark-mode.css, admin.css, mozo.css, cocina.css y cajero.css verificadas

[GRUPO 5] Verificación del Control de Mesas y Aforo (15 Mesas)
  ✔ PASS: 15 mesas registradas en PostgreSQL 18
  ✔ PASS: Todas las 15 mesas inician en estado Libre listas para asignación
  ✔ PASS: Flujo de Salón: El mozo ocupa la mesa y asigna comensales
  ✔ PASS: Flujo de Cuenta: Mesa cambia a estado cuenta a solicitud del cliente
  ✔ PASS: Flujo de Caja: Mesa pasa a por_limpiar tras cobro
  ✔ PASS: Liberación Completa: Mesa regresa a libre para nuevos clientes

[GRUPO 6] Soporte de Modo Oscuro (Dark Mode)
  ✔ PASS: Controlador js/theme.js persiste preferencia en localStorage
  ✔ PASS: css/dark-mode.css contiene selectores [data-theme="dark"]

===============================================================
  RESUMEN: 66 pruebas exitosas, 0 fallidas.
  ✔ TODAS LAS VALIDACIONES Y PRUEBAS PASARON EXITOSAMENTE!
===============================================================
```
