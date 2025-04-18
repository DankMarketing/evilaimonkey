/*!
 * evilaimonkey - A userscript manager with AI features
 *
 * Contains code derived from Violentmonkey:
 * Copyright (c) 2015-present, Violentmonkey Team
 *
 * This modified version is licensed under MIT License
 * Copyright (c) 2025 evilaimonkey Contributors
 */

// aimonkey userscript engine v2 (Used for v1 AutoRun Fix)

// Function definition - this doesn't run until called
function initEngine() {
  // Prevent multiple initializations
  if (window.aimonkey && window.aimonkey.initialized) {
    return;
  }

  console.log('[aimonkey Engine] Initializing...');

  // Create namespace
  window.aimonkey = {
    version: '1.1', // Match extension version
    initialized: true,
    _GM_apis: {} // Store GM API implementations privately
  };

  // --- GM API Implementations ---

  const GM_STORAGE_PREFIX = 'aimonkey_gm_storage_'; // Prefix for localStorage keys

  // GM_addStyle
  window.aimonkey._GM_apis.addStyle = function(css) {
    try {
      const style = document.createElement('style');
      style.textContent = css;
      (document.head || document.documentElement).appendChild(style);
      return style;
    } catch (e) {
      console.error('[aimonkey GM] GM_addStyle error:', e);
      return null;
    }
  };

  // GM_getValue (using synchronous localStorage for broader compatibility)
  window.aimonkey._GM_apis.getValue = function(key, defaultValue) {
    try {
      const storageKey = GM_STORAGE_PREFIX + key;
      const value = localStorage.getItem(storageKey);
      if (value === null) {
        return defaultValue;
      }
      try {
        return JSON.parse(value);
      } catch (e) {
        return value; // Return raw string if not JSON
      }
    } catch (e) {
      console.error(`[aimonkey GM] GM_getValue error for key '${key}':`, e);
      return defaultValue;
    }
  };

  // GM_setValue (using synchronous localStorage)
  window.aimonkey._GM_apis.setValue = function(key, value) {
    try {
      const storageKey = GM_STORAGE_PREFIX + key;
      if (value === undefined) {
        localStorage.removeItem(storageKey);
      } else {
        const valueToStore = JSON.stringify(value);
        localStorage.setItem(storageKey, valueToStore);
      }
    } catch (e) {
      console.error(`[aimonkey GM] GM_setValue error for key '${key}':`, e);
      if (e.name === 'QuotaExceededError') {
          alert(`aimonkey: Storage quota exceeded. Could not save value for key "${key}".`);
      }
    }
  };

   // GM_deleteValue (using synchronous localStorage)
   window.aimonkey._GM_apis.deleteValue = function(key) {
    try {
      const storageKey = GM_STORAGE_PREFIX + key;
      localStorage.removeItem(storageKey);
    } catch (e) {
      console.error(`[aimonkey GM] GM_deleteValue error for key '${key}':`, e);
    }
  };

  // GM_listValues (using synchronous localStorage)
  window.aimonkey._GM_apis.listValues = function() {
    try {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(GM_STORAGE_PREFIX)) { // Add null check for key
                keys.push(key.substring(GM_STORAGE_PREFIX.length));
            }
        }
        return keys;
    } catch (e) {
        console.error('[aimonkey GM] GM_listValues error:', e);
        return [];
    }
  };


  // GM_xmlhttpRequest (Simplified)
  window.aimonkey._GM_apis.xmlhttpRequest = function(details) {
    try {
        const xhr = new XMLHttpRequest();
        const method = details.method ? details.method.toUpperCase() : 'GET';
        xhr.open(method, details.url, true); // Always async

        if (details.headers) {
            for (const header in details.headers) {
                if (Object.prototype.hasOwnProperty.call(details.headers, header)) {
                    xhr.setRequestHeader(header, details.headers[header]);
                }
            }
        }
        if (details.timeout) xhr.timeout = details.timeout;
        if (details.responseType) xhr.responseType = details.responseType;

        const handleLoad = () => {
            if (details.onload) {
                details.onload({
                    finalUrl: xhr.responseURL, readyState: xhr.readyState, status: xhr.status, statusText: xhr.statusText,
                    responseHeaders: xhr.getAllResponseHeaders(), response: xhr.response,
                    responseText: xhr.responseType === '' || xhr.responseType === 'text' ? xhr.responseText : null,
                    responseXML: xhr.responseType === 'document' ? xhr.responseXML : null,
                });
            }
        };
        const handleError = (event) => {
            console.error('[aimonkey GM] GM_xmlhttpRequest error:', event.type, details.url);
            if (details.onerror) {
                details.onerror({ error: `Network error or CORS issue accessing ${details.url}` });
            }
        };
        const handleTimeout = (event) => {
            if (details.ontimeout) details.ontimeout({}); else handleError(event);
        };
        const handleAbort = () => { if (details.onabort) details.onabort({}); };

        xhr.onload = handleLoad;
        xhr.onerror = handleError;
        xhr.ontimeout = handleTimeout;
        xhr.onabort = handleAbort;

        xhr.send(details.data || null);
        return { abort: () => xhr.abort() };
    } catch (e) {
         console.error('[aimonkey GM] GM_xmlhttpRequest setup error:', e);
         if (details.onerror) details.onerror({ error: `Setup error: ${e.message}` });
         return { abort: () => {} };
    }
  };

  // GM_info
  window.GM_info = {
    scriptHandler: 'aimonkey', version: '1.1', // Match extension version
    script: {
      name: 'Unknown aimonkey Script', namespace: 'aimonkey', description: 'No description', version: '1.0',
      grant: ['GM_addStyle', 'GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues', 'GM_xmlhttpRequest'],
    },
  };

  // --- Expose APIs to Global Scope ---
  window.GM_addStyle = window.aimonkey._GM_apis.addStyle;
  window.GM_getValue = window.aimonkey._GM_apis.getValue;
  window.GM_setValue = window.aimonkey._GM_apis.setValue;
  window.GM_deleteValue = window.aimonkey._GM_apis.deleteValue;
  window.GM_listValues = window.aimonkey._GM_apis.listValues;
  window.GM_xmlhttpRequest = window.aimonkey._GM_apis.xmlhttpRequest;

  // Test function for background script verification
  window.__aimonkey_test = function() {
    console.log('[aimonkey Engine] Test function executed.');
    return true;
  };

  console.log('[aimonkey Engine] Initialization complete.');

} // End of initEngine definition

// --- Call initEngine ---
// This line will execute when Chrome injects and runs this script file
// in the page's context (MAIN world) at document_start.
initEngine();