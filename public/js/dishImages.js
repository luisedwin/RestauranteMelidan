/**
 * dishImages.js - Diccionario JavaScript centralizado de imágenes de la Carta (Melidan)
 * Sincronizado con /data/carta-imagenes.json (46 productos verificados HTTP 200).
 *
 * Características:
 * - Resolución inmediata por ID o por nombre normalizado sin bloquear el primer render.
 * - Doble capa de tolerancia a fallos: URL principal -> URL de respaldo -> tarjeta SVG inline
 *   para evitar por completo íconos de imagen rota incluso en redes restringidas u offline.
 * - Protección automática contra dominios de stock bloqueados (ej. images.unsplash.com).
 * - Sincronización opcional en segundo plano desde /data/carta-imagenes.json si se edita el JSON.
 */

(function (globalScope) {
  'use strict';

  const DISH_ENTRIES = [
    {
      id: 1,
      nombre: 'Lechón a Fuego Lento',
      categoria: 'Platos Especiales',
      url: 'https://cdn0.recetasgratis.net/es/posts/7/8/8/lechon_al_horno_11887_600.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/7/2/3/lechonchito_al_horno_8327_600.jpg'
    },
    {
      id: 2,
      nombre: 'Costillar Glaseado a la Leña',
      categoria: 'Platos Especiales',
      url: 'https://cdn0.recetasgratis.net/es/posts/3/4/8/costillas_de_cerdo_a_la_bbq_41843_600.jpg',
      backupUrl: 'https://comedera.com/wp-content/uploads/sites/9/2026/09/recetas-de-costillas-de-cerdo.webp?w=1200'
    },
    {
      id: 3,
      nombre: 'Lomo Saltado Tradicional',
      categoria: 'Platos Criollos',
      url: 'https://cdn0.recetasgratis.net/es/posts/1/7/1/lomito_saltado_de_carne_78171_600.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/4/3/3/lomo_saltado_a_lo_pobre_77334_600.jpg'
    },
    {
      id: 4,
      nombre: 'Ají de Gallina',
      categoria: 'Platos Criollos',
      url: 'https://cdn0.recetasgratis.net/es/posts/4/3/0/aji_de_gallina_peruano_78034_600.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/3/8/7/aji_de_pollo_16783_600.jpg'
    },
    {
      id: 5,
      nombre: 'Jarra de Chicha Morada Artesanal (1L)',
      categoria: 'Bebidas y Jarras',
      url: 'https://cdn0.recetasgratis.net/es/posts/0/0/2/chicha_morada_75200_600.jpg',
      backupUrl: 'https://www.eatperu.com/wp-content/uploads/2020/07/peruvian-chicha-morada-with-corn-and-lime-683x1024.jpg'
    },
    {
      id: 6,
      nombre: 'Lomo Saltado Clásico',
      categoria: 'Platos Criollos',
      url: 'https://cdn0.recetasgratis.net/es/posts/4/3/3/lomo_saltado_a_lo_pobre_77334_600.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/1/7/1/lomito_saltado_de_carne_78171_600.jpg'
    },
    {
      id: 7,
      nombre: 'Limonada Frozen Clásica',
      categoria: 'Bebidas y Jarras',
      url: 'https://cdn0.recetasgratis.net/es/posts/7/8/3/limonada_frozen_34387_600.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/2/3/2/limonada_con_miel_61232_600.jpg'
    },
    {
      id: 8,
      nombre: 'Causa Limeña de Cangrejo',
      categoria: 'Entradas',
      url: 'https://cdn0.recetasgratis.net/es/posts/5/5/1/causa_de_pulpa_de_cangrejo_77155_600.jpg',
      backupUrl: 'https://www.laylita.com/recetas/wp-content/uploads/2025/02/Causa-de-camaron-receta-facil-1024x768.jpg'
    },
    {
      id: 9,
      nombre: 'Anticuchos de Corazón a la Brasa',
      categoria: 'Entradas',
      url: 'https://cdn0.recetasgratis.net/es/posts/3/8/8/anticuchos_peruanos_77883_600.jpg',
      backupUrl: 'https://www.eatperu.com/wp-content/uploads/2022/01/peruvian-beed-heart-kebab-recipe-1200x1800.jpg'
    },
    {
      id: 10,
      nombre: 'Papa a la Huancaína Artesanal',
      categoria: 'Entradas',
      url: 'https://cdn0.recetasgratis.net/es/posts/8/1/0/papa_a_la_huancaina_peruana_11018_600.jpg',
      backupUrl: 'https://www.perudelights.com/wp-content/uploads/2018/05/ulpGK1W2-720.jpg'
    },
    {
      id: 11,
      nombre: 'Tequeños de Lomo y Queso (6 und.)',
      categoria: 'Entradas',
      url: 'https://cdn0.recetasgratis.net/es/posts/6/1/6/tequenos_de_lomo_saltado_75616_600.jpg',
      backupUrl: 'https://www.perudelights.com/wp-content/uploads/2016/09/P1015338.jpg'
    },
    {
      id: 12,
      nombre: 'Pulpo al Olivo',
      categoria: 'Entradas',
      url: 'https://cdn0.recetasgratis.net/es/posts/1/0/3/pulpo_al_olivo_17301_600.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/8/2/8/pulpo_al_olivo_gourmet_14828_600.jpg'
    },
    {
      id: 13,
      nombre: 'Panceta Crocante al Horno de Barro',
      categoria: 'Platos Especiales',
      url: 'https://decomidaperuana.com/wp-content/uploads/2018/11/chancho-a-la-china-receta.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/8/5/2/panceta_en_freidora_de_aire_77258_600.jpg'
    },
    {
      id: 14,
      nombre: 'Osobuco Braseado 8 Horas',
      categoria: 'Platos Especiales',
      url: 'https://cdn0.recetasgratis.net/es/posts/7/1/4/osobuco_de_ternera_77417_600.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/1/6/7/estofado_de_osobuco_76761_600.jpg'
    },
    {
      id: 15,
      nombre: 'Pato Asado a la Leña Norteña',
      categoria: 'Platos Especiales',
      url: 'https://cdn0.recetasgratis.net/es/posts/9/7/8/pato_asado_al_horno_46879_600.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/8/5/3/magret_de_pato_al_horno_53358_600.jpg'
    },
    {
      id: 16,
      nombre: 'Arroz con Pato a la Chiclayana',
      categoria: 'Platos Criollos',
      url: 'https://cdn0.recetasgratis.net/es/posts/8/2/3/arroz_con_pato_a_la_nortena_35328_600.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/9/7/8/pato_asado_al_horno_46879_600.jpg'
    },
    {
      id: 17,
      nombre: 'Seco de Res con Frejoles',
      categoria: 'Platos Criollos',
      url: 'https://www.laylita.com/recetas/wp-content/uploads/2025/11/Receta-del-seco-de-carne-de-res-peruano-1024x769.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/3/4/9/frejoles_con_seco_de_pollo_77943_600.jpg'
    },
    {
      id: 18,
      nombre: 'Tallarines Verdes con Bife Angosto',
      categoria: 'Platos Criollos',
      url: 'https://cdn0.recetasgratis.net/es/posts/6/5/7/tallarines_verdes_peruanos_14756_600.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/0/1/3/tallarines_verdes_32310_600.jpg'
    },
    {
      id: 19,
      nombre: 'Chaufa Amazónico al Wok',
      categoria: 'Platos Criollos',
      url: 'https://www.laylita.com/recetas/wp-content/uploads/2022/12/Receta-del-arroz-chaufa-peruano-1024x683.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/5/1/3/chaufa_de_chancho_78315_600.jpg'
    },
    {
      id: 20,
      nombre: 'Maracuyá Sour de la Casa',
      categoria: 'Bebidas y Jarras',
      url: 'https://cdn0.recetasgratis.net/es/posts/3/6/3/maracuya_sour_77363_600.jpg',
      backupUrl: 'https://www.eatperu.com/wp-content/uploads/2021/01/maracuya-sour-recipe-683x1024.jpg'
    },
    {
      id: 21,
      nombre: 'Jarra de Maracuyá Natural (1L)',
      categoria: 'Bebidas y Jarras',
      url: 'https://cdn0.recetasgratis.net/es/posts/2/5/1/jugo_de_parchita_77152_600.jpg',
      backupUrl: 'https://www.laylita.com/recetas/wp-content/uploads/2022/07/Receta-del-mojito-de-maracuya-chinola-parchita-1024x768.jpg'
    },
    {
      id: 22,
      nombre: 'Suspiro a la Limeña Clásico',
      categoria: 'Postres',
      url: 'https://cdn0.recetasgratis.net/es/posts/2/6/2/suspiro_limeno_78262_600.jpg',
      backupUrl: 'https://comedera.com/wp-content/uploads/sites/9/2022/11/suspiro-limeno.jpeg?w=768'
    },
    {
      id: 23,
      nombre: 'Picarones con Miel de Chancaca',
      categoria: 'Postres',
      url: 'https://cdn0.recetasgratis.net/es/posts/1/5/4/picarones_con_chancaca_77451_600.jpg',
      backupUrl: 'https://decomidaperuana.com/wp-content/uploads/2020/05/picarones.jpg'
    },
    {
      id: 24,
      nombre: 'Tres Leches de Lúcuma',
      categoria: 'Postres',
      url: 'https://cdn0.recetasgratis.net/es/posts/9/5/2/torta_tres_leches_de_lucuma_45259_600.jpg',
      backupUrl: 'https://www.perudelights.com/wp-content/uploads/2013/07/Tres-leches.-jpg-2-PD.jpg'
    },
    {
      id: 25,
      nombre: 'Maracuyá Sour sin Alcohol',
      categoria: 'Bebidas y Jarras',
      url: 'https://www.perudelights.com/wp-content/uploads/2013/09/PassionFruitSour.R..jpg',
      backupUrl: 'https://www.eatperu.com/wp-content/uploads/2021/01/maracuya-sour-recipe-683x1024.jpg'
    },
    {
      id: 26,
      nombre: 'Emoliente Frutal Helado',
      categoria: 'Bebidas y Jarras',
      url: 'https://cdn0.recetasgratis.net/es/posts/7/1/8/emoliente_peruano_76817_600.jpg',
      backupUrl: 'https://decomidaperuana.com/wp-content/uploads/2020/04/emoliente.jpg'
    },
    {
      id: 27,
      nombre: 'Combinado Clásico Limeño',
      categoria: 'Postres',
      url: 'https://cdn0.recetasgratis.net/es/posts/9/8/4/mazamorra_con_arroz_con_leche_76489_600.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/1/9/6/mazamorra_morada_facil_16691_600.jpg'
    },
    {
      id: 28,
      nombre: 'Pachamanca a la Olla Tradicional',
      categoria: 'Platos Especiales',
      url: 'https://cdn0.recetasgratis.net/es/posts/0/1/7/pachamanca_a_la_olla_75710_600.jpg',
      backupUrl: 'https://decomidaperuana.com/wp-content/uploads/2019/09/pachamanca-a-la-olla.jpg'
    },
    {
      id: 29,
      nombre: 'Carapulcra con Sopa Seca Chinchana',
      categoria: 'Platos Criollos',
      url: 'https://cdn0.recetasgratis.net/es/posts/8/8/0/carapulcra_chinchana_78088_600.jpg',
      backupUrl: 'https://decomidaperuana.com/wp-content/uploads/2019/04/receta-de-sopa-seca.jpg'
    },
    {
      id: 30,
      nombre: 'Arroz con Mariscos a la Criolla',
      categoria: 'Platos Criollos',
      url: 'https://cdn0.recetasgratis.net/es/posts/4/9/7/arroz_con_mariscos_peruano_75794_600.jpg',
      backupUrl: 'https://decomidaperuana.com/wp-content/uploads/2020/04/arroz-con-mariscos-receta.jpg'
    },
    {
      id: 31,
      nombre: 'Tacu Tacu con Lomo al Jugo',
      categoria: 'Platos Criollos',
      url: 'https://cdn0.recetasgratis.net/es/posts/9/5/5/tacu_tacu_con_lomo_76559_600.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/1/1/3/tacu_tacu_a_lo_pobre_75311_600.jpg'
    },
    {
      id: 32,
      nombre: 'Cau Cau Criollo de Mondongo',
      categoria: 'Platos Criollos',
      url: 'https://cdn0.recetasgratis.net/es/posts/4/1/1/cau_cau_de_mondongo_75114_600.jpg',
      backupUrl: 'https://decomidaperuana.com/wp-content/uploads/2020/05/cau-cau-de-pollo.jpg'
    },
    {
      id: 33,
      nombre: 'Choritos a la Chalaca (8 und.)',
      categoria: 'Entradas',
      url: 'https://cdn0.recetasgratis.net/es/posts/7/8/2/choritos_a_la_chalaca_77287_600.jpg',
      backupUrl: 'https://www.perudelights.com/wp-content/uploads/2012/04/3-1024x768.jpg'
    },
    {
      id: 34,
      nombre: 'Jarra de Limonada de Hierbabuena (1L)',
      categoria: 'Bebidas y Jarras',
      url: 'https://cdn0.recetasgratis.net/es/posts/5/2/6/granizado_de_lima_y_menta_con_thermomix_30625_600.jpg',
      backupUrl: 'https://comedera.com/wp-content/uploads/sites/9/2026/06/Agua-de-pepino-con-limon.webp?w=768'
    },
    {
      id: 35,
      nombre: 'Jarra de Sangría Criolla (1L)',
      categoria: 'Bebidas y Jarras',
      url: 'https://cdn0.recetasgratis.net/es/posts/1/6/7/sangria_tradicional_41761_600.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/7/9/3/sangria_facil_41397_600.jpg'
    },
    {
      id: 36,
      nombre: 'Vaso de Chicha Morada (450ml)',
      categoria: 'Bebidas y Jarras',
      url: 'https://comedera.com/wp-content/uploads/sites/9/2026/03/chicha-morada.webp?w=768',
      backupUrl: 'https://www.eatperu.com/wp-content/uploads/2020/07/peruvian-chicha-morada-with-corn-and-lime-683x1024.jpg'
    },
    {
      id: 37,
      nombre: 'Pisco Sour Clásico Peruano',
      categoria: 'Bebidas y Jarras',
      url: 'https://cdn0.recetasgratis.net/es/posts/9/8/2/pisco_sour_peruano_casero_16289_600.jpg',
      backupUrl: 'https://decomidaperuana.com/wp-content/uploads/2017/09/receta-de-pisco-sour.jpg'
    },
    {
      id: 38,
      nombre: 'Chilcano de Maracuyá o Limón',
      categoria: 'Bebidas y Jarras',
      url: 'https://cdn0.recetasgratis.net/es/posts/2/8/6/chilcano_de_maracuya_77682_600.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/9/8/6/chilcano_de_pisco_77689_600.jpg'
    },
    {
      id: 39,
      nombre: 'Inca Kola / Gaseosa Personal (500ml)',
      categoria: 'Bebidas y Jarras',
      url: 'https://www.papajohns.com.pe/media/catalog/product/1/4/14938.png?optimize=medium&bg-color=255,255,255&fit=bounds&height=700&width=700&canvas=700:700&format=jpeg',
      backupUrl: 'https://plazavea.vteximg.com.br/arquivos/ids/33481461-418-418/497497.jpg'
    },
    {
      id: 40,
      nombre: 'Combo Criollo Para 2',
      categoria: 'Combos',
      url: 'https://comedera.com/wp-content/uploads/sites/9/2023/05/Lomo-en-su-jugo-peruano-shutterstock_1993679156.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/3/9/7/lomo_saltado_de_pollo_jugoso_75793_600.jpg'
    },
    {
      id: 41,
      nombre: 'Combo Horno & Brasa Familiar (4 pers.)',
      categoria: 'Combos',
      url: 'https://decomidaperuana.com/wp-content/uploads/2020/05/parrilla.jpg',
      backupUrl: 'https://www.eatperu.com/wp-content/uploads/2019/10/pollo-a-la-brasa-with-salad-and-dipping-sauces-1024x683.jpg'
    },
    {
      id: 42,
      nombre: 'Combo Almuerzo Express Wok',
      categoria: 'Combos',
      url: 'https://cdn0.recetasgratis.net/es/posts/1/8/6/aeropuerto_chifa_76681_600.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/5/4/8/arroz_chaufa_de_pollo_76845_600.jpg'
    },
    {
      id: 43,
      nombre: 'Combo Dúo Barra & Piqueo',
      categoria: 'Combos',
      url: 'https://www.perudelights.com/wp-content/uploads/2016/09/P1015338.jpg',
      backupUrl: 'https://www.eatperu.com/wp-content/uploads/2021/02/peruvian-appetizer-blog-pinterest.jpg'
    },
    {
      id: 44,
      nombre: 'Menú del Día (Lun · Mié · Vie)',
      categoria: 'Menú del Día',
      url: 'https://decomidaperuana.com/wp-content/uploads/2019/04/receta-de-sopa-seca.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/1/6/8/carapulcra_de_chancho_63861_600.jpg'
    },
    {
      id: 45,
      nombre: 'Menú del Día (Mar · Jue · Sáb)',
      categoria: 'Menú del Día',
      url: 'https://cdn0.recetasgratis.net/es/posts/3/8/7/aji_de_pollo_16783_600.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/1/1/3/tacu_tacu_a_lo_pobre_75311_600.jpg'
    },
    {
      id: 46,
      nombre: 'Menú Especial de Domingo',
      categoria: 'Menú del Día',
      url: 'https://decomidaperuana.com/wp-content/uploads/2019/09/pachamanca-a-la-olla.jpg',
      backupUrl: 'https://cdn0.recetasgratis.net/es/posts/9/0/1/rocoto_relleno_arequipeno_75109_600.jpg'
    }
  ];

  // Dominios de bancos de stock frecuentemente reseteados en redes universitarias/corporativas
  const BLOCKED_STOCK_HOSTS = /(^|\.)((images\.)?unsplash\.com|(images\.)?pexels\.com|(cdn\.)?pixabay\.com)$/i;

  function normalizeName(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  function isBlockedHost(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url, 'https://melidan.local');
      return BLOCKED_STOCK_HOSTS.test(parsed.hostname);
    } catch (_) {
      return /unsplash\.com|pexels\.com|pixabay\.com/i.test(url);
    }
  }

  function escapeSvgText(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Índices rápidos en memoria (diccionario JS)
  const byId = Object.create(null);
  const byName = Object.create(null);
  const byNormName = Object.create(null);
  const entryById = Object.create(null);
  const entryByNormName = Object.create(null);

  function registerEntry(item) {
    if (!item || !item.url) return;
    const idKey = item.id !== undefined && item.id !== null ? String(item.id) : '';
    const norm = normalizeName(item.nombre || item.name);
    const normalized = {
      id: item.id !== undefined ? Number(item.id) : null,
      nombre: item.nombre || item.name || '',
      categoria: item.categoria || item.category || '',
      url: String(item.url).trim(),
      backupUrl: item.backupUrl ? String(item.backupUrl).trim() : ''
    };

    if (idKey) {
      byId[idKey] = normalized.url;
      entryById[idKey] = normalized;
    }
    if (normalized.nombre) {
      byName[normalized.nombre] = normalized.url;
    }
    if (norm) {
      byNormName[norm] = normalized.url;
      entryByNormName[norm] = normalized;
    }
  }

  for (const item of DISH_ENTRIES) {
    registerEntry(item);
  }

  function lookupEntry(dishOrId, fallbackName) {
    if (dishOrId && typeof dishOrId === 'object') {
      const id = dishOrId.id ?? dishOrId.id_producto;
      if (id !== undefined && id !== null && entryById[String(id)]) {
        return entryById[String(id)];
      }
      const norm = normalizeName(dishOrId.name || dishOrId.nombre || fallbackName);
      if (norm && entryByNormName[norm]) {
        return entryByNormName[norm];
      }
      return null;
    }

    if (dishOrId !== undefined && dishOrId !== null && entryById[String(dishOrId)]) {
      return entryById[String(dishOrId)];
    }
    const norm = normalizeName(typeof dishOrId === 'string' ? dishOrId : fallbackName);
    if (norm && entryByNormName[norm]) {
      return entryByNormName[norm];
    }
    return null;
  }

  function buildPlaceholderSvg(label, category) {
    const safeTitle = escapeSvgText(String(label || 'Melidan Carta').slice(0, 34));
    const safeCat = escapeSvgText(String(category || 'Cocina Peruana').slice(0, 26));
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 420" width="640" height="420">',
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
      '<stop offset="0%" stop-color="#1E293B"/><stop offset="100%" stop-color="#0F172A"/>',
      '</linearGradient></defs>',
      '<rect width="640" height="420" fill="url(#g)"/>',
      '<circle cx="320" cy="158" r="54" fill="rgba(255,87,34,0.16)" stroke="#FF5722" stroke-width="3"/>',
      '<text x="320" y="170" text-anchor="middle" font-family="sans-serif" font-size="34" font-weight="800" fill="#FF8A65">M.</text>',
      `<text x="320" y="255" text-anchor="middle" font-family="sans-serif" font-size="22" font-weight="700" fill="#F8FAFC">${safeTitle}</text>`,
      `<text x="320" y="290" text-anchor="middle" font-family="sans-serif" font-size="14" font-weight="600" fill="#94A3B8">${safeCat}</text>`,
      '</svg>'
    ].join('');
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function buildAvatarSvg(name) {
    const parts = String(name || 'Melidan').trim().split(/\s+/).filter(Boolean);
    const initials = ((parts[0]?.[0] || 'M') + (parts[1]?.[0] || parts[0]?.[1] || '')).toUpperCase();
    const palette = ['#FF5722', '#009B77', '#0284C7', '#7C3AED', '#D97706', '#E11D48'];
    let hash = 0;
    for (let i = 0; i < initials.length; i++) hash = (hash * 31 + initials.charCodeAt(i)) % palette.length;
    const bg = palette[hash];
    const svg = [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">',
      `<rect width="120" height="120" rx="60" fill="${bg}"/>`,
      `<text x="60" y="72" text-anchor="middle" font-family="sans-serif" font-size="44" font-weight="800" fill="#FFFFFF">${escapeSvgText(initials)}</text>`,
      '</svg>'
    ].join('');
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }

  function resolve(dishOrId, fallbackName) {
    const entry = lookupEntry(dishOrId, fallbackName);
    if (entry && entry.url) {
      return entry.url;
    }

    const rawUrl = (dishOrId && typeof dishOrId === 'object')
      ? (dishOrId.image || dishOrId.imagen_url || '')
      : '';
    if (rawUrl && !isBlockedHost(rawUrl)) {
      return String(rawUrl);
    }

    const label = (dishOrId && typeof dishOrId === 'object')
      ? (dishOrId.name || dishOrId.nombre || fallbackName)
      : fallbackName;
    const cat = (dishOrId && typeof dishOrId === 'object')
      ? (dishOrId.category || dishOrId.categoria || '')
      : '';
    return buildPlaceholderSvg(label, cat);
  }

  function getBackup(dishOrId, fallbackName) {
    const entry = lookupEntry(dishOrId, fallbackName);
    return (entry && entry.backupUrl) ? entry.backupUrl : '';
  }

  function resolveAvatar(url, name) {
    if (url && typeof url === 'string' && !isBlockedHost(url)) {
      return url;
    }
    return buildAvatarSvg(name);
  }

  function handleError(imgEl) {
    if (!imgEl) return;
    const stage = imgEl.getAttribute('data-img-stage') || 'primary';
    const dishId = imgEl.getAttribute('data-dish-id') || '';
    const dishName = imgEl.getAttribute('data-dish-name') || imgEl.alt || 'Melidan';
    const dishCat = imgEl.getAttribute('data-dish-cat') || 'Melidan';

    if (stage === 'primary') {
      const backup = getBackup(dishId || dishName, dishName);
      if (backup && backup !== imgEl.src) {
        imgEl.setAttribute('data-img-stage', 'backup');
        imgEl.src = backup;
        return;
      }
    }

    imgEl.setAttribute('data-img-stage', 'fallback');
    imgEl.onerror = null;
    imgEl.src = buildPlaceholderSvg(dishName, dishCat);
  }

  function handleAvatarError(imgEl, name) {
    if (!imgEl) return;
    imgEl.onerror = null;
    imgEl.src = buildAvatarSvg(name || imgEl.alt || 'M');
  }

  async function syncFromJson(jsonPath) {
    if (typeof fetch !== 'function') return false;
    try {
      const res = await fetch(jsonPath || '/data/carta-imagenes.json', { cache: 'no-cache' });
      if (!res.ok) return false;
      const data = await res.json();
      if (Array.isArray(data.items)) {
        for (const item of data.items) {
          registerEntry(item);
        }
      }
      // Actualizar dinámicamente imágenes ya montadas si el JSON fue personalizado
      if (typeof document !== 'undefined') {
        document.querySelectorAll('img[data-dish-id]').forEach((img) => {
          const id = img.getAttribute('data-dish-id');
          const next = byId[id];
          if (next && img.getAttribute('data-img-stage') !== 'fallback' && img.src !== next) {
            img.setAttribute('data-img-stage', 'primary');
            img.src = next;
          }
        });
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  const api = {
    version: '3.4.0',
    items: DISH_ENTRIES,
    byId,
    byName,
    normalizeName,
    isBlockedHost,
    resolve,
    getBackup,
    resolveAvatar,
    buildPlaceholderSvg,
    buildAvatarSvg,
    handleError,
    handleAvatarError,
    syncFromJson
  };

  if (typeof globalScope !== 'undefined') {
    globalScope.MELIDAN_DISH_IMAGES = byId;
    globalScope.MelidanDishImages = api;
  }

  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        syncFromJson('/data/carta-imagenes.json');
      });
    } else {
      syncFromJson('/data/carta-imagenes.json');
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof window !== 'undefined' ? window : globalThis);
