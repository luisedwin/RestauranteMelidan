# Restaurante Melidan — versión móvil

Esta versión conserva la aplicación web **mobile-first** y añade soporte PWA para instalarla en un teléfono desde un navegador compatible.

## Arquitectura

- Frontend: HTML + CSS + JavaScript, optimizado para teléfono.
- Backend: Node.js + Express.
- Base de datos: PostgreSQL.
- Los datos operativos no se almacenan en LocalStorage; PostgreSQL es la fuente de verdad.

## Ejecución

1. Copiar `.env.example` a `.env` y colocar las credenciales de PostgreSQL.
2. Ejecutar `npm install`.
3. Ejecutar `npm start`.
4. Abrir la dirección del servidor desde el teléfono si el teléfono y el PC/servidor están en la misma red, usando la IP del equipo que ejecuta Node.js.

## Instalación como app

Desde Chrome/Edge en Android, abrir la dirección del servidor y usar **Instalar aplicación / Agregar a pantalla de inicio**. El manifest y el service worker están preparados para el modo standalone.

> La PWA no hace que PostgreSQL funcione sin conexión. Las operaciones de usuarios, pedidos, cocina, caja y dashboard necesitan comunicación con el backend.
