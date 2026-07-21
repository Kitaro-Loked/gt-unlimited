/* GT UNLIMITED Service Worker — 本地缓存与资源加载优化
 * 策略总览：
 *   a) 同源导航请求        → network-first（更新即时生效，离线回退缓存）
 *   b) 同源 /assets/ 静态资源 → stale-while-revalidate
 *   c) fonts / jsdelivr    → cache-first
 *   d) TradingView 脚本    → cache-first（允许缓存 opaque 响应）
 *   e) 免 key 行情 API     → 60 秒 TTL 缓存（网络失败回退过期缓存）
 *   f) 其它请求            → 直接走网络，不缓存
 */
'use strict';

var VERSION = 'gt-sw-v16';

/* 所有缓存名统一带版本前缀，activate 时按前缀清理旧版本 */
var PAGES_CACHE = VERSION + '-pages';
var ASSETS_CACHE = VERSION + '-assets';
var CDN_CACHE = VERSION + '-cdn';
var API_CACHE = VERSION + '-api';

var CURRENT_CACHES = [PAGES_CACHE, ASSETS_CACHE, CDN_CACHE, API_CACHE];

/* 行情 API 缓存 TTL：60 秒 */
var API_TTL_MS = 60 * 1000;

/* c) cache-first 的公共 CDN 域名 */
var CDN_HOSTS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net'
];

/* d) TradingView 脚本域名（响应可能为 opaque，status 0） */
var TV_HOSTS = [
  's3.tradingview.com',
  'www.tradingview.com'
];

/* e) 运行时 fetch 的免 key 行情 API 域名 */
var API_HOSTS = [
  'api.binance.com',
  'fapi.binance.com',
  'api.gold-api.com',
  'api.frankfurter.dev',
  'api.coingecko.com',
  'api.alternative.me'
];

/* 判断响应是否可写入缓存：2xx 或 opaque(status 0) */
function isCacheable(response, allowOpaque) {
  if (!response) return false;
  if (response.ok || response.status === 200) return true;
  return !!allowOpaque && response.status === 0;
}

/* 统一异常兜底：任何策略失败都不得让 SW 抛出未处理异常 */
function safeRespond(promise) {
  return promise.catch(function () {
    return new Response('Service Unavailable', {
      status: 503,
      statusText: 'Service Unavailable'
    });
  });
}

/* a) network-first：优先网络，成功克隆入缓存；网络失败回退缓存 */
function networkFirst(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return fetch(request).then(function (response) {
      if (isCacheable(response, false)) {
        cache.put(request, response.clone()).catch(function () {});
      }
      return response;
    }).catch(function () {
      return cache.match(request).then(function (cached) {
        if (cached) return cached;
        throw new Error('network-first: no cache fallback');
      });
    });
  });
}

/* b) stale-while-revalidate：先返缓存，同时后台请求网络更新缓存 */
function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var network = fetch(request).then(function (response) {
        if (isCacheable(response, false)) {
          cache.put(request, response.clone()).catch(function () {});
        }
        return response;
      }).catch(function () {
        /* 后台更新失败直接吞掉，已有缓存兜底 */
        return cached;
      });
      return cached || network;
    });
  });
}

/* c/d) cache-first：命中即返；未命中走网络并按需缓存（TV 允许 opaque） */
function cacheFirst(request, cacheName, allowOpaque) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (isCacheable(response, allowOpaque)) {
          cache.put(request, response.clone()).catch(function () {});
        }
        return response;
      });
    });
  });
}

/* e) 行情 API：60 秒 TTL 缓存
 * 写入时克隆响应并附加 sw-cached-at 头作为缓存时间戳；
 * 命中且未过期直接返回，过期则走网络更新；
 * 网络失败且存在过期缓存时返回过期缓存兜底。
 */
function apiWithTTL(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (cached) {
      if (cached) {
        var cachedAt = parseInt(cached.headers.get('sw-cached-at') || '0', 10);
        if (cachedAt && Date.now() - cachedAt < API_TTL_MS) {
          return cached;
        }
      }
      return fetch(request).then(function (response) {
        if (isCacheable(response, false)) {
          /* 复制原响应 headers 并附加缓存时间戳 */
          var headers = new Headers(response.headers);
          headers.set('sw-cached-at', String(Date.now()));
          var stamped = new Response(response.clone().body, {
            status: response.status,
            statusText: response.statusText,
            headers: headers
          });
          cache.put(request, stamped).catch(function () {});
        }
        return response;
      }).catch(function () {
        /* 网络失败：有过期缓存则用过期缓存兜底 */
        if (cached) return cached;
        throw new Error('api-ttl: network failed and no cache');
      });
    });
  });
}

self.addEventListener('install', function (event) {
  /* 立即激活，不等待旧 SW 释放页面 */
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  /* 清理非当前版本前缀的旧缓存，并立即接管所有页面 */
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        /* 仅保留当前版本清单内的缓存，其余（含旧版本前缀）全部删除 */
        if (CURRENT_CACHES.indexOf(name) === -1) {
          return caches.delete(name);
        }
        return Promise.resolve();
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  var request = event.request;

  /* 仅处理 GET；POST / WS 升级等一律放行，不缓存 */
  if (request.method !== 'GET') return;

  var url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  var sameOrigin = url.origin === self.location.origin;

  /* a) 同源导航请求 → network-first */
  if (sameOrigin && request.mode === 'navigate') {
    event.respondWith(safeRespond(networkFirst(request, PAGES_CACHE)));
    return;
  }

  /* b) 同源 /assets/ 静态资源 → stale-while-revalidate */
  if (sameOrigin && url.pathname.indexOf('/assets/') === 0) {
    event.respondWith(safeRespond(staleWhileRevalidate(request, ASSETS_CACHE)));
    return;
  }

  /* c) Google Fonts / jsdelivr → cache-first */
  if (CDN_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(safeRespond(cacheFirst(request, CDN_CACHE, false)));
    return;
  }

  /* d) TradingView 脚本 → cache-first，允许缓存 opaque(status 0) 响应 */
  if (TV_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(safeRespond(cacheFirst(request, CDN_CACHE, true)));
    return;
  }

  /* e) 免 key 行情 API → 60 秒 TTL 缓存 */
  if (API_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(safeRespond(apiWithTTL(request, API_CACHE)));
    return;
  }

  /* f) 其它请求：不调用 respondWith，浏览器默认直接 fetch，不缓存 */
});
