/*!
 * evilaimonkey - A userscript manager with AI features
 *
 * Contains code derived from Violentmonkey:
 * Copyright (c) 2015-present, Violentmonkey Team
 *
 * This modified version is licensed under MIT License
 * Copyright (c) 2025 evilaimonkey Contributors
 */

// aimonkey v1 (AutoRun Fixed) - popup.js (URL Context + DOM Snapshot Prep)

console.log("popup.js script started execution.");

// Initialize simple editor
function initEditor() {
  const editorEl = document.getElementById('editor');
  editorEl.innerHTML = '';
  const textarea = document.createElement('textarea');
  textarea.id = 'scriptEditor';
  textarea.className = 'w-full h-full font-mono p-2 border border-gray-300 rounded box-border';
  textarea.spellcheck = false;
  textarea.value = `// ==UserScript== ... ==/UserScript== ...`; // Placeholder
  editorEl.appendChild(textarea);
  window.editor = {
    getValue: () => document.getElementById('scriptEditor')?.value || '',
    setValue: (code) => { const editor = document.getElementById('scriptEditor'); if (editor) editor.value = code; }
  };
  console.log("Editor initialized.");
}


let port = null; // Keep v1 port logic

// Function to establish or re-establish the port connection
function connectPort() {
    if (port) return; // Don't reconnect if exists
    console.log("[Popup v1] Attempting to connect port 'deepseek_stream'.");
    try {
        port = chrome.runtime.connect({ name: "deepseek_stream" });
        console.log("[Popup v1] Port connected:", port);
        port.onMessage.addListener(handleBackgroundMessage);
        port.onDisconnect.addListener(() => {
            console.error("[Popup v1] Port disconnected.");
            const errorMsg = chrome.runtime.lastError?.message || 'Unknown reason';
            console.error("[Popup v1] Disconnect reason:", errorMsg);
            const responseElement = document.getElementById('aiResponse');
            if(responseElement && !responseElement.textContent.includes("complete")) {
                responseElement.textContent = `Connection Error: ${errorMsg}. Reload required.`;
                responseElement.classList.remove('hidden');
            }
            port = null;
        });
    } catch (error) {
        console.error("[Popup v1] Error connecting port:", error);
        port = null;
        const responseElement = document.getElementById('aiResponse');
         if(responseElement) {
            responseElement.textContent = `Connection Error: ${error.message}. Reload required.`;
            responseElement.classList.remove('hidden');
         }
    }
}

// Load saved scripts and check API key status
document.addEventListener('DOMContentLoaded', async () => {
  console.log("DOMContentLoaded fired.");
  initEditor();
  await loadScripts();
  connectPort();

  // Add event listeners
  console.log("Adding event listeners...");
  document.getElementById('generateCodeBtn')?.addEventListener('click', generateCode);
  document.getElementById('saveApiKeyBtn')?.addEventListener('click', saveApiKey);
  document.getElementById('saveScript')?.addEventListener('click', handleSaveGeneratedScriptClick);
  document.getElementById('scriptList')?.addEventListener('click', handleScriptListClick);
  document.getElementById('saveEditedScript')?.addEventListener('click', handleSaveScriptClick);
  // *** ADDED: Listener for Analyze button ***
  document.getElementById('analyzePageBtn')?.addEventListener('click', analyzePage);


  // Check and display API key status
  console.log("Checking API key status...");
  try {
      const response = await chrome.runtime.sendMessage({ type: 'getApiKeyStatus' });
      const statusElement = document.getElementById('apiKeyStatus');
      if (statusElement) {
          if (response?.hasKey) statusElement.textContent = 'API key is configured';
          else statusElement.textContent = 'No API key configured';
          statusElement.className = `mt-2 text-sm ${response?.hasKey ? 'text-green-600' : 'text-red-600'}`;
      }
  } catch (error) {
      console.error("Error checking API key status:", error);
      const statusElement = document.getElementById('apiKeyStatus');
       if (statusElement) {
           statusElement.textContent = `Error checking status: ${error.message}`;
           statusElement.className = 'mt-2 text-sm text-red-600';
       }
  }

  await loadAutoRunStates();
});

// Save API key to background
async function saveApiKey() {
  console.log("saveApiKey called.");
  const apiKeyInput = document.getElementById('apiKeyInput');
  const statusElement = document.getElementById('apiKeyStatus');
  if (!apiKeyInput || !statusElement) return alert("UI error.");
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) return alert('Please enter an API key');

  console.log("Sending setApiKey message...");
  try {
    const response = await chrome.runtime.sendMessage({ type: 'setApiKey', key: apiKey });
    if (response?.success) {
        statusElement.textContent = 'API key saved successfully';
        statusElement.className = 'mt-2 text-sm text-green-600';
        apiKeyInput.value = '';
    } else {
        statusElement.textContent = `Failed to save API key: ${response?.error || 'Unknown'}`;
        statusElement.className = 'mt-2 text-sm text-red-600';
    }
  } catch (error) {
    console.error("Error sending setApiKey message:", error);
    statusElement.textContent = `Failed to save API key: ${error.message}`;
    statusElement.className = 'mt-2 text-sm text-red-600';
  }
}

// Generate code using DeepSeek API with streaming
async function generateCode() {
  console.log("generateCode function called.");
  const promptInput = document.getElementById('prompt');
  const responseElement = document.getElementById('aiResponse');
  const saveScriptBtn = document.getElementById('saveScript');
  if (!promptInput || !responseElement || !saveScriptBtn || !window.editor) return alert("UI error.");
  const prompt = promptInput.value.trim();
  if (!prompt) return alert('Please enter a prompt');

  responseElement.classList.remove('hidden');
  responseElement.textContent = 'Generating code...';
  saveScriptBtn.classList.add('hidden');
  window.editor.setValue(''); // Clear editor

  // Ensure port is connected
  if (!port) {
      console.log("[Popup v1] Port not connected. Reconnecting...");
      connectPort();
      await new Promise(resolve => setTimeout(resolve, 300)); // Give time to connect
      if (!port) {
          console.error("[Popup v1] Failed to establish port connection.");
          responseElement.textContent = 'Error: Could not connect to background service.';
          return;
      }
  }

  // Send message via the established port
  try {
    console.log("[Popup v1] Posting 'generateCodeStream' message...");
    // Background script now adds URL context automatically
    port.postMessage({ type: 'generateCodeStream', prompt: prompt });
    console.log("[Popup v1] Message posted.");
  } catch (error) {
    console.error("[Popup v1] Error posting message:", error);
    responseElement.textContent = `Error sending request: ${error.message}`;
    if (port) { try { port.disconnect(); } catch(e) {} port = null; }
  }
}

// Handler for messages from the background script via the port
function handleBackgroundMessage(msg) {
    const responseElement = document.getElementById('aiResponse');
    const saveScriptBtn = document.getElementById('saveScript');

    if (!responseElement || !saveScriptBtn || !window.editor) return;

    if (msg.chunk) {
        const currentCode = window.editor.getValue();
        window.editor.setValue(currentCode + msg.chunk);
        responseElement.textContent = window.editor.getValue(); // Mirror editor
        responseElement.scrollTop = responseElement.scrollHeight;
        responseElement.classList.remove('hidden');
        saveScriptBtn.classList.add('hidden');
    } else if (msg.error) {
        responseElement.textContent = `Error: ${msg.error}`;
        responseElement.classList.remove('hidden');
        saveScriptBtn.classList.add('hidden');
        window.editor.setValue(`// Error generating code:\n// ${msg.error}`);
    } else if (msg.done) {
        responseElement.textContent = 'Code generation complete. Review and save.';
        responseElement.classList.remove('hidden');
        saveScriptBtn.classList.remove('hidden');
        const finalCode = window.editor.getValue();
        if (!finalCode || finalCode.trim() === '') {
            window.editor.setValue('// No code generated.');
            responseElement.textContent = 'No code generated.';
        }
    }
}

// Handle save script click
function handleSaveScriptClick() {
  const code = window.editor.getValue();
  if (!code || code.trim() === '') return alert('Editor is empty.');
  let defaultName = 'New Script';
  const nameMatch = code.match(/^\/\/\s*@name\s+(.*)/m);
  if (nameMatch?.[1]?.trim()) defaultName = nameMatch[1].trim();
  const scriptName = prompt('Enter script name:', defaultName);
  if (scriptName) saveScript(scriptName, code);
}

// Specific handler for the "Save Generated Script" button
function handleSaveGeneratedScriptClick() {
    console.log("Save Generated Script button clicked.");
    handleSaveScriptClick();
}

// *** ADDED: Function to handle Analyze Page button click ***
async function analyzePage() {
    console.log("Analyze Page button clicked.");
    const analyzeBtn = document.getElementById('analyzePageBtn');
    const promptTextarea = document.getElementById('prompt');
    if (!analyzeBtn || !promptTextarea) return alert("UI Error: Cannot find analyze elements.");

    analyzeBtn.disabled = true;
    analyzeBtn.textContent = 'Analyzing...';

    try {
        const response = await chrome.runtime.sendMessage({ type: 'getDomSnapshot' });
        if (response?.error) {
            throw new Error(response.error);
        }
        if (response?.success && response.snapshot) {
            console.log("Received DOM snapshot:", response.snapshot);
            // Prepend snapshot info to the prompt textarea
            const snapshotText = `
--- Page Analysis ---
URL: ${response.snapshot.url}
Title: ${response.snapshot.title}
Body HTML (Truncated):
\`\`\`html
${response.snapshot.bodyOuterHTML_truncated}
\`\`\`
---------------------
`;
            promptTextarea.value = snapshotText + '\n' + promptTextarea.value;
            alert("Page analysis added to prompt!");
        } else {
            throw new Error("Invalid snapshot response from background.");
        }
    } catch (error) {
        console.error("Error getting DOM snapshot:", error);
        alert(`Failed to analyze page: ${error.message}`);
    } finally {
        analyzeBtn.disabled = false;
        analyzeBtn.textContent = 'Analyze Page Structure';
    }
}


// Load saved scripts list
async function loadScripts() {
  console.log("Loading scripts...");
  const scriptList = document.getElementById('scriptList');
  if (!scriptList) return console.error("Script list element not found!");
  scriptList.innerHTML = '<li>Loading scripts...</li>';
  try {
      const data = await chrome.storage.local.get(['scripts', 'autoRunScripts']);
      const scripts = data.scripts || {};
      const autoRunScripts = new Set(data.autoRunScripts || []);
      scriptList.innerHTML = '';
      console.log(`Found ${Object.keys(scripts).length} scripts.`);
      if (Object.keys(scripts).length === 0) return scriptList.innerHTML = '<li>No scripts saved yet.</li>';
      Object.entries(scripts).forEach(([name, code]) => {
          const li = document.createElement('li');
          li.className = 'flex justify-between items-center p-2 bg-gray-100 rounded mb-2 shadow-sm';
          li.dataset.name = name;
          const isChecked = autoRunScripts.has(name);
          li.innerHTML = `
            <div class="script-info flex items-center flex-grow mr-4 overflow-hidden">
              <input type="checkbox" class="auto-run-checkbox mr-2 flex-shrink-0" data-name="${name}" ${isChecked ? 'checked' : ''} title="Auto-run this script">
              <span class="script-name truncate font-medium" title="${name}">${name}</span>
            </div>
            <div class="script-actions flex-shrink-0">
              <button class="run-script bg-blue-500 hover:bg-blue-600 text-white px-2 py-1 rounded text-xs" data-name="${name}" title="Run script now">Run</button>
              <button class="delete-script bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded text-xs ml-1" data-name="${name}" title="Delete script">Delete</button>
            </div>`;
          scriptList.appendChild(li);
      });
      console.log("Scripts loaded into list.");
  } catch (error) { console.error("Error loading scripts:", error); scriptList.innerHTML = '<li>Error loading scripts.</li>'; }
}

// Save script to storage
async function saveScript(name, code) {
  console.log(`Saving script: ${name}`);
  try {
      const data = await chrome.storage.local.get('scripts');
      const scripts = data.scripts || {};
      scripts[name] = code;
      await chrome.storage.local.set({ scripts });
      console.log(`Script "${name}" saved successfully.`);
      await loadScripts();
      await loadAutoRunStates();
      alert(`Script "${name}" saved!`);
  } catch (error) { console.error(`Error saving script "${name}":`, error); alert(`Failed to save script: ${error.message}`); }
}

// Handle script list click events
async function handleScriptListClick(e) {
    const target = e.target;
    const scriptName = target.dataset.name;
    if (!scriptName) return;
    if (target.classList.contains('run-script')) {
        console.log(`Run clicked: ${scriptName}`);
        try {
            const { scripts } = await chrome.storage.local.get('scripts');
            if (scripts?.[scriptName]) {
                chrome.runtime.sendMessage({ type: 'executeScript', code: scripts[scriptName] }, response => {
                    if (chrome.runtime.lastError || response?.error) alert(`Error running script: ${chrome.runtime.lastError?.message || response?.error}`);
                });
            } else alert(`Script not found.`);
        } catch (error) { alert(`Error running script: ${error.message}`); }
    } else if (target.classList.contains('delete-script')) {
        console.log(`Delete clicked: ${scriptName}`);
        if (confirm(`Delete "${scriptName}"?`)) {
            try {
                const data = await chrome.storage.local.get(['scripts', 'autoRunScripts']);
                const scripts = data.scripts || {};
                let autoRunScripts = data.autoRunScripts || [];
                if (scripts[scriptName]) {
                    delete scripts[scriptName];
                    autoRunScripts = autoRunScripts.filter(n => n !== scriptName);
                    await chrome.storage.local.set({ scripts, autoRunScripts });
                    await loadScripts(); await loadAutoRunStates();
                } else alert(`Script not found.`);
            } catch (error) { alert(`Error deleting script: ${error.message}`); }
        }
    } else if (target.classList.contains('auto-run-checkbox')) {
        const isChecked = target.checked;
        console.log(`Auto-run "${scriptName}" changed to: ${isChecked}`);
        try {
            const data = await chrome.storage.local.get('autoRunScripts');
            let autoRunScripts = data.autoRunScripts || [];
            const alreadyExists = autoRunScripts.includes(scriptName);
            if (isChecked && !alreadyExists) autoRunScripts.push(scriptName);
            else if (!isChecked && alreadyExists) autoRunScripts = autoRunScripts.filter(n => n !== scriptName);
            if ((isChecked && !alreadyExists) || (!isChecked && alreadyExists)) {
                 await chrome.storage.local.set({ autoRunScripts });
                 console.log("Auto-run list updated.");
            }
        } catch (error) { alert(`Error updating auto-run: ${error.message}`); target.checked = !isChecked; }
    }
    // Note: Edit button functionality removed for simplicity
}

// Function to load and set checkbox states
async function loadAutoRunStates() {
    console.log("Loading auto-run states...");
    try {
        const { autoRunScripts = [] } = await chrome.storage.local.get('autoRunScripts');
        document.querySelectorAll('.auto-run-checkbox').forEach(checkbox => {
            checkbox.checked = autoRunScripts.includes(checkbox.dataset.name);
        });
        console.log("Auto-run states applied.");
    } catch (error) { console.error("Error loading auto-run states:", error); }
}