/**
 * The page hooks runtime: one main-world function that patches the browser entry points add-ons
 * share (JSON.parse, fetch, XMLHttpRequest) once, and lets each add-on register a modifier.
 * It runs first in a web App's preload, so `window.couchHooks` exists for every add-on function.
 *
 *   couchHooks.onJson(modifier)             modifier(value) -> replacement | undefined (undefined keeps `value`, which may be edited in place)
 *   couchHooks.onResponse(urlPrefix, mod)   mod(text, url) -> replacement text | undefined; fetch and XMLHttpRequest responses whose URL starts with the prefix
 *
 * Modifiers run in registration order. One that throws is skipped (logged once) and its edits are
 * discarded (it works on a copy); it can never throw into the page. Patched functions keep their `name`, `length` and `toString()`.
 */
export const PAGE_HOOKS_FUNCTION = `function () {
  try {
    if (window.couchHooks) return;
    var jsonMods = [];
    var respMods = [];
    var warned = new Set();
    var warn = function (what, e) {
      if (warned.has(what)) return;
      warned.add(what);
      try { console.warn('[couch] add-on hook failed: ' + e); } catch (x) {}
    };

    var natives = new WeakMap();
    var fnToString = Function.prototype.toString;
    var patchedToString = function toString() {
      var original = natives.get(this);
      return fnToString.call(original || this);
    };
    natives.set(patchedToString, fnToString);
    Function.prototype.toString = patchedToString;

    var disguise = function (wrapper, original) {
      try {
        Object.defineProperty(wrapper, 'name', { value: original.name, configurable: true });
        Object.defineProperty(wrapper, 'length', { value: original.length, configurable: true });
      } catch (e) {}
      natives.set(wrapper, original);
      return wrapper;
    };
    var patch = function (obj, key, make) {
      var original = obj[key];
      if (typeof original !== 'function') return;
      obj[key] = disguise(make(original), original);
    };

    var nativeParse = JSON.parse;
    var nativeStringify = JSON.stringify;
    var busy = false;
    var applyJson = function (value) {
      if (busy || !jsonMods.length) return value;
      busy = true;
      try {
        for (var i = 0; i < jsonMods.length; i++) {
          var work = value;
          try {
            if (value && typeof value === 'object') work = nativeParse(nativeStringify(value));
            var r = jsonMods[i](work);
            value = r !== undefined ? r : work;
          } catch (e) { warn(jsonMods[i], e); }
        }
      } finally { busy = false; }
      return value;
    };
    patch(JSON, 'parse', function (original) {
      return function () {
        var value = original.apply(this, arguments);
        try { return applyJson(value); } catch (e) { return value; }
      };
    });

    var absolute = function (url) {
      try { return new URL(String(url), location.href).href; } catch (e) { return String(url); }
    };
    var matches = function (mod, url, abs) {
      return abs.indexOf(mod.prefix) === 0 || String(url).indexOf(mod.prefix) === 0;
    };
    var wants = function (url) {
      if (!respMods.length) return false;
      var abs = absolute(url);
      return respMods.some(function (m) { return matches(m, url, abs); });
    };
    var applyText = function (url, text) {
      var abs = absolute(url);
      for (var i = 0; i < respMods.length; i++) {
        if (!matches(respMods[i], url, abs)) continue;
        try {
          var r = respMods[i].fn(text, abs);
          if (typeof r === 'string') text = r;
        } catch (e) { warn(respMods[i].fn, e); }
      }
      return text;
    };

    patch(window, 'fetch', function (original) {
      return function (input) {
        var promise = original.apply(this, arguments);
        var url;
        try { url = typeof input === 'string' ? input : (input && input.url) || String(input); } catch (e) { return promise; }
        if (!wants(url)) return promise;
        return promise.then(function (res) {
          try {
            return res.clone().text().then(function (text) {
              try {
                var out = applyText(url, text);
                if (out === text) return res;
                var copy = new Response(out, { status: res.status, statusText: res.statusText, headers: res.headers });
                try { Object.defineProperty(copy, 'url', { value: res.url }); } catch (e) {}
                return copy;
              } catch (e) { return res; }
            }, function () { return res; });
          } catch (e) { return res; }
        });
      };
    });

    if (typeof XMLHttpRequest !== 'undefined') {
      var proto = XMLHttpRequest.prototype;
      var urls = new WeakMap();
      var cache = new WeakMap();
      patch(proto, 'open', function (original) {
        return function (method, url) {
          try { urls.set(this, String(url)); cache.delete(this); } catch (e) {}
          return original.apply(this, arguments);
        };
      });
      ['responseText', 'response'].forEach(function (key) {
        var d = Object.getOwnPropertyDescriptor(proto, key);
        if (!d || !d.get) return;
        var native = d.get;
        var getter = function () {
          var value = native.call(this);
          try {
            var url = urls.get(this);
            if (url === undefined || this.readyState !== 4 || !wants(url)) return value;
            var type = this.responseType;
            if (key === 'response' && type !== '' && type !== 'text' && type !== 'json') return value;
            var cached = cache.get(this);
            if (cached && cached.key === key && cached.raw === value) return cached.out;
            var text = key === 'response' && type === 'json' ? JSON.stringify(value) : value;
            if (typeof text !== 'string') return value;
            var out = applyText(url, text);
            var result = out === text ? value : (key === 'response' && type === 'json' ? JSON.parse(out) : out);
            cache.set(this, { key: key, raw: value, out: result });
            return result;
          } catch (e) { return value; }
        };
        Object.defineProperty(proto, key, { configurable: true, enumerable: d.enumerable, get: disguise(getter, native), set: d.set });
      });
    }

    Object.defineProperty(window, 'couchHooks', {
      value: Object.freeze({
        onJson: function (modifier) { if (typeof modifier === 'function') jsonMods.push(modifier); },
        onResponse: function (prefix, modifier) {
          if (typeof modifier === 'function') respMods.push({ prefix: String(prefix), fn: modifier });
        }
      }),
      configurable: false
    });
  } catch (e) {}
}`;
