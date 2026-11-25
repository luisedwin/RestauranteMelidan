-- ============================================================
-- BASE DE DATOS: Restaurante Melidan
-- Motor: PostgreSQL 18
-- Modelo Normalizado (1FN, 2FN, 3FN) y Buenas Prácticas
-- ============================================================

-- 1. Limpieza de tablas existentes (en cascada)
DROP TABLE IF EXISTS promociones_carta CASCADE;
DROP TABLE IF EXISTS recuperacion_claves CASCADE;
DROP TABLE IF EXISTS comprobantes CASCADE;
DROP TABLE IF EXISTS ventas CASCADE;
DROP TABLE IF EXISTS detalle_pedidos CASCADE;
DROP TABLE IF EXISTS pedidos CASCADE;
DROP TABLE IF EXISTS productos CASCADE;
DROP TABLE IF EXISTS categorias CASCADE;
DROP TABLE IF EXISTS mesas CASCADE;
DROP TABLE IF EXISTS usuarios CASCADE;
DROP TABLE IF EXISTS restaurante_info CASCADE;

-- Limpieza de tipos ENUM
DROP TYPE IF EXISTS rol_usuario CASCADE;
DROP TYPE IF EXISTS estado_mesa CASCADE;
DROP TYPE IF EXISTS tipo_coccion_enum CASCADE;
DROP TYPE IF EXISTS estado_pedido CASCADE;
DROP TYPE IF EXISTS metodo_pago_enum CASCADE;
DROP TYPE IF EXISTS estado_pago_enum CASCADE;
DROP TYPE IF EXISTS tipo_comprobante_enum CASCADE;

-- Creación de tipos ENUM nativos
CREATE TYPE rol_usuario AS ENUM ('administrador', 'mozo', 'cajero', 'cocina', 'recepcionista', 'cliente');
CREATE TYPE estado_mesa AS ENUM ('disponible', 'ocupada', 'reservada');
CREATE TYPE tipo_coccion_enum AS ENUM ('fuego_lento', 'horno_artesanal', 'estandar');
CREATE TYPE estado_pedido AS ENUM ('pendiente', 'en_cocina', 'listo', 'entregado', 'cancelado');
CREATE TYPE metodo_pago_enum AS ENUM ('aplicacion', 'efectivo_caja', 'tarjeta_caja');
CREATE TYPE estado_pago_enum AS ENUM ('exitoso', 'fallido', 'pendiente');
CREATE TYPE tipo_comprobante_enum AS ENUM ('boleta', 'factura');

-- ============================================================
-- 2. TABLA: Información Institucional y Marca (Fila Única)
-- ============================================================
CREATE TABLE restaurante_info (
    id_restaurante INT PRIMARY KEY DEFAULT 1,
    nombre VARCHAR(100) NOT NULL DEFAULT 'Melidan Restaurante',
    slogan VARCHAR(150) DEFAULT 'Tradición y sabor a fuego lento',
    anio_fundacion INT DEFAULT 2024,
    logo_url VARCHAR(255),
    ruc VARCHAR(11) UNIQUE NOT NULL,
    direccion VARCHAR(255) NOT NULL,
    telefono VARCHAR(20),
    CONSTRAINT chk_solo_un_restaurante CHECK (id_restaurante = 1)
);

-- ============================================================
-- 3. TABLA: Usuarios y Autenticación (con soporte para Extranjeros y Soft Delete)
-- ============================================================
CREATE TABLE usuarios (
    id_usuario SERIAL PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    rol rol_usuario NOT NULL DEFAULT 'mozo',
    tipo_documento VARCHAR(25) NOT NULL DEFAULT 'DNI',
    numero_documento VARCHAR(30),
    nacionalidad VARCHAR(50) DEFAULT 'Peruana',
    telefono VARCHAR(25),
    turno VARCHAR(100) DEFAULT 'Turno Mañana (8:00 AM - 4:00 PM)',
    estado VARCHAR(20) DEFAULT 'Activo',
    avatar VARCHAR(255) DEFAULT 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80',
    is_deleted BOOLEAN DEFAULT FALSE,
    fecha_eliminacion TIMESTAMPTZ NULL,
    fecha_creacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    fecha_actualizacion TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 4. TABLA: Recuperación de Claves (Tokens OTP)
-- ============================================================
CREATE TABLE recuperacion_claves (
    id SERIAL PRIMARY KEY,
    id_usuario INT NOT NULL,
    codigo VARCHAR(6) NOT NULL,
    expira_en TIMESTAMPTZ NOT NULL,
    usado BOOLEAN DEFAULT FALSE,
    creado_en TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_recuperacion_usuario
        FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE CASCADE
);

-- ============================================================
-- 5. TABLA: Mesas y Códigos QR (Control de Mesas y Aforo)
-- ============================================================
CREATE TABLE mesas (
    id_mesa SERIAL PRIMARY KEY,
    numero_mesa INT UNIQUE NOT NULL,
    codigo_qr VARCHAR(255) UNIQUE NOT NULL,
    capacidad INT DEFAULT 4 CHECK (capacidad > 0),
    estado VARCHAR(25) NOT NULL DEFAULT 'libre',
    tiempo_min INT DEFAULT 0,
    mozo_asignado VARCHAR(100) DEFAULT '-',
    monto_acumulado NUMERIC(10, 2) DEFAULT 0.00,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- ============================================================
-- 6. TABLA: Categorías del Menú
-- ============================================================
CREATE TABLE categorias (
    id_categoria SERIAL PRIMARY KEY,
    nombre VARCHAR(50) UNIQUE NOT NULL,
    descripcion TEXT
);

-- ============================================================
-- 7. TABLA: Productos / Carta
-- ============================================================
CREATE TABLE productos (
    id_producto SERIAL PRIMARY KEY,
    id_categoria INT NOT NULL,
    nombre VARCHAR(100) NOT NULL,
    descripcion TEXT,
    precio NUMERIC(10, 2) NOT NULL CHECK (precio >= 0),
    precio_regular NUMERIC(10, 2) NULL CHECK (precio_regular IS NULL OR precio_regular >= 0),
    etiqueta_marketing VARCHAR(60) NULL,
    dias_disponibles VARCHAR(40) NOT NULL DEFAULT 'TODOS',
    tipo_coccion tipo_coccion_enum DEFAULT 'estandar',
    tiempo_preparacion_min INT DEFAULT 15 CHECK (tiempo_preparacion_min >= 0),
    destacado_menu BOOLEAN DEFAULT FALSE,
    disponible BOOLEAN DEFAULT TRUE,
    imagen_url VARCHAR(255),
    CONSTRAINT fk_productos_categoria
        FOREIGN KEY (id_categoria) REFERENCES categorias(id_categoria) ON DELETE CASCADE
);

-- ============================================================
-- 7B. TABLA: Promociones y Campañas de Carta (Marketing)
-- ============================================================
CREATE TABLE promociones_carta (
    id_promo SERIAL PRIMARY KEY,
    codigo VARCHAR(30) UNIQUE NOT NULL,
    titulo VARCHAR(100) NOT NULL,
    subtitulo VARCHAR(180) NOT NULL,
    badge_texto VARCHAR(40) NOT NULL,
    dias_aplicables VARCHAR(40) NOT NULL DEFAULT 'TODOS',
    categoria_destino VARCHAR(60) NULL,
    id_producto_destacado INT NULL,
    color_acento VARCHAR(20) DEFAULT '#FF5722',
    activa BOOLEAN DEFAULT TRUE,
    CONSTRAINT fk_promo_producto
        FOREIGN KEY (id_producto_destacado) REFERENCES productos(id_producto) ON DELETE SET NULL
);

-- ============================================================
-- 8. TABLA: Pedidos (Monitoreo de Salón y KDS Cocina)
-- ============================================================
CREATE TABLE pedidos (
    id_pedido SERIAL PRIMARY KEY,
    numero_comanda INT UNIQUE NOT NULL,
    id_mesa INT NOT NULL,
    id_usuario INT NULL,
    nombre_cliente VARCHAR(100) DEFAULT 'Comensal',
    comentarios TEXT NULL,
    estado estado_pedido DEFAULT 'pendiente',
    fecha_hora TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_pedidos_mesa
        FOREIGN KEY (id_mesa) REFERENCES mesas(id_mesa),
    CONSTRAINT fk_pedidos_usuario
        FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario) ON DELETE SET NULL
);

-- ============================================================
-- 9. TABLA: Detalle de Pedidos
-- ============================================================
CREATE TABLE detalle_pedidos (
    id_detalle SERIAL PRIMARY KEY,
    id_pedido INT NOT NULL,
    id_producto INT NOT NULL,
    cantidad INT NOT NULL DEFAULT 1 CHECK (cantidad > 0),
    precio_unitario NUMERIC(10, 2) NOT NULL CHECK (precio_unitario >= 0),
    observaciones VARCHAR(255) NULL,
    CONSTRAINT fk_detalle_pedido
        FOREIGN KEY (id_pedido) REFERENCES pedidos(id_pedido) ON DELETE CASCADE,
    CONSTRAINT fk_detalle_producto
        FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
);

-- ============================================================
-- 10. TABLA: Ventas y Pagos
-- ============================================================
CREATE TABLE ventas (
    id_venta SERIAL PRIMARY KEY,
    id_pedido INT UNIQUE NOT NULL,
    metodo_pago metodo_pago_enum NOT NULL,
    canal_pago VARCHAR(40) NULL,
    referencia_pago VARCHAR(80) NULL,
    monto_total NUMERIC(10, 2) NOT NULL CHECK (monto_total >= 0),
    estado_pago estado_pago_enum DEFAULT 'exitoso',
    fecha_pago TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ventas_pedido
        FOREIGN KEY (id_pedido) REFERENCES pedidos(id_pedido)
);

-- ============================================================
-- 11. TABLA: Comprobantes Digitales
-- ============================================================
CREATE TABLE comprobantes (
    id_comprobante SERIAL PRIMARY KEY,
    id_venta INT UNIQUE NOT NULL,
    tipo_comprobante tipo_comprobante_enum NOT NULL,
    numero_comprobante VARCHAR(20) UNIQUE NOT NULL,
    documento_cliente VARCHAR(20) NULL,
    nombre_cliente VARCHAR(120) NULL,
    cajero_nombre VARCHAR(120) NULL,
    codigo_promo VARCHAR(40) NULL,
    descripcion_promo VARCHAR(220) NULL,
    fecha_emision TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_comprobantes_venta
        FOREIGN KEY (id_venta) REFERENCES ventas(id_venta)
);

-- ============================================================
-- INSERCIÓN DE DATOS INICIALES (SEMILLA COMPLETA)
-- ============================================================

-- 1. Restaurante
INSERT INTO restaurante_info (id_restaurante, nombre, slogan, anio_fundacion, logo_url, ruc, direccion, telefono)
VALUES (1, 'Melidan Restaurante', 'Tradición y sabor a fuego lento', 2024, 'img/logo.png', '20601234567', 'Av. La Marina 2450, San Miguel', '+51 987 654 321');

-- 2. Usuarios (Todos con contraseña: password123)
INSERT INTO usuarios (nombre, email, password_hash, rol, tipo_documento, numero_documento, nacionalidad, telefono, turno, estado, avatar, is_deleted) VALUES
('Don Roberto', 'admin@melidan.com', '$2y$12$cS6vyppok5E9eXWF0xXu6.0sUnnINo1JBho9M2BddNUIH6J8d6zGy', 'administrador', 'DNI', '45892104', 'Peruana', '+51 987654321', 'Turno Completo / Gerencia', 'Activo', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80', FALSE),
('Marco Antonio (Chef)', 'chef@melidan.com', '$2y$12$cS6vyppok5E9eXWF0xXu6.0sUnnINo1JBho9M2BddNUIH6J8d6zGy', 'cocina', 'DNI', '70124589', 'Peruana', '+51 984512365', 'Turno Mañana (7:00 AM - 3:00 PM)', 'Activo', 'https://images.unsplash.com/photo-1577219491135-ce391730fb2c?auto=format&fit=crop&w=150&q=80', FALSE),
('Carlos Paredes', 'carlos.p@melidan.com', '$2y$12$cS6vyppok5E9eXWF0xXu6.0sUnnINo1JBho9M2BddNUIH6J8d6zGy', 'mozo', 'DNI', '74589632', 'Peruana', '+51 978451236', 'Turno Mañana (8:00 AM - 4:00 PM)', 'Activo', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80', FALSE),
('María Salazar', 'maria.s@melidan.com', '$2y$12$cS6vyppok5E9eXWF0xXu6.0sUnnINo1JBho9M2BddNUIH6J8d6zGy', 'cajero', 'DNI', '76123458', 'Peruana', '+51 965412879', 'Turno Tarde (4:00 PM - 12:00 AM)', 'Activo', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80', FALSE),
('Jorge Ruiz', 'jorge.r@melidan.com', '$2y$12$cS6vyppok5E9eXWF0xXu6.0sUnnINo1JBho9M2BddNUIH6J8d6zGy', 'mozo', 'DNI', '48596123', 'Peruana', '+51 951478236', 'Turno Rotativo', 'Inactivo', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150&q=80', FALSE),
('Lucía Flores (Recepción)', 'recepcion@melidan.com', '$2y$12$cS6vyppok5E9eXWF0xXu6.0sUnnINo1JBho9M2BddNUIH6J8d6zGy', 'recepcionista', 'DNI', '72154896', 'Peruana', '+51 981234567', 'Turno Mañana (8:00 AM - 4:00 PM)', 'Activo', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=150&q=80', FALSE),
('Jean-Pierre Dubois', 'jean.dubois@melidan.com', '$2y$12$cS6vyppok5E9eXWF0xXu6.0sUnnINo1JBho9M2BddNUIH6J8d6zGy', 'mozo', 'CARNET_EXTRANJERIA', 'CE009874123', 'Francesa', '+33 612345678', 'Turno Tarde (4:00 PM - 12:00 AM)', 'Activo', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150&q=80', FALSE),
('Sarah Jenkins', 'sarah.j@gmail.com', '$2y$12$cS6vyppok5E9eXWF0xXu6.0sUnnINo1JBho9M2BddNUIH6J8d6zGy', 'cliente', 'PASAPORTE', 'PAS9845123A', 'Estadounidense', '+1 4155552671', 'Cliente', 'Activo', 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=150&q=80', FALSE),
('Diego Vargas', 'mozo@melidan.com', '$2y$12$cS6vyppok5E9eXWF0xXu6.0sUnnINo1JBho9M2BddNUIH6J8d6zGy', 'mozo', 'DNI', '71458963', 'Peruana', '+51 982341567', 'Turno Mañana (8:00 AM - 4:00 PM)', 'Activo', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150&q=80', FALSE),
('Renato Quispe', 'cajero@melidan.com', '$2y$12$cS6vyppok5E9eXWF0xXu6.0sUnnINo1JBho9M2BddNUIH6J8d6zGy', 'cajero', 'DNI', '73984512', 'Peruana', '+51 976543218', 'Turno Mañana (8:00 AM - 4:00 PM)', 'Activo', 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?auto=format&fit=crop&w=150&q=80', FALSE),
('Valeria Mendoza (Sous Chef)', 'valeria.cocina@melidan.com', '$2y$12$cS6vyppok5E9eXWF0xXu6.0sUnnINo1JBho9M2BddNUIH6J8d6zGy', 'cocina', 'DNI', '75236984', 'Peruana', '+51 964512378', 'Turno Tarde (4:00 PM - 12:00 AM)', 'Activo', 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&w=150&q=80', FALSE),
('Camila Torres', 'cliente@melidan.com', '$2y$12$cS6vyppok5E9eXWF0xXu6.0sUnnINo1JBho9M2BddNUIH6J8d6zGy', 'cliente', 'DNI', '76891234', 'Peruana', '+51 991234567', 'Cliente', 'Activo', 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80', FALSE),
('Alessandro Rossi', 'alessandro.rossi@gmail.com', '$2y$12$cS6vyppok5E9eXWF0xXu6.0sUnnINo1JBho9M2BddNUIH6J8d6zGy', 'cliente', 'PASAPORTE', 'YA8492015', 'Italiana', '+39 3471234567', 'Cliente', 'Activo', 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=150&q=80', FALSE),
('Mateo Gómez', 'mateo.gomez@gmail.com', '$2y$12$cS6vyppok5E9eXWF0xXu6.0sUnnINo1JBho9M2BddNUIH6J8d6zGy', 'cliente', 'CARNET_EXTRANJERIA', 'CE008451920', 'Colombiana', '+57 3104567890', 'Cliente', 'Activo', 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?auto=format&fit=crop&w=150&q=80', FALSE);

-- 3. Mesas (15 Mesas del Salón)
INSERT INTO mesas (numero_mesa, codigo_qr, capacidad, estado, tiempo_min, mozo_asignado, monto_acumulado) VALUES
(1, 'QR_MESA_01_MELIDAN', 4, 'libre', 0, '-', 0.00),
(2, 'QR_MESA_02_MELIDAN', 3, 'libre', 0, '-', 0.00),
(3, 'QR_MESA_03_MELIDAN', 2, 'ocupada', 18, 'Carlos Paredes', 89.00),
(4, 'QR_MESA_04_MELIDAN', 2, 'libre', 0, '-', 0.00),
(5, 'QR_MESA_05_MELIDAN', 4, 'ocupada', 6, 'Diego Vargas', 80.00),
(6, 'QR_MESA_06_MELIDAN', 6, 'por_limpiar', 0, '-', 0.00),
(7, 'QR_MESA_07_MELIDAN', 2, 'libre', 0, '-', 0.00),
(8, 'QR_MESA_08_MELIDAN', 4, 'cuenta', 42, 'Carlos Paredes', 150.00),
(9, 'QR_MESA_09_MELIDAN', 4, 'libre', 0, '-', 0.00),
(10, 'QR_MESA_10_MELIDAN', 5, 'libre', 0, '-', 0.00),
(11, 'QR_MESA_11_MELIDAN', 2, 'libre', 0, '-', 0.00),
(12, 'QR_MESA_12_MELIDAN', 2, 'ocupada', 22, 'Jean-Pierre Dubois', 102.00),
(13, 'QR_MESA_13_MELIDAN', 4, 'libre', 0, '-', 0.00),
(14, 'QR_MESA_14_MELIDAN', 6, 'libre', 0, '-', 0.00),
(15, 'QR_MESA_15_MELIDAN', 4, 'libre', 0, '-', 0.00);

-- 4. Categorías (7 Categorías Comerciales)
INSERT INTO categorias (id_categoria, nombre, descripcion) VALUES
(1, 'Platos Especiales', 'Especialidades en horno de barro, fuego lento y leña tradicional de la casa.'),
(2, 'Platos Criollos', 'Recetas clásicas de la gastronomía peruana preparadas al wok y a fuego lento.'),
(3, 'Bebidas y Jarras', 'Jarras artesanales de 1L, refrescos naturales, cócteles de autor y gaseosas.'),
(4, 'Postres', 'Postres caseros peruanos y dulces tradicionales.'),
(5, 'Entradas', 'Entradas peruanas tradicionales, causas, anticuchos y piqueos para compartir.'),
(6, 'Combos', 'Combos para 1, 2 o 4 personas con precio promocional rebajado.'),
(7, 'Menú del Día', 'Menús completos con entrada, plato de fondo y bebida que varían según el día de la semana.');

-- 5. Productos (46 Platos, Combos, Menús del Día, Jarras y Bebidas con precios psicológicos e imágenes verificadas)
INSERT INTO productos (id_producto, id_categoria, nombre, descripcion, precio, precio_regular, etiqueta_marketing, dias_disponibles, tipo_coccion, tiempo_preparacion_min, destacado_menu, disponible, imagen_url) VALUES
-- Platos Especiales (Horno / Fuego Lento)
(1, 1, 'Lechón a Fuego Lento', 'Corte jugoso marinado en especias tradicionales horneado a leña por 6 horas con camote glaseado.', 47.90, NULL, 'Firma de la Casa', 'TODOS', 'fuego_lento', 35, TRUE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/7/8/8/lechon_al_horno_11887_600.jpg'),
(2, 1, 'Costillar Glaseado a la Leña', 'Costillar tierno caramelizado con salsa BBQ artesanal, especias andinas y papas doradas.', 41.90, NULL, 'Favorito del Chef', 'TODOS', 'horno_artesanal', 25, TRUE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/3/4/8/costillas_de_cerdo_a_la_bbq_41843_600.jpg'),
(13, 1, 'Panceta Crocante al Horno de Barro', 'Panceta horneada lentamente con piel ultra crocante, camote glaseado y zarza criolla.', 45.90, NULL, 'Horno de Barro', 'TODOS', 'horno_artesanal', 30, TRUE, TRUE, 'https://decomidaperuana.com/wp-content/uploads/2018/11/chancho-a-la-china-receta.jpg'),
(14, 1, 'Osobuco Braseado 8 Horas', 'Osobuco de res cocido a fuego lento en chicha de jora y hierbas andinas sobre puré rústico.', 51.90, NULL, 'Cocción 8h', 'TODOS', 'fuego_lento', 32, FALSE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/7/1/4/osobuco_de_ternera_77417_600.jpg'),
(15, 1, 'Pato Asado a la Leña Norteña', 'Cuarto de pato tierno macerado en culantro, naranja agria y zapallo loche horneado a leña.', 48.90, NULL, NULL, 'TODOS', 'horno_artesanal', 28, FALSE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/9/7/8/pato_asado_al_horno_46879_600.jpg'),
(28, 1, 'Pachamanca a la Olla Tradicional', 'Tres carnes maceradas en chincho y huacatay con papa nativa, habas, choclo, humita y ají.', 44.90, 52.90, 'Solo Domingos', 'DOM', 'fuego_lento', 30, TRUE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/0/1/7/pachamanca_a_la_olla_75710_600.jpg'),

-- Platos Criollos (Incluyendo rotación Lun-Mié-Vie y Mar-Jue-Sáb)
(3, 2, 'Lomo Saltado Tradicional', 'Corte premium de lomo fino flameado al wok con cebolla morada, tomate y papas nativas.', 37.90, NULL, NULL, 'TODOS', 'estandar', 15, FALSE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/1/7/1/lomito_saltado_de_carne_78171_600.jpg'),
(4, 2, 'Ají de Gallina', 'Receta tradicional con crema de ají amarillo, pechuga deshilachada, nueces, papas y aceituna.', 24.90, NULL, 'Clásico Criollo', 'TODOS', 'estandar', 12, TRUE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/4/3/0/aji_de_gallina_peruano_78034_600.jpg'),
(6, 2, 'Lomo Saltado Clásico', 'Trozos de lomo jugoso flameado al wok con cebolla, tomate, ají amarillo, servido con arroz.', 27.90, NULL, 'Más Pedido', 'TODOS', 'estandar', 14, TRUE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/4/3/3/lomo_saltado_a_lo_pobre_77334_600.jpg'),
(16, 2, 'Arroz con Pato a la Chiclayana', 'Arroz graneado al culantro y cerveza negra con pierna de pato dorada y sarsa norteña.', 43.90, NULL, 'Receta Norteña', 'TODOS', 'fuego_lento', 22, TRUE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/8/2/3/arroz_con_pato_a_la_nortena_35328_600.jpg'),
(17, 2, 'Seco de Res con Frejoles', 'Asado de tira cocido lentamente en salsa de culantro y loche con frejoles canarios cremosos.', 38.90, NULL, NULL, 'TODOS', 'fuego_lento', 20, FALSE, TRUE, 'https://www.laylita.com/recetas/wp-content/uploads/2025/11/Receta-del-seco-de-carne-de-res-peruano-1024x769.jpg'),
(18, 2, 'Tallarines Verdes con Bife Angosto', 'Pasta artesanal en salsa pesto de albahaca y espinaca con bife angosto a la parrilla (250g).', 41.90, NULL, NULL, 'TODOS', 'estandar', 18, FALSE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/6/5/7/tallarines_verdes_peruanos_14756_600.jpg'),
(19, 2, 'Chaufa Amazónico al Wok', 'Arroz salteado a fuego alto con cecina ahumada, chorizo regional y plátano maduro.', 33.90, NULL, NULL, 'TODOS', 'estandar', 14, FALSE, TRUE, 'https://www.laylita.com/recetas/wp-content/uploads/2022/12/Receta-del-arroz-chaufa-peruano-1024x683.jpg'),
(29, 2, 'Carapulcra con Sopa Seca Chinchana', 'Papa seca guisada con maní y cerdo acompañada de tallarín aderezado en albahaca y achiote.', 29.90, 35.90, 'Lun · Mié · Vie', 'LUN,MIE,VIE', 'fuego_lento', 16, TRUE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/8/8/0/carapulcra_chinchana_78088_600.jpg'),
(30, 2, 'Arroz con Mariscos a la Criolla', 'Arroz meloso en salsa madre de coral, langostinos, calamar, conchas y sarza criolla fresca.', 36.90, 42.90, 'Lun · Mié · Vie', 'LUN,MIE,VIE', 'estandar', 18, TRUE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/4/9/7/arroz_con_mariscos_peruano_75794_600.jpg'),
(31, 2, 'Tacu Tacu con Lomo al Jugo', 'Crujiente tacu tacu de frejoles canarios coronado con lomo saltado jugoso y plátano frito.', 34.90, 39.90, 'Mar · Jue · Sáb', 'MAR,JUE,SAB', 'estandar', 16, TRUE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/9/5/5/tacu_tacu_con_lomo_76559_600.jpg'),
(32, 2, 'Cau Cau Criollo de Mondongo', 'Guiso tradicional limeño en crema de palillo y hierbabuena fresca con papa en cubos y arroz.', 26.90, 31.90, 'Mar · Jue · Sáb', 'MAR,JUE,SAB', 'fuego_lento', 15, FALSE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/4/1/1/cau_cau_de_mondongo_75114_600.jpg'),

-- Entradas
(8, 5, 'Causa Limeña de Cangrejo', 'Masa suave de papa amarilla al limón y ají amarillo rellena de pulpa de cangrejo y palta.', 25.90, NULL, NULL, 'TODOS', 'estandar', 10, TRUE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/5/5/1/causa_de_pulpa_de_cangrejo_77155_600.jpg'),
(9, 5, 'Anticuchos de Corazón a la Brasa', 'Brochetas tradicionales marinadas en ají panca con papas doradas, choclo y ají carretillero.', 24.90, NULL, 'A la Brasa', 'TODOS', 'estandar', 14, TRUE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/3/8/8/anticuchos_peruanos_77883_600.jpg'),
(10, 5, 'Papa a la Huancaína Artesanal', 'Rodajas de papa blanca bañadas en salsa cremosa de ají amarillo asado y queso serrano.', 17.90, NULL, NULL, 'TODOS', 'estandar', 8, FALSE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/8/1/0/papa_a_la_huancaina_peruana_11018_600.jpg'),
(11, 5, 'Tequeños de Lomo y Queso (6 und.)', 'Crujientes tequeños rellenos de lomo saltado jugoso y queso andino con guacamole casero.', 21.90, NULL, 'Para Compartir', 'TODOS', 'estandar', 10, FALSE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/6/1/6/tequenos_de_lomo_saltado_75616_600.jpg'),
(12, 5, 'Pulpo al Olivo', 'Láminas tiernas de pulpo bañadas en emulsión artesanal de aceitunas botija de Tacna.', 31.90, NULL, NULL, 'TODOS', 'estandar', 10, FALSE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/1/0/3/pulpo_al_olivo_17301_600.jpg'),
(33, 5, 'Choritos a la Chalaca (8 und.)', 'Choros frescos cubiertos con zarza chalaca de cebolla, tomate, choclo tierno y toque de limón.', 22.90, NULL, 'Entrada Fresca', 'TODOS', 'estandar', 9, FALSE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/7/8/2/choritos_a_la_chalaca_77287_600.jpg'),

-- Bebidas y Jarras (Jarras 1L, Vasos, Cócteles y Refrescos)
(5, 3, 'Jarra de Chicha Morada Artesanal (1L)', 'Bebida natural de maíz morado hervida con piña golden, manzana, clavo y canela (rinde 4 vasos).', 14.90, NULL, 'Jarra 1L', 'TODOS', 'estandar', 5, TRUE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/0/0/2/chicha_morada_75200_600.jpg'),
(7, 3, 'Limonada Frozen Clásica', 'Bebida refrescante de limón sutil licuada con hielo frapé y hojas de menta fresca.', 11.90, NULL, NULL, 'TODOS', 'estandar', 5, TRUE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/7/8/3/limonada_frozen_34387_600.jpg'),
(20, 3, 'Maracuyá Sour de la Casa', 'Cóctel bandera preparado con pisco quebranta seleccionado, zumo de maracuyá y amargo.', 21.90, NULL, 'Cóctel de Autor', 'TODOS', 'estandar', 6, FALSE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/3/6/3/maracuya_sour_77363_600.jpg'),
(21, 3, 'Jarra de Maracuyá Natural (1L)', 'Refresco natural de pulpa pura de maracuyá infusionado con hojas frescas de hierbabuena.', 15.90, NULL, 'Jarra 1L', 'TODOS', 'estandar', 5, FALSE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/2/5/1/jugo_de_parchita_77152_600.jpg'),
(25, 3, 'Maracuyá Sour sin Alcohol', 'Pulpa natural de maracuyá batida con limón fresco, jarabe artesanal y espuma suave.', 12.90, NULL, 'Sin Alcohol', 'TODOS', 'estandar', 5, TRUE, TRUE, 'https://www.perudelights.com/wp-content/uploads/2013/09/PassionFruitSour.R..jpg'),
(26, 3, 'Emoliente Frutal Helado', 'Infusión tradicional de cebada, linaza y hierbas andinas servida bien fría con piña y limón.', 10.90, NULL, NULL, 'TODOS', 'estandar', 4, FALSE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/7/1/8/emoliente_peruano_76817_600.jpg'),
(34, 3, 'Jarra de Limonada de Hierbabuena (1L)', 'Limonada fresca batida con hierbabuena del huerto y hielo frapé ideal para compartir en mesa.', 16.90, 19.90, 'Jarra 1L · Promo', 'TODOS', 'estandar', 5, TRUE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/5/2/6/granizado_de_lima_y_menta_con_thermomix_30625_600.jpg'),
(35, 3, 'Jarra de Sangría Criolla (1L)', 'Vino tinto seleccionado macerado con naranja, manzana, canela y toque de pisco acholado.', 34.90, 42.90, 'Jarra 1L · Finde', 'VIE,SAB,DOM', 'estandar', 6, FALSE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/1/6/7/sangria_tradicional_41761_600.jpg'),
(36, 3, 'Vaso de Chicha Morada (450ml)', 'Porción individual bien helada de nuestra chicha morada casera con toque de limón sutil.', 6.50, NULL, 'Personal', 'TODOS', 'estandar', 3, FALSE, TRUE, 'https://comedera.com/wp-content/uploads/sites/9/2026/03/chicha-morada.webp?w=768'),
(37, 3, 'Pisco Sour Clásico Peruano', 'Pisco quebranta puro, zumo de limón fresco, jarabe de goma, clara y gotas de amargo.', 22.90, NULL, 'Clásico Barra', 'TODOS', 'estandar', 6, FALSE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/9/8/2/pisco_sour_peruano_casero_16289_600.jpg'),
(38, 3, 'Chilcano de Maracuyá o Limón', 'Refrescante chilcano con pisco quebranta, ginger ale bien frío, limón y pulpa de estación.', 18.90, 22.90, 'Happy Hour', 'TODOS', 'estandar', 5, FALSE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/2/8/6/chilcano_de_maracuya_77682_600.jpg'),
(39, 3, 'Inca Kola / Gaseosa Personal (500ml)', 'Botella personal helada (Inca Kola, Coca-Cola o agua mineral con/sin gas).', 5.90, NULL, NULL, 'TODOS', 'estandar', 2, FALSE, TRUE, 'https://www.papajohns.com.pe/media/catalog/product/1/4/14938.png?optimize=medium&bg-color=255,255,255&fit=bounds&height=700&width=700&canvas=700:700&format=jpeg'),

-- Postres
(22, 4, 'Suspiro a la Limeña Clásico', 'Manjar de yemas sedoso coronado con merengue italiano al oporto y canela en polvo.', 15.90, NULL, NULL, 'TODOS', 'estandar', 6, TRUE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/2/6/2/suspiro_limeno_78262_600.jpg'),
(23, 4, 'Picarones con Miel de Chancaca', 'Aros crocantes de zapallo macre y camote bañados en miel aromática de higo y naranja.', 14.90, NULL, 'Hecho al Momento', 'TODOS', 'estandar', 8, FALSE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/1/5/4/picarones_con_chancaca_77451_600.jpg'),
(24, 4, 'Tres Leches de Lúcuma', 'Bizcocho esponjoso embebido en tres leches y pulpa de lúcuma de seda con cacao peruano.', 17.90, NULL, NULL, 'TODOS', 'estandar', 6, FALSE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/9/5/2/torta_tres_leches_de_lucuma_45259_600.jpg'),
(27, 4, 'Combinado Clásico Limeño', 'Dúo tradicional de mazamorra morada con frutas secas y arroz con leche a la canela.', 13.90, NULL, NULL, 'TODOS', 'fuego_lento', 6, TRUE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/9/8/4/mazamorra_con_arroz_con_leche_76489_600.jpg'),

-- Combos Promocionales (Precio Rebajado vs Regular)
(40, 6, 'Combo Criollo Para 2', '1 Lomo Saltado Clásico + 1 Ají de Gallina + 1 Jarra de Chicha Morada (1L). Ideal para compartir.', 54.90, 67.70, 'Ahorra S/ 12.80', 'TODOS', 'estandar', 18, TRUE, TRUE, 'https://comedera.com/wp-content/uploads/sites/9/2023/05/Lomo-en-su-jugo-peruano-shutterstock_1993679156.jpg'),
(41, 6, 'Combo Horno & Brasa Familiar (4 pers.)', '1 Lechón a Fuego Lento + 1 Costillar Glaseado + 1 Anticuchos + 2 Jarras 1L a elección.', 119.90, 145.50, 'Ahorra S/ 25.60', 'TODOS', 'horno_artesanal', 30, TRUE, TRUE, 'https://decomidaperuana.com/wp-content/uploads/2020/05/parrilla.jpg'),
(42, 6, 'Combo Almuerzo Express Wok', '1 Chaufa Amazónico al Wok + 3 Tequeños de Lomo y Queso + 1 Limonada Frozen.', 39.90, 49.90, 'Ahorra S/ 10.00', 'TODOS', 'estandar', 15, FALSE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/1/8/6/aeropuerto_chifa_76681_600.jpg'),
(43, 6, 'Combo Dúo Barra & Piqueo', '1 Tequeños de Lomo y Queso (6 und.) + 2 Chilcanos de Maracuyá o Limón bien helados.', 46.90, 59.70, 'Ahorra S/ 12.80', 'VIE,SAB,DOM', 'estandar', 12, FALSE, TRUE, 'https://www.perudelights.com/wp-content/uploads/2016/09/P1015338.jpg'),

-- Menú del Día (Diferenciado por días de la semana: Lun-Mié-Vie / Mar-Jue-Sáb / Domingo)
(44, 7, 'Menú del Día (Lun · Mié · Vie)', 'Entrada: Papa a la Huancaína + Fondo: Carapulcra con Sopa Seca (o Lomo Clásico) + Vaso de Chicha.', 21.90, 28.90, 'Lun · Mié · Vie', 'LUN,MIE,VIE', 'fuego_lento', 14, TRUE, TRUE, 'https://decomidaperuana.com/wp-content/uploads/2019/04/receta-de-sopa-seca.jpg'),
(45, 7, 'Menú del Día (Mar · Jue · Sáb)', 'Entrada: Causa Limeña + Fondo: Ají de Gallina (o Tacu Tacu al Jugo) + Vaso de Limonada.', 22.90, 29.90, 'Mar · Jue · Sáb', 'MAR,JUE,SAB', 'estandar', 14, TRUE, TRUE, 'https://cdn0.recetasgratis.net/es/posts/3/8/7/aji_de_pollo_16783_600.jpg'),
(46, 7, 'Menú Especial de Domingo', 'Entrada: Anticuchos a la Brasa + Fondo: Pachamanca a la Olla + Chicha Morada + Combinado Limeño.', 32.90, 42.90, 'Solo Domingos', 'DOM', 'fuego_lento', 22, TRUE, TRUE, 'https://decomidaperuana.com/wp-content/uploads/2019/09/pachamanca-a-la-olla.jpg');

-- 5B. Promociones de Carta (Marketing dinámico por días y categorías)
INSERT INTO promociones_carta (codigo, titulo, subtitulo, badge_texto, dias_aplicables, categoria_destino, id_producto_destacado, color_acento, activa) VALUES
('COMBO_CRIOLLO_2', 'Combo Criollo Para 2', 'Lomo + Ají de Gallina + Jarra 1L a solo S/ 54.90', 'AHORRA S/ 12.80', 'TODOS', 'Combos', 40, '#FF5722', TRUE),
('MENU_LMV', 'Menú Lun · Mié · Vie', 'Huancaína + Carapulcra con Sopa Seca + Chicha a S/ 21.90', 'LUN · MIÉ · VIE', 'LUN,MIE,VIE', 'Menú del Día', 44, '#009B77', TRUE),
('MENU_MJS', 'Menú Mar · Jue · Sáb', 'Causa + Ají de Gallina o Tacu Tacu + Limonada a S/ 22.90', 'MAR · JUE · SÁB', 'MAR,JUE,SAB', 'Menú del Día', 45, '#0284C7', TRUE),
('MENU_DOM', 'Domingo de Pachamanca', 'Menú Especial Dominical completo desde S/ 32.90', 'SOLO DOMINGOS', 'DOM', 'Menú del Día', 46, '#D97706', TRUE),
('JARRAS_PROMO', 'Jarras 1L y Happy Hour', 'Jarras artesanales desde S/ 14.90 y Chilcanos a S/ 18.90', 'DESDE S/ 14.90', 'TODOS', 'Bebidas y Jarras', 34, '#7C3AED', TRUE);

-- 6. Pedidos Históricos y Activos
INSERT INTO pedidos (id_pedido, numero_comanda, id_mesa, id_usuario, nombre_cliente, estado, fecha_hora) VALUES
(1, 1024, 2, 3, 'Sr. Méndez', 'entregado', CURRENT_TIMESTAMP - INTERVAL '6 days'),
(2, 1025, 4, 4, 'Cliente Mesa 04', 'entregado', CURRENT_TIMESTAMP - INTERVAL '5 days'),
(3, 1026, 1, 3, 'Familia Quispe', 'entregado', CURRENT_TIMESTAMP - INTERVAL '4 days 3 hours'),
(4, 1027, 6, 7, 'Inversiones Pacífico SAC', 'entregado', CURRENT_TIMESTAMP - INTERVAL '3 days 5 hours'),
(5, 1028, 9, 9, 'Sarah Jenkins', 'entregado', CURRENT_TIMESTAMP - INTERVAL '2 days 6 hours'),
(6, 1029, 10, 3, 'Estudio Contable Romero EIRL', 'entregado', CURRENT_TIMESTAMP - INTERVAL '2 days 1 hour'),
(7, 1030, 2, 7, 'Mateo Gómez', 'entregado', CURRENT_TIMESTAMP - INTERVAL '1 day 7 hours'),
(8, 1031, 7, 9, 'Lucía Fernández', 'entregado', CURRENT_TIMESTAMP - INTERVAL '1 day 2 hours'),
(9, 1032, 14, 3, 'Grupo Gastronómico San Miguel SAC', 'entregado', CURRENT_TIMESTAMP - INTERVAL '5 hours'),
(10, 1033, 11, 9, 'Alessandro Rossi', 'entregado', CURRENT_TIMESTAMP - INTERVAL '3 hours 20 minutes'),
(11, 1034, 13, 7, 'Familia Villanueva', 'entregado', CURRENT_TIMESTAMP - INTERVAL '1 hour 45 minutes'),
(12, 1035, 15, 3, 'Camila Torres', 'entregado', CURRENT_TIMESTAMP - INTERVAL '40 minutes'),
(13, 1036, 3, 3, 'Familia Salvatierra', 'en_cocina', CURRENT_TIMESTAMP - INTERVAL '14 minutes'),
(14, 1037, 5, 9, 'Srta. Valeria Paz', 'pendiente', CURRENT_TIMESTAMP - INTERVAL '5 minutes'),
(15, 1038, 8, 3, 'Corporación Andina SAC', 'entregado', CURRENT_TIMESTAMP - INTERVAL '38 minutes'),
(16, 1039, 12, 7, 'Alessandro Rossi', 'listo', CURRENT_TIMESTAMP - INTERVAL '19 minutes');

-- 7. Detalle de Pedidos
INSERT INTO detalle_pedidos (id_pedido, id_producto, cantidad, precio_unitario, observaciones) VALUES
(1, 1, 1, 48.00, 'Término medio, salsa aparte'),
(2, 3, 1, 38.00, 'Papas bien doradas'),
(2, 5, 1, 14.00, 'Bien fría'),
(3, 1, 1, 48.00, 'Bien cocido'),
(3, 6, 1, 28.00, ''),
(3, 5, 1, 14.00, 'Sin hielo'),
(4, 13, 2, 46.00, 'Extra zarza'),
(4, 16, 1, 44.00, ''),
(4, 20, 2, 22.00, ''),
(4, 22, 2, 16.00, ''),
(5, 8, 1, 26.00, 'Poco picante'),
(5, 6, 1, 28.00, ''),
(5, 7, 1, 12.00, ''),
(6, 14, 2, 52.00, ''),
(6, 12, 1, 32.00, ''),
(6, 21, 1, 15.00, ''),
(6, 24, 2, 18.00, ''),
(7, 9, 1, 25.00, 'Con rocoto aparte'),
(7, 17, 1, 39.00, ''),
(7, 7, 2, 12.00, ''),
(8, 4, 2, 24.00, ''),
(8, 11, 1, 22.00, ''),
(8, 23, 1, 15.00, 'Miel caliente'),
(9, 1, 2, 48.00, ''),
(9, 2, 1, 42.00, ''),
(9, 8, 2, 26.00, ''),
(9, 5, 2, 14.00, ''),
(10, 18, 1, 42.00, 'Término tres cuartos'),
(10, 10, 1, 18.00, ''),
(10, 20, 1, 22.00, ''),
(11, 15, 1, 49.00, ''),
(11, 19, 1, 34.00, ''),
(11, 21, 1, 15.00, ''),
(11, 22, 1, 16.00, ''),
(12, 6, 1, 28.00, 'Jugoso'),
(12, 4, 1, 24.00, ''),
(12, 7, 2, 12.00, ''),
(13, 1, 1, 48.00, 'Con extra zarza criolla'),
(13, 8, 1, 26.00, ''),
(13, 21, 1, 15.00, 'Helada'),
(14, 6, 2, 28.00, 'Término medio'),
(14, 7, 2, 12.00, 'Con menta fresca'),
(15, 13, 1, 46.00, ''),
(15, 16, 1, 44.00, ''),
(15, 20, 2, 22.00, ''),
(15, 22, 1, 16.00, ''),
(16, 14, 1, 52.00, 'Salsa aparte'),
(16, 12, 1, 32.00, ''),
(16, 24, 1, 18.00, '');

-- 8. Historial de Ventas Pagadas
INSERT INTO ventas (id_venta, id_pedido, metodo_pago, monto_total, estado_pago, fecha_pago) VALUES
(1, 2, 'tarjeta_caja', 52.00, 'exitoso', CURRENT_TIMESTAMP - INTERVAL '5 days'),
(2, 1, 'efectivo_caja', 48.00, 'exitoso', CURRENT_TIMESTAMP - INTERVAL '6 days'),
(3, 3, 'tarjeta_caja', 90.00, 'exitoso', CURRENT_TIMESTAMP - INTERVAL '4 days 3 hours'),
(4, 4, 'tarjeta_caja', 212.00, 'exitoso', CURRENT_TIMESTAMP - INTERVAL '3 days 5 hours'),
(5, 5, 'aplicacion', 66.00, 'exitoso', CURRENT_TIMESTAMP - INTERVAL '2 days 6 hours'),
(6, 6, 'tarjeta_caja', 187.00, 'exitoso', CURRENT_TIMESTAMP - INTERVAL '2 days 1 hour'),
(7, 7, 'efectivo_caja', 88.00, 'exitoso', CURRENT_TIMESTAMP - INTERVAL '1 day 7 hours'),
(8, 8, 'aplicacion', 85.00, 'exitoso', CURRENT_TIMESTAMP - INTERVAL '1 day 2 hours'),
(9, 9, 'tarjeta_caja', 218.00, 'exitoso', CURRENT_TIMESTAMP - INTERVAL '5 hours'),
(10, 10, 'tarjeta_caja', 82.00, 'exitoso', CURRENT_TIMESTAMP - INTERVAL '3 hours 20 minutes'),
(11, 11, 'efectivo_caja', 114.00, 'exitoso', CURRENT_TIMESTAMP - INTERVAL '1 hour 45 minutes'),
(12, 12, 'aplicacion', 76.00, 'exitoso', CURRENT_TIMESTAMP - INTERVAL '40 minutes');

-- 9. Comprobantes Electrónicos Emitidos
INSERT INTO comprobantes (id_comprobante, id_venta, tipo_comprobante, numero_comprobante, fecha_emision) VALUES
(1, 1, 'boleta', 'B001-00001025', CURRENT_TIMESTAMP - INTERVAL '5 days'),
(2, 2, 'boleta', 'B001-00001024', CURRENT_TIMESTAMP - INTERVAL '6 days'),
(3, 3, 'boleta', 'B001-00001026', CURRENT_TIMESTAMP - INTERVAL '4 days 3 hours'),
(4, 4, 'factura', 'F001-00001027', CURRENT_TIMESTAMP - INTERVAL '3 days 5 hours'),
(5, 5, 'boleta', 'B001-00001028', CURRENT_TIMESTAMP - INTERVAL '2 days 6 hours'),
(6, 6, 'factura', 'F001-00001029', CURRENT_TIMESTAMP - INTERVAL '2 days 1 hour'),
(7, 7, 'boleta', 'B001-00001030', CURRENT_TIMESTAMP - INTERVAL '1 day 7 hours'),
(8, 8, 'boleta', 'B001-00001031', CURRENT_TIMESTAMP - INTERVAL '1 day 2 hours'),
(9, 9, 'factura', 'F001-00001032', CURRENT_TIMESTAMP - INTERVAL '5 hours'),
(10, 10, 'boleta', 'B001-00001033', CURRENT_TIMESTAMP - INTERVAL '3 hours 20 minutes'),
(11, 11, 'boleta', 'B001-00001034', CURRENT_TIMESTAMP - INTERVAL '1 hour 45 minutes'),
(12, 12, 'boleta', 'B001-00001035', CURRENT_TIMESTAMP - INTERVAL '40 minutes');

-- 10. Sincronización de secuencias SERIAL
SELECT setval(pg_get_serial_sequence('categorias', 'id_categoria'), (SELECT COALESCE(MAX(id_categoria), 1) FROM categorias));
SELECT setval(pg_get_serial_sequence('productos', 'id_producto'), (SELECT COALESCE(MAX(id_producto), 1) FROM productos));
SELECT setval(pg_get_serial_sequence('promociones_carta', 'id_promo'), (SELECT COALESCE(MAX(id_promo), 1) FROM promociones_carta));
SELECT setval(pg_get_serial_sequence('usuarios', 'id_usuario'), (SELECT COALESCE(MAX(id_usuario), 1) FROM usuarios));
SELECT setval(pg_get_serial_sequence('mesas', 'id_mesa'), (SELECT COALESCE(MAX(id_mesa), 1) FROM mesas));
SELECT setval(pg_get_serial_sequence('pedidos', 'id_pedido'), (SELECT COALESCE(MAX(id_pedido), 1) FROM pedidos));
SELECT setval(pg_get_serial_sequence('detalle_pedidos', 'id_detalle'), (SELECT COALESCE(MAX(id_detalle), 1) FROM detalle_pedidos));
SELECT setval(pg_get_serial_sequence('ventas', 'id_venta'), (SELECT COALESCE(MAX(id_venta), 1) FROM ventas));
SELECT setval(pg_get_serial_sequence('comprobantes', 'id_comprobante'), (SELECT COALESCE(MAX(id_comprobante), 1) FROM comprobantes));
