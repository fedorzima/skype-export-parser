// parser.js

// Fetches and parses a JSON file from the given path
async function fetchJSON(path) {
  const resp = await fetch(path);
  if (!resp.ok) throw new Error('Failed to load ' + path);
  return await resp.json();
}

// Formats a date string to a human-readable string in US English locale
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleString('en-US');
}

// Escapes HTML special characters to prevent XSS in message content
function escapeHTML(str) {
  return str.replace(/[&<>"']/g, function (c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c];
  });
}

// Global variables for storing chat and message data
let allChats = [];      // Array of all chat objects
let chatMap = {};       // Map from chat ID to chat object
let messagesByChat = {}; // Map from chat ID to array of messages
let mediaFiles = {};    // Map from media filename to media file path
let MY_ID = null; // Will be set from messages.json

// Returns initials from a display name (e.g., 'John Doe' -> 'JD')
function getInitials(name) {
  if (!name) return '?';
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Returns a short preview of the last message in a chat
function getLastMessage(chat) {
  const msgs = messagesByChat[chat.id] || [];
  if (!msgs.length) return '';
  let last = msgs[msgs.length - 1];
  let text = last.content || '';
  // Remove HTML tags and extra spaces
  text = text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  if (!text) text = '[Attachment]';
  // Truncate if too long
  return text.length > 40 ? text.slice(0, 40) + '…' : text;
}

// Loads the media index from endpoints.json and populates mediaFiles
async function loadMediaIndex() {
  // Get the list of files in the media folder via endpoints.json (or generate the list)
  // For simplicity — try to load endpoints.json, if it exists
  try {
    const endpoints = await fetchJSON('endpoints.json');
    if (endpoints && endpoints.media) {
      for (const file of endpoints.media) {
        if (file.endsWith('.json')) {
          // Each media JSON contains metadata about a media file
          const meta = await fetchJSON('media/' + file);
          // Map the filename to the actual media file path
          mediaFiles[meta.filename] = 'media/' + file.replace('.json', '.' + meta.filename.split('.').pop());
        }
      }
    }
  } catch (e) {
    // If endpoints.json does not exist — do not load
  }
}

// Main entry point: loads data, indexes chats/messages, and renders the UI
async function main() {
  // 1. Load messages.json
  let data;
  try {
    data = await fetchJSON('messages.json');
  } catch (e) {
    document.getElementById('app').innerHTML = '<div style="margin:auto">Failed to load messages.json. Open index.html via a local server.</div>';
    return;
  }

  // Set MY_ID from userId in messages.json
  if (data && data.userId) {
    MY_ID = data.userId;
  }

  // 2. Index chats and messages from the loaded data
  let conversations = [];
  if (data && Array.isArray(data.conversations)) {
    conversations = data.conversations;
  } else if (Array.isArray(data)) {
    conversations = data;
  } else if (typeof data === 'object' && data !== null) {
    conversations = Object.values(data);
  }

  // Build chatMap and messagesByChat for fast access
  for (const chat of conversations) {
    if (chat && chat.id && Array.isArray(chat.MessageList)) {
      chatMap[chat.id] = chat;
      messagesByChat[chat.id] = chat.MessageList;
    } else if (chat && chat.conversationid) {
      if (!messagesByChat[chat.conversationid]) messagesByChat[chat.conversationid] = [];
      messagesByChat[chat.conversationid].push(chat);
      if (!chatMap[chat.conversationid]) {
        chatMap[chat.conversationid] = {
          id: chat.conversationid,
          displayName: chat.displayName || chat.conversationid
        };
      }
    }
  }
  allChats = Object.values(chatMap);

  // 3. Load media index for displaying images/files
  await loadMediaIndex();

  // 4. Render the chat list in the UI
  renderChatList();
}

// Renders the list of chats in the sidebar
function renderChatList() {
  const ul = document.getElementById('chat-list');
  ul.innerHTML = '';
  allChats.forEach((chat, idx) => {
    const li = document.createElement('li');
    // Avatar with initials
    const avatar = document.createElement('div');
    avatar.className = 'chat-avatar';
    avatar.textContent = getInitials(chat.displayName || chat.topic || chat.id);
    // Chat info (title and last message)
    const info = document.createElement('div');
    info.className = 'chat-info';
    const title = document.createElement('div');
    title.className = 'chat-title';
    title.textContent = chat.displayName || chat.topic || chat.id;
    const last = document.createElement('div');
    last.className = 'chat-last';
    last.textContent = getLastMessage(chat);
    info.appendChild(title);
    info.appendChild(last);
    li.appendChild(avatar);
    li.appendChild(info);
    // On click, show messages for this chat
    li.onclick = () => {
      document.querySelectorAll('#chat-list li').forEach(el => el.classList.remove('active'));
      li.classList.add('active');
      renderMessages(chat.id);
    };
    if (idx === 0) li.classList.add('active');
    ul.appendChild(li);
  });
  // Show messages for the first chat by default
  if (allChats.length) renderMessages(allChats[0].id);
}

// Renders all messages for a given chat
function renderMessages(chatId) {
  const msgs = messagesByChat[chatId] || [];
  const box = document.getElementById('messages');
  box.innerHTML = '';
  msgs.forEach(msg => {
    const isOwn = msg.from === MY_ID; // Is this message sent by the current user?
    const row = document.createElement('div');
    row.className = 'message-row ' + (isOwn ? 'own' : 'other');
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    // Show author only for messages not sent by the current user
    if (!isOwn) {
      const author = document.createElement('span');
      author.className = 'author';
      author.textContent = msg.displayName || msg.from || '';
      bubble.appendChild(author);
    }
    // Message content (may include HTML and images)
    let content = msg.content || '';
    // Replace links to images with <img> tags
    content = content.replace(/<a href=\"(https?:[^\"]+)\"[^>]*>[^<]*<\/a>/g, (m, url) => {
      if (url.match(/\.(jpg|jpeg|png|gif)$/i)) {
        return `<img src="${url}" alt="image" />`;
      }
      return `<a href="${url}" target="_blank">${url}</a>`;
    });
    // Insert images from media index if referenced
    const mediaMatch = content.match(/OriginalName v=\"([^\"]+)\"/);
    if (mediaMatch && mediaFiles[mediaMatch[1]]) {
      content += `<br><img src="${mediaFiles[mediaMatch[1]]}" alt="media" />`;
    }
    // Add message content to the bubble
    const cont = document.createElement('span');
    cont.innerHTML = content;
    bubble.appendChild(cont);
    // Add message time
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = formatDate(msg.originalarrivaltime || msg.version);
    bubble.appendChild(time);
    row.appendChild(bubble);
    box.appendChild(row);
  });
}

// Start the application
main(); 