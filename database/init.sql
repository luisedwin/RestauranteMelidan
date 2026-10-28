-- ============================================================
-- BASE DE DATOS: Restaurante Melidan
-- Motor: PostgreSQL 18
-- Modelo Normalizado (1FN, 2FN, 3FN) y Buenas Prácticas
-- ============================================================

-- 1. Limpieza de tablas existentes (en cascada)
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
    tipo_coccion tipo_coccion_enum DEFAULT 'estandar',
    tiempo_preparacion_min INT DEFAULT 15 CHECK (tiempo_preparacion_min >= 0),
    destacado_menu BOOLEAN DEFAULT FALSE,
    disponible BOOLEAN DEFAULT TRUE,
    imagen_url VARCHAR(255),
    CONSTRAINT fk_productos_categoria
        FOREIGN KEY (id_categoria) REFERENCES categorias(id_categoria) ON DELETE CASCADE
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

-- 4. Categorías
INSERT INTO categorias (id_categoria, nombre, descripcion) VALUES
(1, 'Especialidades al Horno', 'Platos preparados en horno de barro a fuego lento y leña tradicional.'),
(2, 'Platos de Fondo', 'Nuestras mejores recetas criollas preparadas al wok y a fuego lento.'),
(3, 'Bebidas', 'Refrescos artesanales naturales, cócteles de autor y bebidas frías.'),
(4, 'Postres', 'Postres caseros peruanos y dulces tradicionales.'),
(5, 'Entradas', 'Entradas peruanas tradicionales, causas, anticuchos y piqueos para compartir.');

-- 5. Productos (24 Platos y Bebidas)
INSERT INTO productos (id_producto, id_categoria, nombre, descripcion, precio, tipo_coccion, tiempo_preparacion_min, destacado_menu, disponible, imagen_url) VALUES
(1, 1, 'Lechón a Fuego Lento', 'Corte jugoso marinado en especias tradicionales horneado a leña por 6 horas.', 48.00, 'fuego_lento', 35, TRUE, TRUE, 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=400&q=80'),
(2, 1, 'Costillar Glaseado a la Leña', 'Costillar tierno caramelizado con salsa BBQ artesanal y especias andinas.', 42.00, 'horno_artesanal', 25, TRUE, TRUE, 'https://images.unsplash.com/photo-1529193591184-b1d58069ecdd?auto=format&fit=crop&w=400&q=80'),
(3, 2, 'Lomo Saltado Tradicional', 'Corte premium de lomo fino flameado al wok con cebolla morada, tomate y papas nativas.', 38.00, 'estandar', 15, FALSE, TRUE, 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?auto=format&fit=crop&w=400&q=80'),
(4, 2, 'Ají de Gallina', 'Receta tradicional con crema de ají amarillo, pechuga deshilachada, nueces, papas y aceituna.', 24.00, 'estandar', 12, TRUE, TRUE, 'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=400&q=80'),
(5, 3, 'Chicha Morada Artesanal (1L)', 'Bebida natural de maíz morado hervida con piña golden, manzana, clavo y canela.', 14.00, 'estandar', 5, FALSE, TRUE, 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=400&q=80'),
(6, 2, 'Lomo Saltado Clásico', 'Trozos de lomo jugoso flameado al wok con cebolla, tomate, ají amarillo, servido con arroz.', 28.00, 'estandar', 14, TRUE, TRUE, 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=400&q=80'),
(7, 3, 'Limonada Frozen', 'Bebida refrescante de limón sutil licuada con hielo frapé y hojas de menta fresca.', 12.00, 'estandar', 5, TRUE, TRUE, 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=400&q=80'),
(8, 5, 'Causa Limeña de Cangrejo', 'Masa suave de papa amarilla al limón y ají amarillo rellena de pulpa de cangrejo y palta.', 26.00, 'estandar', 10, TRUE, TRUE, 'https://images.unsplash.com/photo-1540189549336-e6e99c3679fe?auto=format&fit=crop&w=400&q=80'),
(9, 5, 'Anticuchos de Corazón a la Brasa', 'Brochetas tradicionales marinadas en ají panca con papas doradas, choclo y ají carretillero.', 25.00, 'estandar', 14, TRUE, TRUE, 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=400&q=80'),
(10, 5, 'Papa a la Huancaína Artesanal', 'Rodajas de papa blanca bañadas en salsa cremosa de ají amarillo asado y queso serrano.', 18.00, 'estandar', 8, FALSE, TRUE, 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?auto=format&fit=crop&w=400&q=80'),
(11, 5, 'Tequeños de Lomo y Queso (6 und.)', 'Crujientes tequeños rellenos de lomo saltado jugoso y queso andino con guacamole casero.', 22.00, 'estandar', 10, FALSE, TRUE, 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=400&q=80'),
(12, 5, 'Pulpo al Olivo', 'Láminas tiernas de pulpo bañadas en emulsión artesanal de aceitunas botija de Tacna.', 32.00, 'estandar', 10, FALSE, TRUE, 'https://images.unsplash.com/photo-1559847844-5315695dadae?auto=format&fit=crop&w=400&q=80'),
(13, 1, 'Panceta Crocante al Horno de Barro', 'Panceta horneada lentamente con piel ultra crocante, camote glaseado y zarza criolla.', 46.00, 'horno_artesanal', 30, TRUE, TRUE, 'https://images.unsplash.com/photo-1600891964092-4316c288032e?auto=format&fit=crop&w=400&q=80'),
(14, 1, 'Osobuco Braseado 8 Horas', 'Osobuco de res cocido a fuego lento en chicha de jora y hierbas andinas sobre puré rústico.', 52.00, 'fuego_lento', 32, FALSE, TRUE, 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=400&q=80'),
(15, 1, 'Pato Asado a la Leña Norteña', 'Cuarto de pato tierno macerado en culantro, naranja agria y zapallo loche horneado a leña.', 49.00, 'horno_artesanal', 28, FALSE, TRUE, 'https://images.unsplash.com/photo-1518492104633-130d0cc84637?auto=format&fit=crop&w=400&q=80'),
(16, 2, 'Arroz con Pato a la Chiclayana', 'Arroz graneado al culantro y cerveza negra con pierna de pato dorada y sarsa norteña.', 44.00, 'fuego_lento', 22, TRUE, TRUE, 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=400&q=80'),
(17, 2, 'Seco de Res con Frejoles', 'Asado de tira cocido lentamente en salsa de culantro y loche con frejoles canarios cremosos.', 39.00, 'fuego_lento', 20, FALSE, TRUE, 'https://images.unsplash.com/photo-1547592180-85f173990554?auto=format&fit=crop&w=400&q=80'),
(18, 2, 'Tallarines Verdes con Bife Angosto', 'Pasta artesanal en salsa pesto de albahaca y espinaca con bife angosto a la parrilla (250g).', 42.00, 'estandar', 18, FALSE, TRUE, 'https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=400&q=80'),
(19, 2, 'Chaufa Amazónico al Wok', 'Arroz salteado a fuego alto con cecina ahumada, chorizo regional y plátano maduro.', 34.00, 'estandar', 14, FALSE, TRUE, 'https://images.unsplash.com/photo-1603133872878-684f208fb84b?auto=format&fit=crop&w=400&q=80'),
(20, 3, 'Maracuyá Sour de la Casa', 'Cóctel bandera preparado con pisco quebranta seleccionado, zumo de maracuyá y amargo.', 22.00, 'estandar', 6, FALSE, TRUE, 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=400&q=80'),
(21, 3, 'Jarra de Maracuyá Natural (1L)', 'Refresco natural de pulpa pura de maracuyá infusionado con hojas frescas de hierbabuena.', 15.00, 'estandar', 5, FALSE, TRUE, 'https://images.unsplash.com/photo-1546173159-315724a31696?auto=format&fit=crop&w=400&q=80'),
(22, 4, 'Suspiro a la Limeña Clásico', 'Manjar de yemas sedoso coronado con merengue italiano al oporto y canela en polvo.', 16.00, 'estandar', 6, TRUE, TRUE, 'https://images.unsplash.com/photo-1551024601-bec78aea704b?auto=format&fit=crop&w=400&q=80'),
(23, 4, 'Picarones con Miel de Chancaca', 'Aros crocantes de zapallo macre y camote bañados en miel aromática de higo y naranja.', 15.00, 'estandar', 8, FALSE, TRUE, 'https://images.unsplash.com/photo-1563805042-7684c019e1cb?auto=format&fit=crop&w=400&q=80'),
(24, 4, 'Tres Leches de Lúcuma', 'Bizcocho esponjoso embebido en tres leches y pulpa de lúcuma de seda con cacao peruano.', 18.00, 'estandar', 6, FALSE, TRUE, 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?auto=format&fit=crop&w=400&q=80');

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
SELECT setval(pg_get_serial_sequence('usuarios', 'id_usuario'), (SELECT COALESCE(MAX(id_usuario), 1) FROM usuarios));
SELECT setval(pg_get_serial_sequence('mesas', 'id_mesa'), (SELECT COALESCE(MAX(id_mesa), 1) FROM mesas));
SELECT setval(pg_get_serial_sequence('pedidos', 'id_pedido'), (SELECT COALESCE(MAX(id_pedido), 1) FROM pedidos));
SELECT setval(pg_get_serial_sequence('detalle_pedidos', 'id_detalle'), (SELECT COALESCE(MAX(id_detalle), 1) FROM detalle_pedidos));
SELECT setval(pg_get_serial_sequence('ventas', 'id_venta'), (SELECT COALESCE(MAX(id_venta), 1) FROM ventas));
SELECT setval(pg_get_serial_sequence('comprobantes', 'id_comprobante'), (SELECT COALESCE(MAX(id_comprobante), 1) FROM comprobantes));
