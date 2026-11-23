# Cambios realizados — Avance 3 Final

## Migración de backend

Se reemplazó el backend PHP por Node.js + Express. Se implementó la API directamente en `server.js` utilizando `pg`, `bcryptjs` y `dotenv`.

### Módulos migrados

- Autenticación y recuperación de contraseña.
- CRUD de usuarios/personal y soft delete.
- Productos y categorías.
- Mesas y aforo.
- Pedidos y detalle de pedidos.
- Estados de Cocina/KDS.
- Dashboard con métricas de PostgreSQL.
- Ventas y comprobantes.

## Persistencia

Se eliminó el uso de LocalStorage como fuente de datos operativos. Cocina consulta y actualiza pedidos en PostgreSQL; Mozo crea pedidos en PostgreSQL; Caja registra ventas/comprobantes en PostgreSQL. LocalStorage queda limitado a sesión y preferencias de interfaz.

## Seguridad

- Se eliminó el `.env` con credenciales del paquete final.
- Se creó `.env.example`.
- Se eliminó la conexión directa mediante `psql.exe` con contraseña escrita en `server.js`.
- Se utilizan consultas parametrizadas.
- Las contraseñas nuevas se almacenan con bcrypt.
- Se mantienen las restricciones y relaciones de PostgreSQL.

## Validaciones

Se incorporaron validaciones de backend para nombres, correo, documentos, teléfono, rol, contraseña, cantidades y estados. Se contempla específicamente el DNI `00000000` como inválido.

## Limitaciones de verificación

No se pudo ejecutar una prueba de integración real contra PostgreSQL durante esta preparación porque el entorno no dispone de la instancia `melidan_db` del usuario. Por ello no se afirma que las operaciones de BD hayan sido ejecutadas exitosamente aquí.

También se intentó instalar las dependencias de npm, pero la instalación excedió el tiempo disponible en el entorno. El proyecto incluye `package.json` para ejecutar `npm install` en el equipo de desarrollo.
