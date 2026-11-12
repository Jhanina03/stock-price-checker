'use strict';

const crypto = require('crypto');

// Almacen en memoria: { 'GOOG': Set(['hashDeIp1', 'hashDeIp2']) }
// (Si reinicias el servidor, los likes se borran. Para el reto es suficiente.)
const likesPorAccion = new Map();

// Anonimiza la IP con un hash SHA-256 (no se guarda la IP real)
function anonimizarIp(ip) {
  return crypto.createHash('sha256').update(String(ip)).digest('hex');
}

// Consulta el precio en el proxy de freeCodeCamp
async function obtenerPrecio(simbolo) {
  const url = `https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock/${encodeURIComponent(simbolo)}/quote`;
  const respuesta = await fetch(url);
  const datos = await respuesta.json();
  if (!datos || typeof datos.latestPrice !== 'number') return null;
  return { stock: datos.symbol, price: datos.latestPrice };
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
