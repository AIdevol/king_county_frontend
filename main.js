// Set this to your current ngrok URL when exposing the API publicly.
const NGROK_API_BASE = "https://crinkliest-mirna-loftier.ngrok-free.dev";

// Use ngrok override first; otherwise same-origin/public and localhost fallbacks.
function getApiBase() {
  if (NGROK_API_BASE) return NGROK_API_BASE.replace(/\/+$/, "");

  try {
    const o = window.location;
    if (o.origin && !o.origin.startsWith("file:")) {
      if (o.hostname === "localhost" || o.hostname === "127.0.0.1") {
        if (o.port === "8000") return "";
        return "http://127.0.0.1:8000";
      }
      if (o.port && o.port !== "8000") return `${o.protocol}//${o.hostname}:8000`;
      return "";
    }
  } catch (e) {}
  return "http://127.0.0.1:8000";
}
const API_BASE = getApiBase();
const CONVERSATIONS_KEY = "chat_conversations";
const LAST_CONVERSATION_ID_KEY = "chat_last_conversation_id";
const SAVE_HISTORY_CHECKED_KEY = "save_history_checked";
const USER_NAME_KEY = "chat_user_name";

function $(id) {
  return document.getElementById(id);
}

let chatHistory = [];
let conversations = [];
let currentConversationId = null;

function isSaveHistoryChecked() {
  const el = $("save-history-check");
  return el ? el.checked : false;
}

function persistSaveHistoryPreference(checked) {
  try {
    localStorage.setItem(SAVE_HISTORY_CHECKED_KEY, JSON.stringify(!!checked));
  } catch (e) {}
}

function setChatStatus(state, text) {
  const dot = $("status-dot");
  const label = $("chat-status-text");
  if (dot) {
    dot.className = "status-dot " + (state === "error" ? "error" : "idle");
  }
  if (label) label.textContent = text;
}

function toggleEmptyState() {
  const empty = $("chat-empty");
  if (empty) empty.style.display = chatHistory.length === 0 ? "flex" : "none";
}

function generateId() {
  return "id_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
}

function getConversationTitle(messages) {
  const firstUser = messages.find((m) => m.role === "user");
  if (!firstUser || typeof firstUser.content !== "string") return "New chat";
  const t = firstUser.content.replace(/\s+/g, " ").trim().slice(0, 36);
  return (t.length < firstUser.content.trim().length ? t + "…" : t) || "New chat";
}

/** Persist assistant table messages (cap rows for localStorage size). */
const MAX_TABLE_ROWS_STORED = 400;

function cloneContextsForHistory(contexts) {
  if (!Array.isArray(contexts)) return [];
  const slice = contexts.slice(0, MAX_TABLE_ROWS_STORED);
  try {
    return JSON.parse(JSON.stringify(slice));
  } catch (e) {
    return slice.map((c) => ({
      row_index: c && c.row_index,
      metadata: c && c.metadata && typeof c.metadata === "object" ? { ...c.metadata } : {},
      text: c && c.text,
    }));
  }
}

function messageToPersistPayload(m) {
  const o = {
    role: m.role,
    content: m.content || "",
    attachedFileName: m.attachedFileName,
  };
  if (m.kind === "table" && Array.isArray(m.tableContexts)) {
    o.kind = "table";
    o.tableContexts = m.tableContexts.slice(0, MAX_TABLE_ROWS_STORED);
  }
  return o;
}

function messageFromStorage(m) {
  if (!m || !m.role) return null;
  const o = {
    role: m.role,
    content: m.content || "",
    attachedFileName: m.attachedFileName,
  };
  if (m.kind === "table" && Array.isArray(m.tableContexts) && m.tableContexts.length) {
    o.kind = "table";
    o.tableContexts = m.tableContexts;
  }
  return o;
}

function loadConversationsFromStorage() {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_KEY);
    conversations = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(conversations)) conversations = [];
  } catch (e) {
    conversations = [];
  }
}

function saveConversationsToStorage() {
  if (!isSaveHistoryChecked()) return;
  try {
    localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
  } catch (e) {}
}

function renderSidebarHistory() {
  const list = $("sidebar-history-list");
  if (!list) return;
  list.innerHTML = "";
  for (const c of conversations) {
    if (!c || !c.id || !c.title) continue;
    const item = document.createElement("button");
    item.type = "button";
    item.className = "history-item" + (c.id === currentConversationId ? " active" : "");
    item.textContent = c.title;
    item.dataset.conversationId = c.id;
    item.addEventListener("click", () => selectConversation(c.id));
    list.appendChild(item);
  }
}

function selectConversation(id) {
  const convo = conversations.find((c) => c.id === id);
  if (!convo || !Array.isArray(convo.messages)) return;
  currentConversationId = id;
  chatHistory = convo.messages.map(messageFromStorage).filter(Boolean);

  const list = $("chat-messages");
  if (list) list.innerHTML = "";
  for (const m of chatHistory) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (m.kind === "table" && Array.isArray(m.tableContexts)) {
      appendAssistantTableInChat(m.content || "Structured data", m.tableContexts, { skipHistory: true });
    } else {
      renderMessageOnly(m.role, m.content, m.attachedFileName);
    }
  }
  const scrollEl = $("chat-view");
  if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  toggleEmptyState();
  renderSidebarHistory();
  try {
    localStorage.setItem(LAST_CONVERSATION_ID_KEY, id);
  } catch (e) {}
}

function renderMessageOnly(role, content, attachedFileName) {
  const list = $("chat-messages");
  const empty = $("chat-empty");
  if (empty) empty.style.display = "none";

  const block = document.createElement("div");
  block.className = "message-block " + role;
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "user" ? "You" : "AI";
  const body = document.createElement("div");
  body.className = "message-content";
  body.textContent = content;
  // File is shown once in the "Selected:" bar above the input; do not repeat it under every message.
  block.appendChild(avatar);
  block.appendChild(body);
  list.appendChild(block);
}

function renderMessage(role, content, attachedFileName) {
  renderMessageOnly(role, content, attachedFileName);
  const scrollEl = $("chat-view");
  if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  persistCurrentConversation();
  renderSidebarHistory();
}

function persistCurrentConversation() {
  if (!chatHistory.length) return;
  const title = getConversationTitle(chatHistory);
  if (currentConversationId) {
    const convo = conversations.find((c) => c.id === currentConversationId);
    if (convo) {
      convo.title = title;
      convo.messages = chatHistory.map(messageToPersistPayload);
    }
  } else {
    currentConversationId = generateId();
    conversations.unshift({
      id: currentConversationId,
      title,
      messages: chatHistory.map(messageToPersistPayload),
    });
  }
  saveConversationsToStorage();
  try {
    localStorage.setItem(LAST_CONVERSATION_ID_KEY, currentConversationId);
  } catch (e) {}
}

function clearChat() {
  if (chatHistory.length && currentConversationId) {
    const convo = conversations.find((c) => c.id === currentConversationId);
    const messages = chatHistory.map(messageToPersistPayload);
    if (convo) {
      convo.messages = messages;
      convo.title = getConversationTitle(chatHistory);
    } else {
      conversations.unshift({
        id: currentConversationId,
        title: getConversationTitle(chatHistory),
        messages,
      });
    }
    saveConversationsToStorage();
  }

  chatHistory = [];
  currentConversationId = null;
  try {
    localStorage.removeItem(LAST_CONVERSATION_ID_KEY);
  } catch (e) {}

  const list = $("chat-messages");
  if (list) list.innerHTML = "";
  toggleEmptyState();
  renderSidebarHistory();
}

function appendMessage(role, content, attachedFileName) {
  chatHistory.push({ role, content, attachedFileName });
  renderMessage(role, content, attachedFileName);
}

/** Show long messages immediately; use typewriter for shorter ones. */
const TYPEWRITER_THRESHOLD = 1200;

/**
 * Appends an assistant message with a typewriter effect (or immediately for long content).
 * Calls onComplete(messageBlock) when finished, where messageBlock is the DOM element.
 */
function appendMessageWithTypewriter(content, delayMs = 18, onComplete = () => {}) {
  const list = $("chat-messages");
  const empty = $("chat-empty");
  if (empty) empty.style.display = "none";

  const block = document.createElement("div");
  block.className = "message-block assistant";
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = "AI";
  const body = document.createElement("div");
  body.className = "message-content";
  block.appendChild(avatar);
  block.appendChild(body);
  list.appendChild(block);
  const scrollEl = $("chat-view");

  const fullText = content || "(no answer returned)";

  function scrollToBottom() {
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  function finish() {
    chatHistory.push({ role: "assistant", content: fullText });
    persistCurrentConversation();
    renderSidebarHistory();
    try {
      onComplete(block);
    } catch (e) {
      console.error("onComplete callback failed", e);
    }
  }

  if (fullText.length > TYPEWRITER_THRESHOLD) {
    body.textContent = fullText;
    scrollToBottom();
    finish();
    return;
  }

  let index = 0;
  scrollToBottom();

  function tick() {
    if (index < fullText.length) {
      body.textContent = fullText.slice(0, index + 1);
      index += 1;
      scrollToBottom();
      setTimeout(tick, delayMs);
    } else {
      finish();
    }
  }
  tick();
}

// Lightweight currency formatting shared by charts.
function formatCurrency(n) {
  if (n == null || isNaN(Number(n))) return String(n);
  const v = Number(n);
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return "$" + (v / 1e3).toFixed(0) + "k";
  return "$" + v.toLocaleString();
}

/**
 * Render inline charts (inside the chat message) when contexts look like KPI/aggregation output.
 * For now we support:
 * - Average land value by location: columns [location, avg_land_value, total_properties?].
 */
function renderInlineChartsFromContexts(messageBlock, contexts, questionText) {
  if (!messageBlock || !Array.isArray(contexts) || contexts.length === 0) return;
  if (typeof Chart === "undefined") return;

  const body = messageBlock.querySelector(".message-content");
  if (!body) return;

  const rows = contexts
    .map((c) => c && c.metadata)
    .filter((m) => m && typeof m === "object");
  if (!rows.length) return;

  const keySet = new Set();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      keySet.add(String(k).toLowerCase());
    }
  }

  const hasLocation = keySet.has("location");
  const hasAvgLandValue = keySet.has("avg_land_value");

  if (!hasLocation || !hasAvgLandValue) {
    return;
  }

  // Normalise and sort by avg_land_value desc, limit to 15 locations.
  const normRows = rows
    .map((r) => {
      const loc = r.location != null ? String(r.location) : "";
      const avg = Number(r.avg_land_value != null ? r.avg_land_value : r.Avg_Land_Value);
      const count =
        r.total_properties != null
          ? Number(r.total_properties)
          : r.count != null
          ? Number(r.count)
          : null;
      return { location: loc, avg_land_value: isNaN(avg) ? 0 : avg, total_properties: count };
    })
    .filter((r) => r.location);

  if (!normRows.length) return;

  normRows.sort((a, b) => b.avg_land_value - a.avg_land_value);
  const items = normRows.slice(0, 15);

  const wrapper = document.createElement("div");
  wrapper.className = "inline-charts";

  const titleEl = document.createElement("div");
  titleEl.className = "inline-charts-title";
  titleEl.textContent = "Average land value by location";
  wrapper.appendChild(titleEl);

  const canvas = document.createElement("canvas");
  wrapper.appendChild(canvas);
  body.appendChild(wrapper);

  const labels = items.map((x) => x.location);
  const values = items.map((x) => x.avg_land_value);

  // eslint-disable-next-line no-undef
  new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Avg land value",
          data: values,
          backgroundColor: "rgba(59, 130, 246, 0.7)",
          borderColor: "rgb(59, 130, 246)",
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => formatCurrency(ctx.raw),
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (v) => formatCurrency(v),
          },
        },
      },
    },
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, "UTF-8");
  });
}

/** Build scrollable table element for in-chat display */
function createChatTableElementFromContexts(contexts) {
  const metaRows = (contexts || [])
    .map((c) => c && c.metadata)
    .filter((m) => m && typeof m === "object");
  if (!metaRows.length) return null;

  const headerSet = new Set();
  for (const row of metaRows) {
    for (const k of Object.keys(row)) headerSet.add(String(k));
  }
  const headers = Array.from(headerSet);
  if (!headers.length) return null;

  const scroll = document.createElement("div");
  scroll.className = "chat-table-scroll";
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  const trHead = document.createElement("tr");
  for (const h of headers) {
    const th = document.createElement("th");
    th.textContent = h;
    trHead.appendChild(th);
  }
  thead.appendChild(trHead);
  for (const row of metaRows) {
    const tr = document.createElement("tr");
    for (const h of headers) {
      const td = document.createElement("td");
      td.textContent = row[h] != null ? String(row[h]) : "";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(thead);
  table.appendChild(tbody);
  scroll.appendChild(table);
  return scroll;
}

/**
 * Append assistant message with inline table (part of scrollable chat; stays in history).
 * @param {string} intro - Short label e.g. row count
 * @param {Array} contexts - API contexts with metadata
 * @param {{ skipHistory?: boolean }} options - skipHistory when re-rendering from storage
 */
function appendAssistantTableInChat(intro, contexts, options = {}) {
  const { skipHistory = false } = options;
  const list = $("chat-messages");
  if (!list) return;
  const empty = $("chat-empty");
  if (empty) empty.style.display = "none";

  const block = document.createElement("div");
  block.className = "message-block assistant";
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = "AI";
  const body = document.createElement("div");
  body.className = "message-content";

  const label = document.createElement("div");
  label.className = "chat-table-label";
  label.textContent = intro || "Structured data";
  body.appendChild(label);

  const tblWrap = createChatTableElementFromContexts(contexts);
  if (tblWrap) {
    body.appendChild(tblWrap);
  } else {
    const p = document.createElement("p");
    p.style.fontSize = "13px";
    p.style.color = "var(--text-secondary)";
    p.style.margin = "0";
    p.textContent = "No tabular rows to display.";
    body.appendChild(p);
  }

  block.appendChild(avatar);
  block.appendChild(body);
  list.appendChild(block);

  const scrollEl = $("chat-view");
  if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;

  if (!skipHistory) {
    chatHistory.push({
      role: "assistant",
      content: intro || "Structured data",
      kind: "table",
      tableContexts: cloneContextsForHistory(contexts),
    });
    persistCurrentConversation();
    renderSidebarHistory();
  }
  toggleEmptyState();
}

async function sendChat() {
  const input = $("chat-input");
  const fileInput = $("file-input");
  const selectedFileBar = $("selected-file-bar");
  const text = input.value.trim();
  if (!text) {
    setChatStatus("error", "Please enter a message first.");
    return;
  }

  // Capture file once at send time (so we use the same reference and don't lose it)
  const file = fileInput && fileInput.files && fileInput.files[0];
  const hasFileUi = selectedFileBar && selectedFileBar.classList.contains("visible");
  if (hasFileUi && !file) {
    setChatStatus("error", "File was cleared. Please select your file again.");
    return;
  }

  appendMessage("user", text, file ? file.name : undefined);
  input.value = "";

  // Build conversation history (all messages before this one) so the agent understands question type and prior questions
  const historyForApi = chatHistory
    .slice(0, -1)
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: (m.content || "").trim() }))
    .filter((m) => m.content.length > 0);

  const userName = ($("user-name-input") && $("user-name-input").value || "").trim();

  $("chat-send").disabled = true;
  setChatStatus("idle", "Thinking…");

  try {
    let res;
    if (file) {
      const formData = new FormData();
      formData.append("question", text);
      formData.append("top_k", "5");
      formData.append("file", file);
      if (historyForApi.length > 0) {
        formData.append("conversation_history", JSON.stringify(historyForApi));
      }
      if (userName) formData.append("user_name", userName);
      // Do not set Content-Type or other headers: browser must set multipart/form-data; boundary=...
      res = await fetch(`${API_BASE}/v1/dataset-rag/query`, {
        method: "POST",
        headers: {},
        body: formData,
      });
    } else {
      const body = { question: text, top_k: 5 };
      if (historyForApi.length > 0) body.conversation_history = historyForApi;
      if (userName) body.user_name = userName;
      res = await fetch(`${API_BASE}/v1/dataset-rag/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    if (!res.ok) {
      const msg = await res.text();
      throw new Error(`HTTP ${res.status}: ${msg}`);
    }

    const data = await res.json();
    let answerText = (data.answer || "").trim() || "I couldn't find matching data for that question.";
    if (/data not available in the (dataset|table)|no relevant rows were found/i.test(answerText)) {
      answerText = "I couldn't find matching data for that question.";
    }

    const hasContexts = Array.isArray(data.contexts) && data.contexts.length > 0;
    const wantsTableOnly =
      /\btable\s+view\b/i.test(text) ||
      /\btable\s+only\b/i.test(text) ||
      /\bonly\s+table\b/i.test(text) ||
      /\bspreadsheet\b/i.test(text) ||
      /\btable\s+format\b/i.test(text) ||
      /\btabular\b/i.test(text) ||
      /\btable\s*data\b/i.test(text) ||
      /\b\d+\s*(?:table|data|rows?)\b/i.test(text) ||
      (hasContexts && /\b(?:give me|show me|get me|list|fetch)\s*(?:the\s+)?\d+\s*(?:table|data|rows?)?/i.test(text));

    // Show table when user asks for table/data/rows or when response is "Showing N rows" with contexts.
    const answerIsRowList = /^Showing\s+\d+\s+rows:/i.test((data.answer || "").trim());
    const showTable = hasContexts && (wantsTableOnly || answerIsRowList);

    if (showTable) {
      setChatStatus("idle", "Ready");
      const rowCount = data.contexts.length;
      appendAssistantTableInChat(`Structured data · ${rowCount} row${rowCount !== 1 ? "s" : ""}`, data.contexts);
      return;
    }

    const wantsExcelDownload =
      /\b(xlsx|excel|spreadsheet)\b/i.test(text) ||
      /\b(download|export)\s+(xlsx|excel|spreadsheet)\b/i.test(text);

    const looksLikeCsv =
      typeof answerText === "string" &&
      answerText.includes("\n") &&
      /[,;\t]/.test(answerText.split("\n", 1)[0] || "");

    if (wantsExcelDownload && looksLikeCsv) {
      // Trigger a client-side download that can be opened in Excel.
      triggerDownloadFromText(answerText, "dataset_export.xlsx");
      setChatStatus("idle", "Ready");
      appendMessage("assistant", "I’ve prepared the data as an Excel-ready file and started the download.");
      return;
    }

    setChatStatus("idle", "Writing…");
    appendMessageWithTypewriter(answerText, 18, (block) => {
      try {
        if (Array.isArray(data.contexts) && data.contexts.length > 0) {
          renderInlineChartsFromContexts(block, data.contexts, text);
        }
      } catch (e) {
        console.error("Failed to render inline charts", e);
      }
      setChatStatus("idle", "Ready");
    });
  } catch (err) {
    console.error(err);
    appendMessage("assistant", `Error: ${(err && err.message) || String(err)}`);
    setChatStatus("error", "Error");
  } finally {
    $("chat-send").disabled = false;
  }
}

function triggerDownloadFromText(text, filename) {
  try {
    const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Failed to trigger download", e);
  }
}

function main() {
  loadConversationsFromStorage();

  const saveHistoryCheck = $("save-history-check");
  if (saveHistoryCheck) {
    try {
      const saved = localStorage.getItem(SAVE_HISTORY_CHECKED_KEY);
      if (saved !== null) saveHistoryCheck.checked = JSON.parse(saved);
    } catch (e) {}
    saveHistoryCheck.addEventListener("change", () => {
      persistSaveHistoryPreference(saveHistoryCheck.checked);
      if (saveHistoryCheck.checked) saveConversationsToStorage();
    });
  }

  if (isSaveHistoryChecked()) {
    const lastId = localStorage.getItem(LAST_CONVERSATION_ID_KEY);
    const convo = lastId && conversations.find((c) => c.id === lastId);
    if (convo) selectConversation(convo.id);
  }

  const userNameInput = $("user-name-input");
  if (userNameInput) {
    try {
      const saved = localStorage.getItem(USER_NAME_KEY);
      if (saved != null) userNameInput.value = saved;
    } catch (e) {}
    userNameInput.addEventListener("blur", () => {
      try {
        localStorage.setItem(USER_NAME_KEY, (userNameInput.value || "").trim());
      } catch (e) {}
    });
    userNameInput.addEventListener("input", () => {
      try {
        localStorage.setItem(USER_NAME_KEY, (userNameInput.value || "").trim());
      } catch (e) {}
    });
  }

  toggleEmptyState();
  renderSidebarHistory();

  const newChatBtn = $("new-chat-btn");
  if (newChatBtn) newChatBtn.addEventListener("click", clearChat);

  // Mobile: toggle sidebar (history drawer)
  const sidebarToggle = $("sidebar-toggle");
  const sidebarEl = document.querySelector(".app-sidebar");
  const sidebarClose = $("sidebar-close");
  if (sidebarToggle && sidebarEl) {
    // Show the toggle button only on small screens via JS as well (defensive).
    function updateToggleVisibility() {
      sidebarToggle.style.display = window.innerWidth <= 768 ? "inline-flex" : "none";
      if (window.innerWidth > 768) {
        sidebarEl.classList.remove("open");
      }
    }
    updateToggleVisibility();
    window.addEventListener("resize", updateToggleVisibility);
    sidebarToggle.addEventListener("click", () => {
      sidebarEl.classList.toggle("open");
    });
    if (sidebarClose) {
      sidebarClose.addEventListener("click", () => {
        sidebarEl.classList.remove("open");
      });
    }
  }

  const fileInput = $("file-input");
  const fileTrigger = $("file-trigger");

  const selectedFileBar = $("selected-file-bar");
  const selectedFileNameEl = $("selected-file-name");
  const clearFileBtn = $("clear-file-btn");

  if (fileTrigger && fileInput) {
    fileTrigger.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      fileTrigger.classList.toggle("has-file", !!file);
      if (selectedFileBar) selectedFileBar.classList.toggle("visible", !!file);
      if (selectedFileNameEl) selectedFileNameEl.textContent = file ? file.name : "";
    });
  }

  if (clearFileBtn && fileInput) {
    clearFileBtn.addEventListener("click", () => {
      fileInput.value = "";
      fileTrigger.classList.remove("has-file");
      if (selectedFileBar) selectedFileBar.classList.remove("visible");
      if (selectedFileNameEl) selectedFileNameEl.textContent = "";
    });
  }

  $("chat-send").addEventListener("click", sendChat);
  $("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });
}

document.addEventListener("DOMContentLoaded", main);
