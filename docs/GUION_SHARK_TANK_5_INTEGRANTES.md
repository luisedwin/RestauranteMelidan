# Guión Shark Tank de Software (UTP) — Grupo de 5 Integrantes
**Startup:** Melidan Tech S.A.C. · **Producto:** Melidan (Sistema Web Gastronómico Inteligente)

---

## 1. Cálculo Exacto del Tiempo (Rúbrica UTP)

Según la guía oficial **Shark Tank de Software (UTP)**:

| Parámetro | Tiempo | Observación |
| :--- | :---: | :--- |
| **Duración mínima permitida** | **3:00 min** | Límite inferior oficial del video/exposición |
| **Suma exacta de bloques sugeridos** | **4:45 min** | `1:00 + 0:45 + 1:00 + 0:30 + 1:00 + 0:30` |
| **Tiempo recomendado (5 personas + demo en vivo)** | **6:10 min** | Equilibrado (~1:05–1:40 por persona), incluye demo real |
| **Duración máxima permitida** | **8:00 min** | **NO pasar de 8:00** (el guión deja **1:50 min** de colchón) |

### Reparto Equitativo para los 5 Integrantes

| Integrante | Bloques de la Rúbrica UTP que cubre | Versión Rápida (sin demo larga) | Versión Recomendada (con demo en vivo) | Tope personal máximo |
| :--- | :--- | :---: | :---: | :---: |
| **Integrante 1** | **1. Presentación de la Startup** (Nombre, Producto, Eslogan) | 0:55 | **1:00** | 1:15 |
| **Integrante 2** | **2. Problema Identificado** (Qué, Quiénes, Por qué importa) | 0:45 | **0:55** | 1:10 |
| **Integrante 3** | **3. Solución Propuesta + Demo en Vivo** (Qué hace, Cómo funciona, Diferencial) | 1:05 | **1:45** | 2:10 |
| **Integrante 4** | **4. Usuarios / Stakeholders** + **5. Cómo se obtiene el ROI** | 1:15 | **1:25** | 1:45 |
| **Integrante 5** | **6. Solicitud de Inversión + Sustento ROI (6 meses y 1 año) + Cierre** | 0:45 | **1:05** | 1:25 |
| **TOTAL** | **Los 6 puntos obligatorios completos** | **4:45 min** | **6:10 min** | **7:45 min (< 8:00)** |

> [!TIP]
> **Consejo clave de tiempo:** Ensayen apuntando a **6:00 – 6:15 minutos**. Así, aunque en vivo hablen un poco más lento o la demo demore 20 segundos extra, siempre quedarán entre **6:30 y 7:15**, **jamás excediendo los 8:00 minutos máximos**.

---

## 2. Preparación de la Demo (Antes de Empezar)

1. Ejecuten `abrir_sistema.bat` y entren a `http://localhost:8000/login` con **`admin@melidan.com`** / **`password123`** (el rol Admin muestra la barra superior para cambiar en 1 clic entre **Panel Admin · Mesas · Carta · Cocina · Caja**).
2. Dejen abierta la pestaña en **`/carta.html`** antes de que empiece a hablar el Integrante 1.
3. Si van a grabar video (o exponer con proyector), el **Integrante 3** controla el mouse durante la demo para evitar cambios torpes de laptop.

---

## 3. Guión Completo para los 5 Integrantes (6:10 min)

*(Lo que está entre `[corchetes]` son acciones o gestos — no se leen en voz alta.)*

---

### INTEGRANTE 1 — Punto 1: Presentación de la Startup *(0:00 – 1:00 | 60 seg)*

> `[Todos de pie en semicírculo, postura firme y sonrisa. Integrante 1 da un paso ligero adelante.]`
>
> "Buenas tardes, inversionistas.
>
> Somos **Melidan Tech**, una startup peruana de tecnología gastronómica, y hoy les presentamos **Melidan**: el sistema web inteligente todo-en-uno para restaurantes.
>
> Nuestro eslogan lo resume todo: **'Tradición y sabor a fuego lento, gestión a velocidad digital'**.
>
> `[Pausa breve de 1 segundo, contacto visual con la docente y el aula.]`
>
> En el Perú la gastronomía es orgullo mundial, pero detrás de la cocina, miles de restaurantes siguen administrando sus mesas, pedidos y cobros como hace 20 años. Melidan nace para transformar cualquier celular, tablet o computadora en una herramienta profesional que acelera la atención, elimina errores y hace que los clientes regresen.
>
> Para entender por qué nuestra propuesta es urgente, le doy el pase a **[Nombre Integrante 2]**."

---

### INTEGRANTE 2 — Punto 2: Problema Identificado *(1:00 – 1:55 | 55 seg)*

> `[Integrante 2 toma la palabra con tono enérgico y cercano.]`
>
> "Gracias, **[Nombre Integrante 1]**.
>
> **¿Qué problema existe hoy?** En la gran mayoría de restaurantes medianos, pollerías y cevicherías del Perú, la operación diaria sigue dependiendo de comandas en papel, cartas estáticas que nunca cambian y cobros manuales lentos en caja.
>
> **¿Quiénes lo sufren?** Lo sufren **dos grupos al mismo tiempo**:
> - Primero, los **comensales**, que esperan hasta 15 minutos por una carta, reciben pedidos equivocados o hacen largas colas para pagar con Yape o pedir boleta.
> - Y segundo, los **dueños y el personal del restaurante**: mozos sobrecargados, cocineros que reciben letras ilegibles o pierden comandas, y gerentes que al final del día no saben exactamente cuánto vendieron ni qué platos se movieron más.
>
> **¿Por qué es importante resolverlo?** Porque en hora punta ese desorden hace perder hasta un **20% de rotación de mesas**, genera mermas por errores en cocina y provoca que el cliente pague una vez y no vuelva.
>
> Ahora **[Nombre Integrante 3]** les mostrará cómo Melidan resuelve todo esto en vivo."

---

### INTEGRANTE 3 — Punto 3: Solución Propuesta + Demo en Vivo *(1:55 – 3:40 | 1 min 45 seg)*

> `[Integrante 3 muestra /carta.html en pantalla.]`
>
> "Nuestra solución es **Melidan**, una aplicación web progresiva (**PWA**) 100% responsive —funciona en **celulares, tablets y PC, tanto en vertical como en horizontal**— y conecta **5 módulos en tiempo real** sobre PostgreSQL 18.
>
> **¿Qué hace y cómo funciona?** Veámoslo con un cliente real en la **Mesa 04**:
>
> `[1. Señala el Carrusel de 4 imágenes y el apartado del Platillo Especial del Día.]`
>
> Al abrir nuestra **Carta Digital**, el cliente ve un **carrusel visual con 4 platos** que cambia de contenido cada día, y al lado, el **Platillo Especial del Día con 25% de descuento**, que rota automáticamente cada día para evitar monotonía y disparar el consumo.
>
> `[2. Señala los platos con insignia dorada Top #1 Popular.]`
>
> Además, nuestro sistema analiza las ventas reales de los últimos 7 días en la base de datos y marca automáticamente los **platillos más populares de la semana**; si la semana siguiente se venden otros, la carta se actualiza sola.
>
> `[3. Pulsa "Pedir Especial del Día", abre el carrito, activa comentario opcional, escribe "Sin cebolla" y pulsa "Confirmar Pedido".]`
>
> El cliente agrega el plato con su descuento aplicado, opcionalmente deja una indicación como *'sin cebolla'* y confirma.
>
> `[4. Clic en "Cocina" en la barra superior.]`
>
> Al instante, el pedido llega a la **Pantalla de Cocina (KDS)** organizado por estación —Wok, Horno, Entradas, Bar y Postres— con reloj y alertas de demora.
>
> `[5. Clic en "Mesas" (3 seg) y luego clic en "Caja". Selecciona la cuenta, elige Yape, pulsa Pagar y clic en "Ver Boleta".]`
>
> Mientras el mozo controla las **15 mesas por colores de estado**, en **Caja** cobramos en segundos con **Efectivo, Tarjeta POS, Yape o Plin**, y emitimos una **Boleta Electrónica en PDF** con desglose de IGV y un **cupón único de 15% de descuento** para que el cliente vuelva.
>
> **¿Qué nos diferencia de otros sistemas?** Tres cosas: **cero hardware costoso** (corre en los celulares que el local ya tiene), **cero comisiones por plato**, y **fidelización automática** integrada con modo oscuro y seguridad estricta por roles.
>
> Ahora **[Nombre Integrante 4]** detallará quiénes participan en el ecosistema y cómo generamos rentabilidad."

---

### INTEGRANTE 4 — Punto 4: Usuarios / Stakeholders *(3:40 – 4:15)* + Punto 5: Cómo se obtiene el ROI *(4:15 – 5:05)* *(Total: 1 min 25 seg)*

> `[Integrante 4 pasa al frente. Opcional: dejar /admin.html visible en pantalla mostrando los KPIs y roles.]`
>
> "En nuestra Ingeniería de Requerimientos identificamos cuatro grupos clave de **Usuarios y Stakeholders**:
> 1. **Usuarios principales (operativos):** **Mozos** (controlan las 15 mesas y toman comandas), **Cocineros** (gestionan la pantalla KDS por estación) y **Cajeros** (liquidan cuentas y emiten comprobantes).
> 2. **Administradores:** Dueños y gerentes del restaurante, con acceso exclusivo al Dashboard en vivo, historial de ventas protegido y gestión de personal con **borrado lógico** para nunca perder auditoría.
> 3. **Clientes:** Comensales peruanos y **turistas extranjeros** —nuestro registro valida DNI, Pasaporte, Carné de Extranjería y teléfonos internacionales—.
> 4. **Empresas involucradas:** Restaurantes medianos, pollerías y cevicherías (clientes B2B), pasarelas de pago como **Yape, Plin y POS**, proveedores de nube y operadores OSE para facturación electrónica **SUNAT**.
>
> `[Transición firme al Punto 5: Cómo se obtiene el ROI.]`
>
> Ahora, **¿cómo se obtiene el Retorno de Inversión (ROI)?** Funciona en dos niveles:
>
> Primero, **para el restaurante cliente**: paga una suscripción fija mensual de **S/ 99 en Plan Básico** o **S/ 169 en Plan Pro** (promedio **S/ 120/mes**), con **0% de comisiones por pedido**. Al acelerar mesas en hora punta, impulsar el Especial del Día y generar recompras con el cupón de la boleta, con vender solo **4 platos extra al mes** el sistema ya se pagó solo —obteniendo un beneficio estimado de S/ 800 mensuales, más de **500% de ROI mensual**.
>
> Y segundo, **para Melidan Tech**: al ser un software web escalable (SaaS), nuestro costo de nube y soporte por restaurante es mínimo, dándonos un **margen operativo superior al 75%–80%** sobre cada suscripción recurrente.
>
> Para cerrar con nuestra proyección financiera exacta y nuestra oferta, los dejo con **[Nombre Integrante 5]**."

---

### INTEGRANTE 5 — Punto 6: Solicitud de Inversión con Sustento de ROI (6 meses y 1 año) + Cierre *(5:05 – 6:10 | 1 min 05 seg)*

> `[Integrante 5 mira directamente al jurado con seguridad y muestra una diapositiva simple con la tabla de 6 meses y 1 año si usan slides.]`
>
> "Inversionistas, hoy solicitamos una inversión de **S/ 25,000 por el 15% de participación** en Melidan Tech.
>
> **¿Cómo sustentamos el ROI en el tiempo?** Con nuestro equipo de 5 fundadores afiliando 15 restaurantes por mes en Lima a una suscripción promedio de S/ 120:
> - **A los 6 meses:** alcanzamos **90 restaurantes activos**, acumulando **S/ 37,800 en ingresos** y **S/ 30,240 en utilidad neta operativa** (tras descontar 20% de nube, soporte y marketing). Esto significa que **recuperamos el 100% de la inversión en el mes 5.5**, logrando ya un **ROI positivo de +21% al sexto mes**.
> - **Al cumplir 1 año:** escalamos a **150 restaurantes activos**, con **S/ 127,800 en ingresos acumulados** y **S/ 95,850 en utilidad neta** (descontando 25% de costos operativos). Eso representa un **ROI del +283% en 12 meses** —casi **cuatro veces** la inversión inicial— y cerramos el año facturando **S/ 18,000 mensuales recurrentes**.
>
> **¿Por qué invertir en nuestra idea y qué beneficios ofrece?**
> Porque ya tenemos un **sistema real funcionando hoy con 85 pruebas automatizadas**, atacamos un mercado de más de 200,000 restaurantes en Perú, y ofrecemos ingresos recurrentes predecibles con altísimo margen. Su inversión se destinará 40% a expansión comercial, 35% a integración oficial OSE-SUNAT y nube multi-restaurante, y 25% a soporte de lanzamiento.
>
> Tiburones, la cocina está encendida y los números sobre la mesa… **¿quién invierte hoy en Melidan Tech?** Muchas gracias."

---

## 4. Tabla Financiera Exacta de Sustento ROI (Para estudiar o poner en diapositiva)

> Fórmula estándar de ROI:
> `ROI (%) = ((Utilidad Neta Acumulada - Inversión Inicial) / Inversión Inicial) × 100`

| Horizonte | Restaurantes Activos | Meses-Cliente Acumulados | Ingresos Brutos (S/ 120 prom.) | Costos Operativos | Utilidad Neta Acumulada | Inversión Inicial | **ROI Acumulado** |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **A 6 meses** | 90 locales | 315 | S/ 37,800 | S/ 7,560 *(20%)* | **S/ 30,240** | S/ 25,000 | **+21%** *(Break-even mes 5.5)* |
| **A 1 año (12m)** | 150 locales | 1,065 | S/ 127,800 | S/ 31,950 *(25%)* | **S/ 95,850** | S/ 25,000 | **+283%** *(3.83x capital)* |

---

## 5. Banco de 20 Posibles Preguntas de la Maestra / "Tiburones"

### A. Finanzas, ROI e Inversión
1. **¿Cómo sacaron ese +21% a 6 meses y +283% al año?**
   *Respuesta (Integrante 5):* Con la fórmula `((Utilidad Neta - Inversión) / Inversión) × 100`. Con S/ 25,000 de inversión y creciendo 15 locales al mes a S/ 120 promedio, en 6 meses sumamos 315 mensualidades (S/ 37,800 brutos, S/ 30,240 netos → +21%). Al mes 12 sumamos 1,065 mensualidades (S/ 127,800 brutos, S/ 95,850 netos → +283%).
2. **¿En qué exactamente van a gastar los S/ 25,000?**
   *Respuesta (Integrante 5):* 40% (S/ 10,000) en captación de clientes y marketing local; 35% (S/ 8,750) en nube multi-restaurante e integración oficial API OSE-SUNAT; 25% (S/ 6,250) en soporte y piloto comercial.
3. **¿Qué pasa si solo consiguen la mitad de restaurantes proyectados?**
   *Respuesta (Integrante 5):* En un escenario conservador (50% de la meta, 75 locales al año), igual cubrimos el 100% de costos operativos por nuestro margen SaaS del 75%–80%, recuperamos la inversión en el mes 9 y cerramos el año en positivo (~+90% ROI).
4. **¿Por qué un restaurante pagaría S/ 99 o S/ 169 al mes si puede usar papel o Excel?**
   *Respuesta (Integrante 2/4):* Porque perder una sola mesa en hora punta o equivocarse en dos comandas ya cuesta más de S/ 120. Melidan se paga solo vendiendo 4 platos extra al mes y además fideliza clientes con el cupón automático en la boleta.
5. **¿Cuál es su competencia y cómo le ganan?**
   *Respuesta (Integrante 3):* Apps como Rappi cobran 25%–30% de comisión y son para delivery; los POS tradicionales cobran miles de soles en hardware dedicado. Melidan cobra cuota fija sin comisiones, corre en cualquier celular/tablet del restaurante y une carta inteligente + cocina KDS + caja Yape/Plin + fidelización.
6. **¿Ya tienen clientes reales pagando hoy?**
   *Respuesta (Integrante 1):* Hoy contamos con el producto funcional completo (MVP) probado con 85 pruebas automatizadas en el caso real de Restaurante Melidan. El siguiente paso inmediato es un piloto de 30 días en 5 restaurantes locales para validar conversión y cerrar los primeros contratos.

### B. Producto, Carta y Usuarios
7. **¿Qué pasa si un cliente mayor o sin datos no sabe usar la carta QR?**
   *Respuesta (Integrante 3/4):* Tenemos el módulo exclusivo de **Mozo** con control de las 15 mesas: el mozo toma la comanda desde su propio celular en segundos y el flujo hacia cocina y caja sigue siendo 100% digital.
8. **¿Por qué dicen que la carta nunca es monótona?**
   *Respuesta (Integrante 3):* Porque el backend aplica una rotación diaria cíclica por fecha de Perú: el **Platillo Especial del Día (-25%)** cambia obligatoriamente cada día sin repetirse en días consecutivos, y el **carrusel de 4 platos** renueva sus 4 imágenes todos los días.
9. **¿Cómo saben qué platos son "Populares"? ¿Los eligen a mano?**
   *Respuesta (Integrante 3):* No. PostgreSQL calcula automáticamente la suma de unidades vendidas en los **últimos 7 días** (`pedidos` no cancelados). Si la semana siguiente se venden otros platos, las insignias de Top #1 a #4 se actualizan solas.
10. **¿Qué pasa si un dueño no quiere dar 25% de descuento todos los días?**
    *Respuesta (Integrante 4):* El porcentaje es parametrizable (puede ser 10%, 15% o 25%) y aplica a un solo plato gancho por día para rotar inventario fresco y subir el consumo de bebidas y entradas a precio normal.
11. **¿Acepta clientes o trabajadores extranjeros?**
    *Respuesta (Integrante 4):* Sí, el registro valida documentos peruanos (**DNI 8 dígitos**) y extranjeros (**Pasaporte, Carné de Extranjería**) junto con teléfonos internacionales.
12. **¿Funciona en cualquier celular o tablet?**
    *Respuesta (Integrante 3):* Sí, es una PWA responsive probada en celulares, tablets y PC tanto en **modo vertical como horizontal**, con Modo Oscuro y sin necesidad de descargar apps desde Play Store.

### C. Ingeniería de Requerimientos, Seguridad y Tecnología
13. **¿Cómo aplicaron Ingeniería de Requerimientos en este proyecto?**
    *Respuesta (Integrante 1/4):* Levantamos stakeholders, definimos 6 casos de uso principales, modelamos diagramas UML de Casos de Uso, Actividad, Secuencia y Estado, especificamos requerimientos funcionales y 12 categorías de no funcionales, y validamos todo mediante requisitos de calificación medibles (85 pruebas automatizadas).
14. **¿Qué pasa si un mozo o un cliente intenta entrar al panel de ventas del Admin?**
    *Respuesta (Integrante 4):* Tenemos control estricto de roles (**RBAC**) tanto en frontend como en backend mediante tokens firmados con **HMAC-SHA256**. Cualquier acceso no autorizado al historial financiero devuelve HTTP 401/403.
15. **¿Qué pasa si borran a un trabajador por error o mala fe?**
    *Respuesta (Integrante 4):* Usamos **borrado lógico (Soft Delete)**: el registro nunca se elimina físicamente de PostgreSQL, se archiva en papelera con fecha de baja y el Administrador puede restaurarlo sin romper el historial de pedidos.
16. **¿Qué pasa si se corta el internet en el restaurante?**
    *Respuesta (Integrante 3):* Al poder ejecutarse en servidor local conectado al Wi-Fi interno del restaurante, el salón, la cocina y la caja siguen operando con normalidad incluso si cae el internet externo.
17. **¿Las boletas ya se envían a SUNAT?**
    *Respuesta (Integrante 5):* Hoy el sistema genera el comprobante electrónico completo en PDF (RUC, serie B001/F001, IGV 18%, monto en letras, hash y cupón). La conexión directa vía API con un OSE autorizado de SUNAT forma parte de la Fase 2 financiada con el 35% de la inversión.
18. **¿Por qué PostgreSQL 18 y Node.js?**
    *Respuesta (Integrante 3):* PostgreSQL garantiza transacciones ACID para cobros y pedidos sin pérdida de datos; Node.js + Express ofrece baja latencia y soporta múltiples dispositivos simultáneos con mínimo consumo de recursos.

### D. Preguntas "Trampa" de Negociación Shark Tank
19. **"Te doy los S/ 25,000, pero quiero el 35% de tu empresa."**
    *Respuesta (Integrante 5):* *"Agradecemos muchísimo su oferta y su respaldo estratégico. Ceder el 35% tan temprano limitaría futuras rondas de crecimiento; les proponemos un punto medio justo: **S/ 25,000 por el 20%**, sumando su apoyo para abrirnos las puertas en los primeros 20 restaurantes clave."*
20. **"¿Por qué debería invertir en este equipo de 5 estudiantes?"**
    *Respuesta (Integrante 1):* *"Porque no trajimos una idea en papel: trajimos un sistema real funcionando de extremo a extremo, documentado bajo estándares de Ingeniería de Requerimientos y validado con 85 pruebas. Tenemos la capacidad técnica, la visión comercial y las ganas de ejecutarlo."*
