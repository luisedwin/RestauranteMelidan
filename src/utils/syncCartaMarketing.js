/**
 * src/utils/syncCartaMarketing.js
 * Migración idempotente y no destructiva para actualizar melidan_db con:
 * - Precios psicológicos en decimales (.90 / .50)
 * - 7 categorías comerciales (Menú del Día, Combos, Platos Criollos, Platos Especiales, Entradas, Bebidas y Jarras, Postres)
 * - 46 productos con programación por días (LUN,MIE,VIE / MAR,JUE,SAB / DOM / VIE,SAB,DOM / TODOS)
 * - Tabla promociones_carta para promos activas en la Carta Digital
 *
 * Nunca borra usuarios, mesas, pedidos, ventas ni comprobantes existentes.
 */

const path = require('path');
const DISH_IMAGES = require(path.join(__dirname, '..', '..', 'public', 'data', 'carta-imagenes.json'));

function dishImg(id) {
  return DISH_IMAGES.byId[String(id)] || '';
}

let syncPromise = null;

const CATEGORIES_SEED = [
  [1, 'Platos Especiales', 'Especialidades en horno de barro, fuego lento y leña tradicional de la casa.'],
  [2, 'Platos Criollos', 'Recetas clásicas de la gastronomía peruana preparadas al wok y a fuego lento.'],
  [3, 'Bebidas y Jarras', 'Jarras artesanales de 1L, refrescos naturales, cócteles de autor y gaseosas.'],
  [4, 'Postres', 'Postres caseros peruanos y dulces tradicionales.'],
  [5, 'Entradas', 'Entradas peruanas tradicionales, causas, anticuchos y piqueos para compartir.'],
  [6, 'Combos', 'Combos para 1, 2 o 4 personas con precio promocional rebajado.'],
  [7, 'Menú del Día', 'Menús completos con entrada, plato de fondo y bebida que varían según el día de la semana.']
];

const PRODUCTS_SEED = [
  // Platos Especiales (id_categoria = 1)
  [1, 1, 'Lechón a Fuego Lento', 'Corte jugoso marinado en especias tradicionales horneado a leña por 6 horas con camote glaseado.', 47.90, null, 'Firma de la Casa', 'TODOS', 'fuego_lento', 35, true, dishImg(1)],
  [2, 1, 'Costillar Glaseado a la Leña', 'Costillar tierno caramelizado con salsa BBQ artesanal, especias andinas y papas doradas.', 41.90, null, 'Favorito del Chef', 'TODOS', 'horno_artesanal', 25, true, dishImg(2)],
  [13, 1, 'Panceta Crocante al Horno de Barro', 'Panceta horneada lentamente con piel ultra crocante, camote glaseado y zarza criolla.', 45.90, null, 'Horno de Barro', 'TODOS', 'horno_artesanal', 30, true, dishImg(13)],
  [14, 1, 'Osobuco Braseado 8 Horas', 'Osobuco de res cocido a fuego lento en chicha de jora y hierbas andinas sobre puré rústico.', 51.90, null, 'Cocción 8h', 'TODOS', 'fuego_lento', 32, false, dishImg(14)],
  [15, 1, 'Pato Asado a la Leña Norteña', 'Cuarto de pato tierno macerado en culantro, naranja agria y zapallo loche horneado a leña.', 48.90, null, null, 'TODOS', 'horno_artesanal', 28, false, dishImg(15)],
  [28, 1, 'Pachamanca a la Olla Tradicional', 'Tres carnes maceradas en chincho y huacatay con papa nativa, habas, choclo, humita y ají.', 44.90, 52.90, 'Solo Domingos', 'DOM', 'fuego_lento', 30, true, dishImg(28)],

  // Platos Criollos (id_categoria = 2)
  [3, 2, 'Lomo Saltado Tradicional', 'Corte premium de lomo fino flameado al wok con cebolla morada, tomate y papas nativas.', 37.90, null, null, 'TODOS', 'estandar', 15, false, dishImg(3)],
  [4, 2, 'Ají de Gallina', 'Receta tradicional con crema de ají amarillo, pechuga deshilachada, nueces, papas y aceituna.', 24.90, null, 'Clásico Criollo', 'TODOS', 'estandar', 12, true, dishImg(4)],
  [6, 2, 'Lomo Saltado Clásico', 'Trozos de lomo jugoso flameado al wok con cebolla, tomate, ají amarillo, servido con arroz.', 27.90, null, 'Más Pedido', 'TODOS', 'estandar', 14, true, dishImg(6)],
  [16, 2, 'Arroz con Pato a la Chiclayana', 'Arroz graneado al culantro y cerveza negra con pierna de pato dorada y sarsa norteña.', 43.90, null, 'Receta Norteña', 'TODOS', 'fuego_lento', 22, true, dishImg(16)],
  [17, 2, 'Seco de Res con Frejoles', 'Asado de tira cocido lentamente en salsa de culantro y loche con frejoles canarios cremosos.', 38.90, null, null, 'TODOS', 'fuego_lento', 20, false, dishImg(17)],
  [18, 2, 'Tallarines Verdes con Bife Angosto', 'Pasta artesanal en salsa pesto de albahaca y espinaca con bife angosto a la parrilla (250g).', 41.90, null, null, 'TODOS', 'estandar', 18, false, dishImg(18)],
  [19, 2, 'Chaufa Amazónico al Wok', 'Arroz salteado a fuego alto con cecina ahumada, chorizo regional y plátano maduro.', 33.90, null, null, 'TODOS', 'estandar', 14, false, dishImg(19)],
  [29, 2, 'Carapulcra con Sopa Seca Chinchana', 'Papa seca guisada con maní y cerdo acompañada de tallarín aderezado en albahaca y achiote.', 29.90, 35.90, 'Lun · Mié · Vie', 'LUN,MIE,VIE', 'fuego_lento', 16, true, dishImg(29)],
  [30, 2, 'Arroz con Mariscos a la Criolla', 'Arroz meloso en salsa madre de coral, langostinos, calamar, conchas y sarza criolla fresca.', 36.90, 42.90, 'Lun · Mié · Vie', 'LUN,MIE,VIE', 'estandar', 18, true, dishImg(30)],
  [31, 2, 'Tacu Tacu con Lomo al Jugo', 'Crujiente tacu tacu de frejoles canarios coronado con lomo saltado jugoso y plátano frito.', 34.90, 39.90, 'Mar · Jue · Sáb', 'MAR,JUE,SAB', 'estandar', 16, true, dishImg(31)],
  [32, 2, 'Cau Cau Criollo de Mondongo', 'Guiso tradicional limeño en crema de palillo y hierbabuena fresca con papa en cubos y arroz.', 26.90, 31.90, 'Mar · Jue · Sáb', 'MAR,JUE,SAB', 'fuego_lento', 15, false, dishImg(32)],

  // Entradas (id_categoria = 5)
  [8, 5, 'Causa Limeña de Cangrejo', 'Masa suave de papa amarilla al limón y ají amarillo rellena de pulpa de cangrejo y palta.', 25.90, null, null, 'TODOS', 'estandar', 10, true, dishImg(8)],
  [9, 5, 'Anticuchos de Corazón a la Brasa', 'Brochetas tradicionales marinadas en ají panca con papas doradas, choclo y ají carretillero.', 24.90, null, 'A la Brasa', 'TODOS', 'estandar', 14, true, dishImg(9)],
  [10, 5, 'Papa a la Huancaína Artesanal', 'Rodajas de papa blanca bañadas en salsa cremosa de ají amarillo asado y queso serrano.', 17.90, null, null, 'TODOS', 'estandar', 8, false, dishImg(10)],
  [11, 5, 'Tequeños de Lomo y Queso (6 und.)', 'Crujientes tequeños rellenos de lomo saltado jugoso y queso andino con guacamole casero.', 21.90, null, 'Para Compartir', 'TODOS', 'estandar', 10, false, dishImg(11)],
  [12, 5, 'Pulpo al Olivo', 'Láminas tiernas de pulpo bañadas en emulsión artesanal de aceitunas botija de Tacna.', 31.90, null, null, 'TODOS', 'estandar', 10, false, dishImg(12)],
  [33, 5, 'Choritos a la Chalaca (8 und.)', 'Choros frescos cubiertos con zarza chalaca de cebolla, tomate, choclo tierno y toque de limón.', 22.90, null, 'Entrada Fresca', 'TODOS', 'estandar', 9, false, dishImg(33)],

  // Bebidas y Jarras (id_categoria = 3)
  [5, 3, 'Jarra de Chicha Morada Artesanal (1L)', 'Bebida natural de maíz morado hervida con piña golden, manzana, clavo y canela (rinde 4 vasos).', 14.90, null, 'Jarra 1L', 'TODOS', 'estandar', 5, true, dishImg(5)],
  [7, 3, 'Limonada Frozen Clásica', 'Bebida refrescante de limón sutil licuada con hielo frapé y hojas de menta fresca.', 11.90, null, null, 'TODOS', 'estandar', 5, true, dishImg(7)],
  [20, 3, 'Maracuyá Sour de la Casa', 'Cóctel bandera preparado con pisco quebranta seleccionado, zumo de maracuyá y amargo.', 21.90, null, 'Cóctel de Autor', 'TODOS', 'estandar', 6, false, dishImg(20)],
  [21, 3, 'Jarra de Maracuyá Natural (1L)', 'Refresco natural de pulpa pura de maracuyá infusionado con hojas frescas de hierbabuena.', 15.90, null, 'Jarra 1L', 'TODOS', 'estandar', 5, false, dishImg(21)],
  [25, 3, 'Maracuyá Sour sin Alcohol', 'Pulpa natural de maracuyá batida con limón fresco, jarabe artesanal y espuma suave.', 12.90, null, 'Sin Alcohol', 'TODOS', 'estandar', 5, true, dishImg(25)],
  [26, 3, 'Emoliente Frutal Helado', 'Infusión tradicional de cebada, linaza y hierbas andinas servida bien fría con piña y limón.', 10.90, null, null, 'TODOS', 'estandar', 4, false, dishImg(26)],
  [34, 3, 'Jarra de Limonada de Hierbabuena (1L)', 'Limonada fresca batida con hierbabuena del huerto y hielo frapé ideal para compartir en mesa.', 16.90, 19.90, 'Jarra 1L · Promo', 'TODOS', 'estandar', 5, true, dishImg(34)],
  [35, 3, 'Jarra de Sangría Criolla (1L)', 'Vino tinto seleccionado macerado con naranja, manzana, canela y toque de pisco acholado.', 34.90, 42.90, 'Jarra 1L · Finde', 'VIE,SAB,DOM', 'estandar', 6, false, dishImg(35)],
  [36, 3, 'Vaso de Chicha Morada (450ml)', 'Porción individual bien helada de nuestra chicha morada casera con toque de limón sutil.', 6.50, null, 'Personal', 'TODOS', 'estandar', 3, false, dishImg(36)],
  [37, 3, 'Pisco Sour Clásico Peruano', 'Pisco quebranta puro, zumo de limón fresco, jarabe de goma, clara y gotas de amargo.', 22.90, null, 'Clásico Barra', 'TODOS', 'estandar', 6, false, dishImg(37)],
  [38, 3, 'Chilcano de Maracuyá o Limón', 'Refrescante chilcano con pisco quebranta, ginger ale bien frío, limón y pulpa de estación.', 18.90, 22.90, 'Happy Hour', 'TODOS', 'estandar', 5, false, dishImg(38)],
  [39, 3, 'Inca Kola / Gaseosa Personal (500ml)', 'Botella personal helada (Inca Kola, Coca-Cola o agua mineral con/sin gas).', 5.90, null, null, 'TODOS', 'estandar', 2, false, dishImg(39)],

  // Postres (id_categoria = 4)
  [22, 4, 'Suspiro a la Limeña Clásico', 'Manjar de yemas sedoso coronado con merengue italiano al oporto y canela en polvo.', 15.90, null, null, 'TODOS', 'estandar', 6, true, dishImg(22)],
  [23, 4, 'Picarones con Miel de Chancaca', 'Aros crocantes de zapallo macre y camote bañados en miel aromática de higo y naranja.', 14.90, null, 'Hecho al Momento', 'TODOS', 'estandar', 8, false, dishImg(23)],
  [24, 4, 'Tres Leches de Lúcuma', 'Bizcocho esponjoso embebido en tres leches y pulpa de lúcuma de seda con cacao peruano.', 17.90, null, null, 'TODOS', 'estandar', 6, false, dishImg(24)],
  [27, 4, 'Combinado Clásico Limeño', 'Dúo tradicional de mazamorra morada con frutas secas y arroz con leche a la canela.', 13.90, null, null, 'TODOS', 'fuego_lento', 6, true, dishImg(27)],

  // Combos (id_categoria = 6)
  [40, 6, 'Combo Criollo Para 2', '1 Lomo Saltado Clásico + 1 Ají de Gallina + 1 Jarra de Chicha Morada (1L). Ideal para compartir.', 54.90, 67.70, 'Ahorra S/ 12.80', 'TODOS', 'estandar', 18, true, dishImg(40)],
  [41, 6, 'Combo Horno & Brasa Familiar (4 pers.)', '1 Lechón a Fuego Lento + 1 Costillar Glaseado + 1 Anticuchos + 2 Jarras 1L a elección.', 119.90, 145.50, 'Ahorra S/ 25.60', 'TODOS', 'horno_artesanal', 30, true, dishImg(41)],
  [42, 6, 'Combo Almuerzo Express Wok', '1 Chaufa Amazónico al Wok + 3 Tequeños de Lomo y Queso + 1 Limonada Frozen.', 39.90, 49.90, 'Ahorra S/ 10.00', 'TODOS', 'estandar', 15, false, dishImg(42)],
  [43, 6, 'Combo Dúo Barra & Piqueo', '1 Tequeños de Lomo y Queso (6 und.) + 2 Chilcanos de Maracuyá o Limón bien helados.', 46.90, 59.70, 'Ahorra S/ 12.80', 'VIE,SAB,DOM', 'estandar', 12, false, dishImg(43)],

  // Menú del Día (id_categoria = 7)
  [44, 7, 'Menú del Día (Lun · Mié · Vie)', 'Entrada: Papa a la Huancaína + Fondo: Carapulcra con Sopa Seca (o Lomo Clásico) + Vaso de Chicha.', 21.90, 28.90, 'Lun · Mié · Vie', 'LUN,MIE,VIE', 'fuego_lento', 14, true, dishImg(44)],
  [45, 7, 'Menú del Día (Mar · Jue · Sáb)', 'Entrada: Causa Limeña + Fondo: Ají de Gallina (o Tacu Tacu al Jugo) + Vaso de Limonada.', 22.90, 29.90, 'Mar · Jue · Sáb', 'MAR,JUE,SAB', 'estandar', 14, true, dishImg(45)],
  [46, 7, 'Menú Especial de Domingo', 'Entrada: Anticuchos a la Brasa + Fondo: Pachamanca a la Olla + Chicha Morada + Combinado Limeño.', 32.90, 42.90, 'Solo Domingos', 'DOM', 'fuego_lento', 22, true, dishImg(46)]
];

const PROMOS_SEED = [
  ['COMBO_CRIOLLO_2', 'Combo Criollo Para 2', 'Lomo + Ají de Gallina + Jarra 1L a solo S/ 54.90', 'AHORRA S/ 12.80', 'TODOS', 'Combos', 40, '#FF5722'],
  ['MENU_LMV', 'Menú Lun · Mié · Vie', 'Huancaína + Carapulcra con Sopa Seca + Chicha a S/ 21.90', 'LUN · MIÉ · VIE', 'LUN,MIE,VIE', 'Menú del Día', 44, '#009B77'],
  ['MENU_MJS', 'Menú Mar · Jue · Sáb', 'Causa + Ají de Gallina o Tacu Tacu + Limonada a S/ 22.90', 'MAR · JUE · SÁB', 'MAR,JUE,SAB', 'Menú del Día', 45, '#0284C7'],
  ['MENU_DOM', 'Domingo de Pachamanca', 'Menú Especial Dominical completo desde S/ 32.90', 'SOLO DOMINGOS', 'DOM', 'Menú del Día', 46, '#D97706'],
  ['JARRAS_PROMO', 'Jarras 1L y Happy Hour', 'Jarras artesanales desde S/ 14.90 y Chilcanos a S/ 18.90', 'DESDE S/ 14.90', 'TODOS', 'Bebidas y Jarras', 34, '#7C3AED']
];

async function runSync(pool) {
  const client = await pool.connect();
  try {
    // Verificación rápida: si ya tiene columnas, tabla promos, precios decimales y las 46 imágenes coinciden exactamente con carta-imagenes.json, salir en < 2 ms
    const expectedIds = PRODUCTS_SEED.map((p) => p[0]);
    const expectedUrls = PRODUCTS_SEED.map((p) => p[11]);
    const check = await client.query(`
      SELECT
        EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'productos' AND column_name = 'dias_disponibles') AS has_cols,
        EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'promociones_carta') AS has_promos,
        (SELECT COUNT(*)::int FROM productos WHERE id_producto IN (28, 29, 40, 44, 45, 46)) AS new_prods,
        (SELECT COUNT(*)::int FROM productos WHERE id_producto IN (1, 4, 6, 7) AND (precio - FLOOR(precio)) > 0) AS dec_ok,
        (
          SELECT COUNT(*)::int
          FROM productos p
          JOIN unnest($1::int[], $2::text[]) AS e(id_producto, imagen_url)
            ON p.id_producto = e.id_producto AND p.imagen_url = e.imagen_url
        ) AS exact_imgs
    `, [expectedIds, expectedUrls]);
    const st = check.rows[0];
    if (st.has_cols && st.has_promos && st.new_prods === 6 && st.dec_ok === 4 && st.exact_imgs === PRODUCTS_SEED.length) {
      return { migrated: false };
    }

    await client.query('BEGIN');
    await client.query(`
      ALTER TABLE productos
        ADD COLUMN IF NOT EXISTS precio_regular NUMERIC(10, 2) NULL CHECK (precio_regular IS NULL OR precio_regular >= 0),
        ADD COLUMN IF NOT EXISTS etiqueta_marketing VARCHAR(60) NULL,
        ADD COLUMN IF NOT EXISTS dias_disponibles VARCHAR(40) NOT NULL DEFAULT 'TODOS'
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS promociones_carta (
        id_promo SERIAL PRIMARY KEY,
        codigo VARCHAR(30) UNIQUE NOT NULL,
        titulo VARCHAR(100) NOT NULL,
        subtitulo VARCHAR(180) NOT NULL,
        badge_texto VARCHAR(40) NOT NULL,
        dias_aplicables VARCHAR(40) NOT NULL DEFAULT 'TODOS',
        categoria_destino VARCHAR(60) NULL,
        id_producto_destacado INT NULL REFERENCES productos(id_producto) ON DELETE SET NULL,
        color_acento VARCHAR(20) DEFAULT '#FF5722',
        activa BOOLEAN DEFAULT TRUE
      )
    `);

    for (const [id, nombre, desc] of CATEGORIES_SEED) {
      await client.query(
        `INSERT INTO categorias (id_categoria, nombre, descripcion)
         VALUES ($1, $2, $3)
         ON CONFLICT (id_categoria) DO UPDATE
         SET nombre = EXCLUDED.nombre, descripcion = EXCLUDED.descripcion`,
        [id, nombre, desc]
      );
    }

    for (const p of PRODUCTS_SEED) {
      await client.query(
        `INSERT INTO productos (id_producto, id_categoria, nombre, descripcion, precio, precio_regular, etiqueta_marketing, dias_disponibles, tipo_coccion, tiempo_preparacion_min, destacado_menu, disponible, imagen_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,TRUE,$12)
         ON CONFLICT (id_producto) DO UPDATE
         SET id_categoria = EXCLUDED.id_categoria,
             nombre = EXCLUDED.nombre,
             descripcion = EXCLUDED.descripcion,
             precio = EXCLUDED.precio,
             precio_regular = EXCLUDED.precio_regular,
             etiqueta_marketing = EXCLUDED.etiqueta_marketing,
             dias_disponibles = EXCLUDED.dias_disponibles,
             tipo_coccion = EXCLUDED.tipo_coccion,
             tiempo_preparacion_min = EXCLUDED.tiempo_preparacion_min,
             destacado_menu = EXCLUDED.destacado_menu,
             disponible = TRUE,
             imagen_url = EXCLUDED.imagen_url`,
        p
      );
    }

    for (const pr of PROMOS_SEED) {
      await client.query(
        `INSERT INTO promociones_carta (codigo, titulo, subtitulo, badge_texto, dias_aplicables, categoria_destino, id_producto_destacado, color_acento, activa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE)
         ON CONFLICT (codigo) DO UPDATE
         SET titulo = EXCLUDED.titulo,
             subtitulo = EXCLUDED.subtitulo,
             badge_texto = EXCLUDED.badge_texto,
             dias_aplicables = EXCLUDED.dias_aplicables,
             categoria_destino = EXCLUDED.categoria_destino,
             id_producto_destacado = EXCLUDED.id_producto_destacado,
             color_acento = EXCLUDED.color_acento,
             activa = TRUE`,
        pr
      );
    }

    await client.query(`SELECT setval(pg_get_serial_sequence('categorias', 'id_categoria'), COALESCE((SELECT MAX(id_categoria) FROM categorias), 1), true)`);
    await client.query(`SELECT setval(pg_get_serial_sequence('productos', 'id_producto'), COALESCE((SELECT MAX(id_producto) FROM productos), 1), true)`);
    await client.query(`SELECT setval(pg_get_serial_sequence('promociones_carta', 'id_promo'), COALESCE((SELECT MAX(id_promo) FROM promociones_carta), 1), true)`);

    await client.query('COMMIT');
    console.log('  ✔ Catálogo Melidan sincronizado en PostgreSQL (46 productos .90, combos, menú del día, jarras y promos).');
    return { migrated: true };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function ensureCartaMarketingSchema(pool) {
  if (!syncPromise) {
    syncPromise = runSync(pool).catch((err) => {
      syncPromise = null;
      throw err;
    });
  }
  return syncPromise;
}

if (require.main === module) {
  const { pool } = require('../config/db');
  ensureCartaMarketingSchema(pool)
    .then((r) => {
      console.log('Sync result:', r);
      return pool.end();
    })
    .catch((err) => {
      console.error('Sync failed:', err.message);
      process.exit(1);
    });
}

module.exports = { ensureCartaMarketingSchema };
