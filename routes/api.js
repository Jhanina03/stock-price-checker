'use strict';

const crypto = require('crypto');

// Almacen en memoria: { 'GOOG': Set(['hashDeIp1', 'hashDeIp2']) }
// (Si reinicias el servidor, los likes se borran. Para el reto es suficiente.)
const likesPorAccion = new Map();

// Anonimiza la IP con un hash SHA-256 (no se guarda la IP real)
function anonimizarIp(ip) {
  return crypto.createHash('sha256').update(String(ip)).digest('hex');
}

// Cache de precios por 60 segundos (evita pedir lo mismo muchas veces al proxy)
const cachePrecios = new Map();
const TIEMPO_CACHE_MS = 60 * 1000;

// Consulta el precio en el proxy de freeCodeCamp (con reintentos si falla)
async function obtenerPrecio(simbolo) {
  const enCache = cachePrecios.get(simbolo);
  if (enCache && Date.now() - enCache.hora < TIEMPO_CACHE_MS) return enCache.info;

  const url = `https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock/${encodeURIComponent(simbolo)}/quote`;
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const respuesta = await fetch(url);
      const datos = await respuesta.json();
      if (datos === 'Unknown symbol' || datos === 'Invalid symbol') return null; // simbolo no existe
      if (datos && typeof datos.latestPrice === 'number') {
        const info = { stock: datos.symbol, price: datos.latestPrice };
        cachePrecios.set(simbolo, { info, hora: Date.now() });
        return info;
      }
    } catch (err) {
      console.error(`Intento ${intento} fallo para ${simbolo}:`, err.message);
    }
    await new Promise(r => setTimeout(r, 300 * intento)); // espera y reintenta
  }
  return null;
}

function contarLikes(simbolo) {
  return likesPorAccion.has(simbolo) ? likesPorAccion.get(simbolo).size : 0;
}

function agregarLike(simbolo, ipHash) {
  if (!likesPorAccion.has(simbolo)) likesPorAccion.set(simbolo, new Set());
  likesPorAccion.get(simbolo).add(ipHash); // un Set no repite: 1 like por IP
}

module.exports = function (app) {

  app.route('/api/stock-prices')
    .get(async function (req, res) {
      try {
        let { stock, like } = req.query;
        if (!stock) return res.json({ error: 'stock is required' });

        const acciones = (Array.isArray(stock) ? stock : [stock])
          .slice(0, 2)
          .map(s => String(s).toUpperCase());
        const darLike = like === 'true' || like === true;
        const ipHash = anonimizarIp(req.ip);

        const resultados = await Promise.all(acciones.map(async simbolo => {
          const info = await obtenerPrecio(simbolo);
          if (!info) return { error: 'invalid symbol', likes: contarLikes(simbolo) };
          if (darLike) agregarLike(info.stock, ipHash);
          return { stock: info.stock, price: info.price, likes: contarLikes(info.stock) };
        }));

        // Una sola accion
        if (resultados.length === 1) {
          return res.json({ stockData: resultados[0] });
        }

        // Dos acciones: likes relativos
        const [a, b] = resultados;
        const stockData = [
          { ...(a.stock ? { stock: a.stock, price: a.price } : { error: a.error }), rel_likes: a.likes - b.likes },
          { ...(b.stock ? { stock: b.stock, price: b.price } : { error: b.error }), rel_likes: b.likes - a.likes }
        ];
        return res.json({ stockData });
      } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'could not fetch stock data' });
      }
    });

};
