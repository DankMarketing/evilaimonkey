/*!
 * evilaimonkey - A userscript manager with AI features
 *
 * Contains code derived from Violentmonkey:
 * Copyright (c) 2015-present, Violentmonkey Team
 *
 * This modified version is licensed under MIT License
 * Copyright (c) 2025 evilaimonkey Contributors
 */

// aimonkey v1 (AutoRun Fixed) - background.js (Reverted API Key Check in Generator)

// Store for API key - This acts as a cache, but storage is the source of truth
let apiKey = null;

// Track active tabs during page load to prevent duplicate executions in onUpdated
const activeTabs = new Set();


// --- Helper Functions ---

function parseMetadata(scriptCode = '') {
  const metadata = { match: [], include: [], exclude: [], grant: [], 'run-at': 'document-idle', name: 'Unnamed Script' };
  if (typeof scriptCode !== 'string' || !scriptCode) return metadata;
  const metaBlockMatch = scriptCode.match(/\/\/\s*==UserScript==([\s\S]*?)\/\/\s*==\/UserScript==/);
  if (metaBlockMatch) {
    const metaLines = metaBlockMatch[1].split('\n');
    metaLines.forEach(line => {
      const match = line.match(/^\/\/\s*@([\w-]+)\s+(.*)/);
      if (match) {
        const key = match[1].trim().toLowerCase();
        const value = match[2].trim();
        if (metadata.hasOwnProperty(key)) {
          if (Array.isArray(metadata[key])) metadata[key].push(value);
          else if (['name', 'version', 'run-at', 'namespace', 'description'].includes(key)) metadata[key] = value;
          else metadata[key] = [metadata[key], value];
        } else metadata[key] = value;
      }
    });
  }
  ['match', 'include', 'exclude', 'grant'].forEach(key => {
      if (metadata[key] && !Array.isArray(metadata[key])) metadata[key] = [metadata[key]];
      else if (!metadata[key]) metadata[key] = [];
  });
  return metadata;
}

function matchPatternToRegExp(pattern) {
    if (pattern === '<all_urls>') pattern = '*://*/*';
    const schemeMatch = pattern.match(/^(\*|https?|file|ftp):\/\//);
    if (!schemeMatch) throw new Error(`Invalid scheme: ${pattern}`);
    const scheme = schemeMatch[1] === '*' ? 'https?|file|ftp' : schemeMatch[1];
    pattern = pattern.substring(schemeMatch[0].length);
    const hostMatch = pattern.match(/^(\*|(?:\*\.)?[^/*]+)/);
    if (!hostMatch) throw new Error(`Invalid host: ${pattern}`);
    let host = hostMatch[1];
    pattern = pattern.substring(host.length);
    if (host === '*') host = '[^/]+';
    else if (host.startsWith('*.')) host = '(?:[^/]+\\.)?' + host.substring(2).replace(/\./g, '\\.');
    else host = host.replace(/\./g, '\\.');
    const path = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^(${scheme}):\\/\\/${host}(${path})$`);
}

function wildcardToRegExp(pattern) {
    const escapedPattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp(`^${escapedPattern}$`);
}

function isValidUrlForInjection(url) {
    if (!url) return false;
    try {
        const parsedUrl = new URL(url);
        if (['chrome:', 'about:', 'data:', 'blob:', 'javascript:'].includes(parsedUrl.protocol)) return false;
        if (parsedUrl.hostname === 'chrome.google.com' && parsedUrl.pathname.startsWith('/webstore')) return false;
    } catch (e) { return false; }
    return true;
}

function shouldRunOnUrl(metadata, url) {
  if (!isValidUrlForInjection(url)) return false;
  const excludes = metadata.exclude || [];
  const includes = metadata.include || [];
  const matches = metadata.match || [];
  const excluded = excludes.some(pattern => { try { return wildcardToRegExp(pattern).test(url); } catch { return false; } });
  if (excluded) return false;
  if (includes.length > 0) {
      const included = includes.some(pattern => { try { return wildcardToRegExp(pattern).test(url); } catch { return false; } });
      if (!included) return false;
  }
  if (matches.length > 0) {
      const matched = matches.some(pattern => { try { return matchPatternToRegExp(pattern).test(url); } catch { return false; } });
      if (!matched) return false;
  }
  if (includes.length === 0 && matches.length === 0) return true;
  return true;
}

function cleanScriptCode(rawCode) {
    if (typeof rawCode !== 'string' || !rawCode.trim()) {
        throw new Error('Invalid or empty script code provided.');
    }
    let potentialCode = rawCode.trim();
    let extractedCode = null;
    const markdownMatch = potentialCode.match(/```(?:javascript|js)?\s*([\s\S]*?)\s*```/);
    if (markdownMatch && markdownMatch[1] && markdownMatch[1].trim()) {
        // console.log("[cleanScriptCode] Extracted code from Markdown block.");
        extractedCode = markdownMatch[1].trim();
    } else {
        const userscriptHeaderIndex = potentialCode.indexOf('// ==UserScript==');
        if (userscriptHeaderIndex !== -1) {
            // console.log("[cleanScriptCode] Found UserScript header, extracting from there.");
            extractedCode = potentialCode.substring(userscriptHeaderIndex).trim();
        } else {
             // console.log("[cleanScriptCode] No Markdown or UserScript header found, assuming plain JS.");
             extractedCode = potentialCode;
        }
    }
    if (!extractedCode) throw new Error('Could not extract valid code.');
    const isUserscript = extractedCode.startsWith('// ==UserScript==');
    if (!isUserscript) {
        // console.log("[cleanScriptCode] Wrapping plain JavaScript code in IIFE.");
        try { new Function(extractedCode); }
        catch (e) { throw new Error(`Script syntax error: ${e.message}`); }
        extractedCode = `(function() {\n'use strict';\ntry {\n${extractedCode}\n} catch(e) {\nconsole.error('[aimonkey v1] Injected script error:', e);\n}\n})();`;
    } else {
         // console.log("[cleanScriptCode] Code identified as UserScript, using as is.");
    }
    return extractedCode;
}

async function executeScriptInTab(code, tabId) {
  if (!tabId) {
      console.error("[aimonkey v1 BG] executeScriptInTab requires a tabId.");
      return;
  }
  // console.log(`[aimonkey v1 BG] Attempting to execute script in tab ${tabId}`); // Noisy
  try {
    const cleanedCode = cleanScriptCode(code);
    // Inject engine first
    try {
        await chrome.scripting.executeScript({
            target: { tabId: tabId }, files: ['userscript.js'], world: "MAIN"
        });
    } catch (engineError) {
         if (!engineError.message.includes("Cannot access") && !engineError.message.includes("No tab")) {
            console.warn(`[aimonkey v1 BG] Failed to inject engine into tab ${tabId}:`, engineError.message);
         }
    }
    // Execute the script
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (scriptToExecute) => {
        try {
          const script = document.createElement('script');
          script.textContent = scriptToExecute;
          (document.head || document.documentElement).appendChild(script);
          script.remove();
          return { success: true };
        } catch (e) { console.error('[aimonkey v1 Content] Error executing script:', e); return { error: e.message }; }
      },
      args: [cleanedCode], world: "MAIN"
    });
    if (results[0]?.result?.error) throw new Error(`Script execution error: ${results[0].result.error}`);
    if (!results[0]?.result?.success) console.warn(`[aimonkey v1 BG] Script execution in tab ${tabId} did not report success.`);
  } catch (error) {
    console.error(`[aimonkey v1 BG] Failed to prepare/execute script on tab ${tabId}:`, error);
  }
}

async function executeScriptOnActiveTab(code) {
    let activeTab;
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) throw new Error('No active tab found.');
        if (!tab.id) throw new Error('Active tab has no ID.');
        if (!isValidUrlForInjection(tab.url)) throw new Error(`Cannot execute scripts on URL: ${tab.url}`);
        activeTab = tab;
    } catch (error) { console.error("[aimonkey v1 BG] Error getting active tab:", error); throw error; }
    console.log(`[aimonkey v1 BG] Executing script manually on active tab ${activeTab.id}`);
    await executeScriptInTab(code, activeTab.id);
}

// --- Initialization ---

async function initializeEngine() {
  console.log('[aimonkey v1 BG] Initializing engine via registerContentScripts...');
  try {
    try { await chrome.scripting.unregisterContentScripts({ ids: ['aimonkey-engine-v1'] }); } catch (e) { /* Ignore */ }
    await chrome.scripting.registerContentScripts([{
      id: 'aimonkey-engine-v1', js: ['userscript.js'], matches: ['<all_urls>'],
      runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true
    }]);
    console.log('[aimonkey v1 BG] Registered persistent content script.');
  } catch (error) { console.error('[aimonkey v1 BG] FATAL: Failed to register content script:', error); }
}

// Initialize API Key - Loads key into global 'apiKey' cache
async function initializeApiKey() {
    console.log('[aimonkey v1 BG] Initializing API key...'); // Log init attempt
    try {
        const result = await chrome.storage.local.get('deepseekApiKey');
        apiKey = result.deepseekApiKey || null; // Update cache
        console.log(`[aimonkey v1 BG] API key ${apiKey ? 'loaded' : 'not found'} on init.`);
    } catch (error) {
        console.error('[aimonkey v1 BG] Error loading API key:', error);
        apiKey = null; // Ensure cache is null on error
    }
}

// --- Event Listeners ---

chrome.runtime.onInstalled.addListener(async (details) => {
    console.log(`[aimonkey v1 BG] onInstalled event (${details.reason})`);
    await initializeApiKey(); // Load key on first install/update
    await initializeEngine();
});

chrome.runtime.onStartup.addListener(async () => {
    console.log('[aimonkey v1 BG] onStartup event');
    await initializeApiKey(); // Load key on browser start
    await initializeEngine(); // Ensure engine is registered
});

// Auto-Run Scripts Listener
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && isValidUrlForInjection(tab.url)) {
    if (activeTabs.has(tabId)) return;
    activeTabs.add(tabId);
    try {
      const { autoRunScripts = [], scripts = {} } = await chrome.storage.local.get(['autoRunScripts', 'scripts']);
      if (autoRunScripts.length > 0 && Object.keys(scripts).length > 0) {
        for (const scriptName of autoRunScripts) {
          const scriptCode = scripts[scriptName];
          if (scriptCode) {
            try {
              const metadata = parseMetadata(scriptCode);
              if (shouldRunOnUrl(metadata, tab.url)) {
                console.log(`[aimonkey v1 BG] Auto-running script "${scriptName}" on tab ${tabId}`);
                 await executeScriptInTab(scriptCode, tabId);
              }
            } catch (error) { console.error(`[aimonkey v1 BG] Error processing auto-run script "${scriptName}":`, error); }
          }
        }
      }
    } catch (error) { console.error(`[aimonkey v1 BG] Error during auto-run check for tab ${tabId}:`, error); }
    finally { setTimeout(() => activeTabs.delete(tabId), 100); }
  } else if (changeInfo.status === 'loading') { activeTabs.delete(tabId); }
});

// Port Connection Listener (Keep v1 logic)
chrome.runtime.onConnect.addListener((port) => {
  console.log(`[aimonkey v1 BG] Connection received from port: ${port.name}`);
  if (port.name === "deepseek_stream") {
    console.log("[aimonkey v1 BG] Port 'deepseek_stream' connected.");
    port.onMessage.addListener(async (request) => {
      console.log("[aimonkey v1 BG] Message received on port:", request.type);
      if (request.type === 'generateCodeStream') {
        console.log("[aimonkey v1 BG] Handling 'generateCodeStream' request via port.");
        let tabUrl = null, contextError = null;
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && isValidUrlForInjection(tab.url)) tabUrl = tab.url;
            else if (tab) contextError = `Cannot use context from protected URL: ${tab.url}`;
            else contextError = "Could not get active tab for context.";
        } catch (e) { contextError = `Error getting tab context: ${e.message}`; console.warn(`[aimonkey v1 BG] ${contextError}`); }
        let promptForAI = request.prompt;
        if (tabUrl) promptForAI += `\n\n[Current Page Context: ${tabUrl}]\n(...)`;
        else if (contextError) promptForAI += `\n\n[Context Note: ${contextError}]`;

        // *** Call generator (NO internal API key check needed here) ***
        generateCodeWithDeepSeek(promptForAI, (chunk) => {
          try { port.postMessage({ chunk }); } catch(e) { console.warn("Error posting chunk", e.message); }
        })
        .then(() => { try { port.postMessage({ done: true }); } catch(e) { /* Ignore */ } })
        .catch(error => { try { port.postMessage({ error: error.message }); } catch(e) { /* Ignore */ } });
      } else { console.warn("[aimonkey v1 BG] Unknown message type on port:", request.type); }
    });
    port.onDisconnect.addListener(() => {
      console.log("[aimonkey v1 BG] Port 'deepseek_stream' disconnected.");
      if (chrome.runtime.lastError) console.error("[aimonkey v1 BG] Port disconnect error:", chrome.runtime.lastError.message);
    });
  } else { console.warn("[aimonkey v1 BG] Unexpected port name:", port.name); }
});


// One-time Message Listener
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("[aimonkey v1 BG] One-time message received:", request.type);
  switch (request.type) {
    case 'executeScript':
      console.log("[aimonkey v1 BG] Handling 'executeScript' message.");
      executeScriptOnActiveTab(request.code)
        .then(() => { sendResponse({ success: true }); })
        .catch(error => { sendResponse({ error: error.message }); });
      return true;

    case 'setApiKey':
      console.log("[aimonkey v1 BG] Handling 'setApiKey' message.");
      apiKey = request.key; // Update cache immediately
      chrome.storage.local.set({ deepseekApiKey: request.key }, () => {
        if (chrome.runtime.lastError) {
            console.error("[aimonkey v1 BG] Error saving API key:", chrome.runtime.lastError);
            sendResponse({ error: chrome.runtime.lastError.message });
        } else {
            console.log("[aimonkey v1 BG] API key saved.");
            sendResponse({ success: true });
        }
      });
      return true;

    // *** MODIFIED: getApiKeyStatus reads directly from storage ***
    case 'getApiKeyStatus':
      console.log("[aimonkey v1 BG] Handling 'getApiKeyStatus' message.");
      // Always read from storage to ensure freshness for the popup
      chrome.storage.local.get('deepseekApiKey', (result) => {
         const currentKey = result.deepseekApiKey || null;
         apiKey = currentKey; // Sync local variable just in case
         console.log(`[aimonkey v1 BG] Responding to getApiKeyStatus: hasKey=${!!currentKey}`);
         sendResponse({ hasKey: !!currentKey });
      });
      return true; // Indicates async response

    case 'getDomSnapshot':
       console.log("[aimonkey v1 BG] Handling 'getDomSnapshot' message.");
       getDomSnapshotFromActiveTab()
         .then(snapshot => { sendResponse({ success: true, snapshot: snapshot }); })
         .catch(error => { sendResponse({ error: error.message }); });
       return true;

    default:
      console.warn("[aimonkey v1 BG] Received unknown message type:", request.type);
      sendResponse({ error: 'Unknown message type' });
      return false;
  }
});

// --- Core Functions ---

// Generate code using DeepSeek API with streaming
async function generateCodeWithDeepSeek(prompt, onChunk) {
  // *** REMOVED internal check/reload - rely on initialization and getApiKeyStatus sync ***
  if (!apiKey) {
    console.error('[aimonkey v1 BG] API key missing when generateCodeWithDeepSeek called!');
    throw new Error('DeepSeek API key not set. Please configure and try again.');
  }
  console.log('[aimonkey v1 BG] Generating code with API key...');

  try {
      const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: `Create a userscript that: ${prompt}\n\nScript should include proper metadata block and use modern JavaScript.` }],
          max_tokens: 2000, temperature: 0.7, stream: true
        })
      });

      if (!response.ok) {
        let errorDetails = `API request failed: ${response.status}`;
        try { const errorJson = await response.json(); errorDetails = errorJson.error?.message || JSON.stringify(errorJson); }
        catch (e) { errorDetails += ` - ${await response.text()}`; }
        console.error('[aimonkey v1 BG] API request failed:', errorDetails);
        // *** REMOVED 401 specific handling for simplicity now ***
        throw new Error(errorDetails);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.substring(6).trim();
            if (data === '[DONE]') return;
            try {
              const parsed = JSON.parse(data);
              if (parsed.choices?.[0]?.delta?.content) onChunk(parsed.choices[0].delta.content);
            } catch (err) { console.error('[aimonkey v1 BG] Error parsing stream chunk:', err, 'Chunk:', data); }
          }
        }
      }
  } catch (error) {
      console.error('[aimonkey v1 BG] Error during API call:', error);
      throw error; // Re-throw so message handler can catch it
  }
}

// Get DOM snapshot
async function getDomSnapshotFromActiveTab() {
    let activeTab;
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) throw new Error('No active tab found.');
        if (!tab.id) throw new Error('Active tab has no ID.');
        if (!isValidUrlForInjection(tab.url)) throw new Error(`Cannot access content of URL: ${tab.url}`);
        activeTab = tab;
    } catch (error) { console.error("[aimonkey v1 BG] Error getting active tab for snapshot:", error); throw error; }
    console.log(`[aimonkey v1 BG] Getting DOM snapshot from tab ${activeTab.id}`);
    try {
        const results = await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            func: () => {
                const MAX_LEN = 5000;
                const bodyHtml = document.body ? document.body.outerHTML : '';
                const truncatedBody = bodyHtml.length > MAX_LEN ? bodyHtml.substring(0, MAX_LEN) + '... [TRUNCATED]' : bodyHtml;
                return { title: document.title, url: document.location.href, bodyOuterHTML_truncated: truncatedBody };
            },
            world: "MAIN"
        });
        if (results?.[0]?.result) { console.log("[aimonkey v1 BG] DOM Snapshot retrieved."); return results[0].result; }
        else throw new Error("Failed to retrieve DOM snapshot from tab.");
    } catch (error) {
         console.error(`[aimonkey v1 BG] Failed to get DOM snapshot from tab ${activeTab.id}:`, error);
         if (error.message.includes("Cannot access") || error.message.includes("No tab")) throw new Error(`Cannot access tab content: ${error.message}`);
         throw new Error(`Snapshot script failed: ${error.message}`);
    }
}

console.log("[aimonkey v1 BG] Service worker started/restarted.");