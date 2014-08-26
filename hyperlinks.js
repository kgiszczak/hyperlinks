(function($) {
  'use strict';

  var createDocument,
      xhr,
      cacheSize = 20;

  var cache = {
    pages: {},

    get: function(url) {
      return this.pages[url];
    },

    set: function(url, data) {
      this.pages[url] = {
        data: data,
        url: url,
        timestamp: new Date().getTime()
      };

      this.trim();
    },

    trim: function() {
      var keys = Object.keys(this.pages);

      if (keys.length > cacheSize) {
        var item = this.pages[keys[0]];

        $.each(this.pages, function(key, el) {
          if (el.timestamp < item.timestamp) item = el;
        });

        delete this.pages[item.url];
      }
    }
  };

  function pagesCache(size) {
    if (typeof size !== 'undefined') cacheSize = size;
    return cacheSize;
  }

  function click(e) {
    var url = parseUrl(this.href);
    var current = parseUrl(document.location.href);

    // Ignore event with default prevented
    if (e.isDefaultPrevented())
      return;

    // Middle click, cmd click, and ctrl click should open
    // links in a new tab as normal.
    if (e.which > 1 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;

    // Ignore links with target attribute
    if (this.target.length > 0)
      return;

    // Ignore cross origin links
    if ($(this).is('[data-no-hyperlink]'))
      return;

    // Ignore cross origin links
    if (url.origin !== current.origin)
      return;

    // Ignore anchors on the same page
    if (url.hash && url.absolute.replace(url.hash, '') === current.absolute.replace(current.hash, ''))
      return;

    // Ignore empty anchor
    if (url.absolute === current.absolute + '#')
      return;

    // Ignore links with extension
    if (url.pathname.match(/\.[a-z]+$/g))
      return;

    e.preventDefault();

    if (triggerEvent('page:beforeChange'))
      return;

    fetch(url.absolute);
  }

  function fetch(path) {
    var url = parseUrl(path).absolute;

    fetchCache(url);
    fetchReplacement(url);
  }

  function fetchReplacement(url) {
    if (xhr && xhr.requestUrl !== url) xhr.abort();

    if (!xhr) {
      triggerEvent('page:fetch', {url: url});
      xhr = $.ajax(url, { dataType: 'html' });
      xhr.requestUrl = url;
    }

    if (!xhr.callbacksAttached) {
      xhr.done(function(data) {
        triggerEvent('page:receive');

        var doc = processResponse(xhr, data);

        if (doc) {
          cache.set(url, data);
          updatePage(doc);
          updateHistory(url);
          triggerEvent('page:load');
        } else {
          document.location.href = url;
        }
      });

      xhr.fail(function(ajax, status, error) {
        if (error !== 'abort') document.location.href = url;
      });

      xhr.always(function() {
        xhr = null;
      });

      xhr.callbacksAttached = true;
    }
  }

  function fetchCache(url) {
    var cachedPage = cache.get(url);
    if (!cachedPage) return;

    var doc = createDocument(cachedPage.data);
    updatePage(doc);
    updateHistory(url);
    triggerEvent('page:restore');
  }

  function assetsChanged(doc) {
    var extractUrl = function(el) {
      return $(el).attr('href') || $(el).attr('src');
    };

    var assets = $.map($('[data-hyperlinks-track]'), extractUrl);
    var newAssets = $.map($(doc).find('[data-hyperlinks-track]'), extractUrl);

    if (assets.length !== newAssets.length) return true;

    var reload = false;
    assets.forEach(function(el) {
      if (newAssets.indexOf(el) === -1) reload = true;
    });

    return reload;
  }

  function processResponse(xhr, data) {
    var contentType = xhr.getResponseHeader('Content-Type');
    var regExp = /^(?:text\/html|application\/xhtml\+xml|application\/xml)(?:;|$)/;
    var validContent = contentType && contentType.match(regExp);

    if (!validContent) return;

    var doc = createDocument(data);

    if (!doc) return;
    if (assetsChanged(doc)) return;

    return doc;
  }

  function updatePage(doc) {
    document.title = $(doc).find('title').text();
    document.documentElement.replaceChild(doc.body, document.body);

    window.scrollTo(0, 0);

    var token = $(doc).find('meta[name="csrf-token"]').attr('content');
    updateCSRFToken(token);

    triggerEvent('page:change');
  }

  function updateCSRFToken(token) {
    if (!token) return;
    $('meta[name="csrf-token"]').attr('content', token);
  }

  function updateHistory(url) {
    var current = parseUrl(document.location.href).absolute;
    if (url !== current) window.history.pushState({}, '', url);
  }

  function triggerEvent(name, params) {
    var e = $.Event(name, params);
    $(document).trigger(e);
    return e.isDefaultPrevented();
  }

  function parseUrl(url) {
    var a = document.createElement('a');
    a.href = url;

    var origin = [a.protocol, '//', a.hostname].join('');
    if (a.port.length > 0) origin += ':' + a.port;

    return {
      hash: a.hash,
      host: a.host,
      hostname: a.hostname,
      absolute: a.href,
      origin: origin,
      pathname: a.pathname,
      port: a.port,
      protocol: a.protocol,
      search: a.search
    };
  }

  function browserCompatibleParser() {
    function createUsingParser(html) {
      return (new DOMParser()).parseFromString(html, 'text/html');
    }

    function createUsingDOM(html) {
      var doc = document.implementation.createHTMLDocument('');
      doc.documentElement.innerHTML = html;
      return doc;
    }

    function createUsingWrite(html) {
      var doc = document.implementation.createHTMLDocument('');
      doc.open('replace');
      doc.write(html);
      doc.close();
      return doc;
    }

    // Use createUsingParser if DOMParser is defined and natively
    // supports 'text/html' parsing (Firefox 12+, IE 10)
    //
    // Use createUsingDOM if createUsingParser throws an exception
    // due to unsupported type 'text/html' (Firefox < 12, Opera)
    //
    // Use createUsingWrite if:
    //  - DOMParser isn't defined
    //  - createUsingParser returns null due to unsupported type 'text/html' (Chrome, Safari)
    //  - createUsingDOM doesn't create a valid HTML document (safeguarding against potential edge cases)

    var testDoc;

    try {
      if (window.DOMParser) {
        testDoc = createUsingParser('<html><body><p>test');
        return createUsingParser;
      }
    } catch (e) {
      testDoc = createUsingDOM('<html><body><p>test');
      return createUsingDOM;
    } finally {
      if (!testDoc || !testDoc.body || testDoc.body.childNodes.length !== 1) {
        return createUsingWrite;
      }
    }
  }

  function init() {
    createDocument = browserCompatibleParser();

    $(function() {
      triggerEvent('page:change');

      var doc = $(document.documentElement).html();
      cache.set(document.location.href, doc);
    });

    // safari fires popstate event on page load
    setTimeout(function() {
      $(window).on('popstate', function(e) {
        fetch(e.target.location.href);
      });
    }, 500);

    document.addEventListener('click', function() {
      $(document)
        .off('click', 'a', click)
        .on('click', 'a', click);
    }, true);
  }

  var supported = window.history && window.history.pushState && !navigator.userAgent.match(/CriOS\//);
  var visit;

  if (supported) {
    init();
    visit = fetch;
  } else {
    visit = function(url) { document.location.href = url; };
  }

  window.Hyperlinks = {visit: visit, pagesCache: pagesCache, supported: supported};
})(jQuery);
