(function($) {
  'use strict';

  var xhr,
      timeout,
      cacheSize = 20;

  var mouseShouldEnter = false;

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

  function mousemove() {
    mouseShouldEnter = true;
  }

  function mouseenter(e) {
    if (!mouseShouldEnter) return;

    var bound = $.proxy(function() {
      var url = parseUrl(this.href).absolute;

      // return if cache is fresh
      var cachedPage = cache.get(url);
      if (cachedPage && cachedPage.timestamp > new Date().getTime() - 5000) return;

      prefetchReplacement(url);
    }, this);

    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(bound, 250);
  }

  function mouseleave() {
    if (timeout) clearTimeout(timeout);
    if (xhr) {
      xhr.abort();
      xhr = null;
    }
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

  function prefetchReplacement(url) {
    if (xhr && xhr.requestUrl !== url) {
      xhr.abort();
      xhr = null;
    }

    if (!xhr) {
      xhr = $.ajax(url, { dataType: 'html' });
      xhr.requestUrl = url;
    }
  }

  function fetchReplacement(url) {
    if (xhr && xhr.requestUrl !== url) xhr.abort();

    if (!xhr) {
      triggerEvent('page:fetch', {url: url});
      xhr = $.ajax(url, { dataType: 'html' });
      xhr.requestUrl = url;
    }

    if (!xhr.callbacksAttached) {
      xhr.callbacksAttached = true;

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
    mouseShouldEnter = false;

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

  function createDocument(html) {
    var doc = document.documentElement.cloneNode();
    doc.innerHTML = html;
    doc.body = doc.querySelector('body');

    return doc;
  }

  function init() {
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

    $(document)
      .on('mousemove', mousemove)
      .on('mouseenter', 'a[data-prefetch]', mouseenter)
      .on('mouseleave', 'a[data-prefetch]', mouseleave);

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
