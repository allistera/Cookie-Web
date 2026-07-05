// Gmail AI Inbox - Application Logic

// Initial State Definition
const state = {
  todos: [
    {
      id: "todo-kitchen",
      title: "Kitchen Renovation",
      description: "A reply to the tile vendor is due, confirming selection so they can order in time to have it installed by the contractor's timeline.",
      from: ["Email"],
      btnText: "Reply",
      btnIcon: "edit",
      action: "open-reply",
      visible: true,
      completed: false
    },
    {
      id: "todo-waiver",
      title: "RSVP for College Tour",
      description: "The University of State sent a confirmation for the June 12th tour. You need to sign the digital waiver for your daughter.",
      from: ["Email"],
      btnText: "View",
      btnIcon: "mail",
      action: "open-waiver",
      visible: true,
      completed: false
    },
    {
      id: "todo-soccer",
      title: "Bring snack to soccer practice",
      description: "Coach Mike reminded you it's your turn to bring snacks for 20 people tomorrow and to log what you're bringing; one child has a peanut allergy.",
      from: ["Email", "Sheet"],
      btnText: "Open",
      btnIcon: "table_chart",
      action: "open-sheet",
      visible: true,
      completed: false
    },
    {
      id: "todo-marketplace",
      title: "Resale Marketplace Sale",
      description: "Resale Marketplace has notified you that the baby winter coat bundle is now marked as sold for $15. You need to contact buyer within 3 days.",
      from: ["Email"],
      btnText: "Open",
      btnIcon: "link",
      action: "open-marketplace",
      visible: false,
      completed: false
    },
    {
      id: "todo-chicago",
      title: "Chicago Summer Trip",
      description: "Confirm your upgrade to the Deluxe room at the Palm House by Tuesday. The hotel has updated your reservation details.",
      from: ["Email"],
      btnText: "View",
      btnIcon: "mail",
      action: "open-chicago",
      visible: false,
      completed: false
    }
  ],
  traditionalEmails: [
    { id: 1, sender: "City Construction", subject: "Revised Floor Plan - Natural Light adjustments", snippet: "Hi Rose, following up on our call yesterday, we modified the bay window design...", date: "10:04 AM", unread: true, starred: false },
    { id: 2, sender: "Homeowner's Insurance", subject: "Claim #99281 - Processing Update", snippet: "We are pleased to inform you that your insurance claim has been processed. You will hear...", date: "9:42 AM", unread: true, starred: true },
    { id: 3, sender: "Coach Mike", subject: "Soccer Snacks - June 6th Scrimmage", snippet: "Hey parents, just a reminder that tomorrow we play the Green Eagles. Rose has snacks...", date: "Yesterday", unread: true, starred: false },
    { id: 4, sender: "Univ of State Tours", subject: "Confirmation: June 12th guided tour", snippet: "Thank you for scheduling a campus visit. Please complete the waiver in the link...", date: "Yesterday", unread: false, starred: false },
    { id: 5, sender: "Resale Marketplace", subject: "Item Sold! Baby winter coat bundle", snippet: "Congratulations, your listing was purchased for $15. Print the label and mail...", date: "Jun 3", unread: true, starred: false },
    { id: 6, sender: "Palm House Hotel", subject: "Your reservation upgrade is confirmed", snippet: "Dear Rose, we have upgraded your room to Deluxe. Click here to see detail...", date: "Jun 2", unread: false, starred: true },
    { id: 7, sender: "Sarah Miller", subject: "RE: Neighborhood Block Party", snippet: "I can bring the paper plates and napkins! Do we need cups too?", date: "May 30", unread: false, starred: false },
    { id: 8, sender: "Electric Co.", subject: "Your May billing statement is ready", snippet: "Account ending in 4991. Total due: $112.40. Auto-pay will process on...", date: "May 28", unread: false, starred: false },
    { id: 9, sender: "Netflix", subject: "New Shows for June 2026", snippet: "Here is your curated list of movies and television series launching this month...", date: "May 27", unread: false, starred: false },
    { id: 10, sender: "Lincoln High", subject: "FAFSA Deadlines and College Prep guidance", snippet: "Parents of juniors, the FAFSA deadline has been shifted. Please review the new calendar...", date: "May 25", unread: false, starred: false },
    { id: 11, sender: "Target Shop", subject: "20% Off Patio Furniture this weekend only", snippet: "Upgrade your backyard space before summer begins. Exclusions apply...", date: "May 24", unread: false, starred: false },
    { id: 12, sender: "Lincoln Counselors", subject: "Scholarships for the Arts program", snippet: "We noticed your daughter's excellent fine arts GPA. She may qualify for...", date: "May 22", unread: false, starred: false },
    { id: 13, sender: "Resale Marketplace", subject: "Inquiry: Toddler shoe lot availability", snippet: "A buyer sent a message: Is the lot of shoes still available for pickup?", date: "May 20", unread: false, starred: false },
    { id: 14, sender: "Zoom Video", subject: "Invoice for subscription renewal", snippet: "Your annual Zoom Pro subscription has renewed. Amount charged: $149.90...", date: "May 19", unread: false, starred: false }
  ]
};

// DOM Elements cache
const dom = {
  todoRowsContainer: document.getElementById("todoRowsContainer"),
  todoCounter: document.getElementById("todoCounter"),
  showMoreTodosBtn: document.getElementById("showMoreTodosBtn"),
  showMoreText: document.getElementById("showMoreText"),
  
  // Navigation
  navInbox: document.getElementById("navInbox"),
  navAIInbox: document.getElementById("navAIInbox"),
  aiInboxView: document.getElementById("aiInboxView"),
  traditionalInboxView: document.getElementById("traditionalInboxView"),
  emailListContainer: document.getElementById("emailListContainer"),
  inboxCount: document.getElementById("inboxCount"),
  
  // Header controls
  themeToggleBtn: document.getElementById("themeToggleBtn"),
  refreshBtn: document.getElementById("refreshBtn"),
  refreshIcon: document.getElementById("refreshIcon"),
  statusTime: document.getElementById("statusTime"),
  
  // Search
  searchBarContainer: document.getElementById("searchBarContainer"),
  searchInput: document.getElementById("searchInput"),
  searchClearBtn: document.getElementById("searchClearBtn"),
  searchSuggestions: document.getElementById("searchSuggestions"),
  geminiChatDrawer: document.getElementById("geminiChatDrawer"),
  closeDrawerBtn: document.getElementById("closeDrawerBtn"),
  drawerContent: document.getElementById("drawerContent"),
  drawerInput: document.getElementById("drawerInput"),
  drawerSendBtn: document.getElementById("drawerSendBtn"),
  
  // Sheets Modal
  sheetsModal: document.getElementById("sheetsModal"),
  saveSheetBtn: document.getElementById("saveSheetBtn"),
  
  // Waiver Modal
  waiverModal: document.getElementById("waiverModal"),
  signatureCanvas: document.getElementById("signatureCanvas"),
  clearCanvasBtn: document.getElementById("clearCanvasBtn"),
  signWaiverBtn: document.getElementById("signWaiverBtn"),
  
  // Composer Toast
  composerToast: document.getElementById("composerToast"),
  closeComposerBtn: document.getElementById("closeComposerBtn"),
  sendComposerBtn: document.getElementById("sendComposerBtn"),
  composerHelpWriteBtn: document.getElementById("composerHelpWriteBtn"),
  composerTextArea: document.getElementById("composerTextArea"),
  geminiDraftBox: document.querySelector(".composer-gemini-box"),
  geminiDraftPreview: document.getElementById("geminiDraftPreview"),
  insertComposerBtn: document.getElementById("insertComposerBtn"),
  refineComposerBtn: document.getElementById("refineComposerBtn")
};

// Canvas variables
let canvasCtx = null;
let isDrawing = false;

// 1. Theme Toggle Setup
dom.themeToggleBtn.addEventListener("click", () => {
  const currentTheme = document.documentElement.getAttribute("data-theme");
  const newTheme = currentTheme === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", newTheme);
  
  const icon = dom.themeToggleBtn.querySelector(".material-symbols-outlined");
  icon.textContent = newTheme === "dark" ? "light_mode" : "dark_mode";
});

// 2. Navigation Tab Switches
dom.navInbox.addEventListener("click", (e) => {
  e.preventDefault();
  dom.navAIInbox.classList.remove("active");
  dom.navInbox.classList.add("active");
  dom.aiInboxView.classList.remove("active");
  dom.traditionalInboxView.classList.add("active");
  renderTraditionalInbox();
});

dom.navAIInbox.addEventListener("click", (e) => {
  e.preventDefault();
  dom.navInbox.classList.remove("active");
  dom.navAIInbox.classList.add("active");
  dom.traditionalInboxView.classList.remove("active");
  dom.aiInboxView.classList.add("active");
  renderTodos();
});

// 3. Render suggested to-dos
function renderTodos() {
  dom.todoRowsContainer.innerHTML = "";
  
  // Get todos that are visible and active
  const activeTodos = state.todos.filter(t => t.visible && !t.completed);
  
  if (activeTodos.length === 0) {
    dom.todoRowsContainer.innerHTML = `
      <div class="empty-state" style="padding: 32px; text-align: center; color: var(--text-secondary);">
        <span class="material-symbols-outlined gemini-color" style="font-size: 48px; margin-bottom: 12px; display: block;">done_all</span>
        <h3 style="font-weight: 500; font-size: 16px; color: var(--text-primary);">All caught up!</h3>
        <p style="font-size: 13px; margin-top: 4px;">You have completed all suggested to-dos.</p>
      </div>
    `;
    updateCounts();
    return;
  }
  
  activeTodos.forEach(todo => {
    const row = document.createElement("div");
    row.className = "todo-row";
    row.id = todo.id;
    
    // Generate links list
    const fromLinks = todo.from.map(f => `<span class="email-link">${f}</span>`).join(" • ");
    
    row.innerHTML = `
      <div class="todo-checkbox-container">
        <button class="todo-check-btn" data-id="${todo.id}" title="Mark complete">
          <span class="material-symbols-outlined">circle</span>
        </button>
      </div>
      <div class="todo-text">
        <strong>${todo.title}</strong> – ${todo.description} <span style="color: var(--text-secondary); margin-left: 4px; font-size: 12px;">From: ${fromLinks}</span>
      </div>
      <div class="todo-actions">
        <button class="action-pill-btn" data-action="${todo.action}" data-id="${todo.id}">
          <span class="material-symbols-outlined">${todo.btnIcon}</span>
          <span>${todo.btnText}</span>
        </button>
        <button class="todo-check-btn" data-id="${todo.id}" title="Complete" style="margin-left: 8px;">
          <span class="material-symbols-outlined">check</span>
        </button>
        <button class="icon-btn" title="More options">
          <span class="material-symbols-outlined">more_vert</span>
        </button>
      </div>
    `;
    
    dom.todoRowsContainer.appendChild(row);
  });
  
  // Bind events
  dom.todoRowsContainer.querySelectorAll(".todo-check-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const todoId = btn.getAttribute("data-id");
      completeTodo(todoId);
    });
  });
  
  dom.todoRowsContainer.querySelectorAll(".action-pill-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const action = btn.getAttribute("data-action");
      const todoId = btn.getAttribute("data-id");
      handleTodoAction(action, todoId);
    });
  });
  
  updateCounts();
}

// 4. Complete a To-Do with smooth Material animations
function completeTodo(id) {
  const todoRow = document.getElementById(id);
  if (!todoRow) return;
  
  // 1. Toggle icon to checked state
  const checkBtnIcon = todoRow.querySelector(".todo-checkbox-container .material-symbols-outlined");
  if (checkBtnIcon) {
    checkBtnIcon.textContent = "check_circle";
    checkBtnIcon.style.color = "var(--text-blue)";
    checkBtnIcon.style.fontVariationSettings = "'FILL' 1";
  }
  
  todoRow.style.backgroundColor = "rgba(194, 231, 255, 0.25)";
  
  // 2. Animate row collapsing
  setTimeout(() => {
    todoRow.classList.add("completed");
    
    // 3. Process backend states
    setTimeout(() => {
      // Mark as completed
      const todoIndex = state.todos.findIndex(t => t.id === id);
      if (todoIndex > -1) {
        state.todos[todoIndex].completed = true;
      }
      
      // Promote the first hidden task to visible
      const hiddenTodo = state.todos.find(t => !t.visible && !t.completed);
      if (hiddenTodo) {
        hiddenTodo.visible = true;
      }
      
      // Re-render and count update
      renderTodos();
      
      // Update unread count in inbox as simulation
      const countEl = dom.inboxCount;
      const currentCount = parseInt(countEl.textContent, 10);
      if (currentCount > 0) {
        countEl.textContent = currentCount - 1;
      }
    }, 350); // Match style transition (0.35s)
  }, 400);
}

// 5. Update titles & show more counts
function updateCounts() {
  const totalActive = state.todos.filter(t => !t.completed).length;
  const visibleActive = state.todos.filter(t => t.visible && !t.completed).length;
  const hiddenActive = totalActive - visibleActive;
  
  // Animated title update
  dom.todoCounter.textContent = `${totalActive} to-dos`;
  
  // Update "Show more" button
  if (hiddenActive > 0) {
    dom.showMoreTodosBtn.style.display = "flex";
    dom.showMoreText.textContent = `Show ${hiddenActive} more`;
  } else {
    dom.showMoreTodosBtn.style.display = "none";
  }
}

// 6. Action button triggers
function handleTodoAction(action, todoId) {
  if (action === "open-reply") {
    // Open Compose Toast
    dom.composerToast.classList.add("active");
    // Attach current todo ID to target close sends
    dom.sendComposerBtn.setAttribute("data-todo-id", todoId);
  } else if (action === "open-waiver") {
    // Open Digital Waiver Modal
    dom.waiverModal.classList.add("active");
    dom.signWaiverBtn.setAttribute("data-todo-id", todoId);
    setupSignatureCanvas();
  } else if (action === "open-sheet") {
    // Open Google Sheet Modal
    dom.sheetsModal.classList.add("active");
    dom.saveSheetBtn.setAttribute("data-todo-id", todoId);
  } else if (action === "open-marketplace") {
    // Simulated quick modal or notification
    alert("Opening Resale Marketplace listing link in a new window...");
    completeTodo(todoId);
  } else if (action === "open-chicago") {
    alert("Opening Palm House Hotel reservation upgrade link...");
    completeTodo(todoId);
  }
}

// Show more button handler (reveals all hidden items)
dom.showMoreTodosBtn.addEventListener("click", () => {
  state.todos.forEach(t => {
    if (!t.completed) {
      t.visible = true;
    }
  });
  renderTodos();
});

// 7. Traditional Inbox rendering
function renderTraditionalInbox() {
  dom.emailListContainer.innerHTML = "";
  
  state.traditionalEmails.forEach(email => {
    const item = document.createElement("div");
    item.className = `email-item ${email.unread ? 'unread' : ''}`;
    
    item.innerHTML = `
      <div class="email-select">
        <span class="material-symbols-outlined checkbox-placeholder">check_box_outline_blank</span>
      </div>
      <div class="email-star ${email.starred ? 'starred' : ''}">
        <span class="material-symbols-outlined">${email.starred ? 'star' : 'star_border'}</span>
      </div>
      <div class="email-sender">${email.sender}</div>
      <div class="email-content-block">
        <span class="email-subject">${email.subject}</span>
        <span class="email-snippet"> - ${email.snippet}</span>
      </div>
      <div class="email-date">${email.date}</div>
    `;
    
    // Bind click to simulate marking read
    item.addEventListener("click", (e) => {
      // Toggle unread state
      if (email.unread && !e.target.classList.contains("checkbox-placeholder") && !e.target.closest(".email-star")) {
        email.unread = false;
        item.classList.remove("unread");
        const currentCount = parseInt(dom.inboxCount.textContent, 10);
        if (currentCount > 0) {
          dom.inboxCount.textContent = currentCount - 1;
        }
      }
      
      // Star click logic
      const starEl = e.target.closest(".email-star");
      if (starEl) {
        email.starred = !email.starred;
        const icon = starEl.querySelector(".material-symbols-outlined");
        if (email.starred) {
          starEl.classList.add("starred");
          icon.textContent = "star";
        } else {
          starEl.classList.remove("starred");
          icon.textContent = "star_border";
        }
      }
    });
    
    dom.emailListContainer.appendChild(item);
  });
}

// 8. Refresh Button action
dom.refreshBtn.addEventListener("click", () => {
  dom.refreshIcon.classList.add("refreshing");
  dom.statusTime.textContent = "Syncing with Gemini...";
  
  setTimeout(() => {
    dom.refreshIcon.classList.remove("refreshing");
    dom.statusTime.textContent = "Updated just now";
    
    // Animate counter pulse
    dom.todoCounter.style.transform = "scale(1.1)";
    setTimeout(() => {
      dom.todoCounter.style.transform = "scale(1)";
    }, 300);
  }, 1200);
});

// 9. Modal Control logic
document.querySelectorAll(".close-modal-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const modalId = btn.getAttribute("data-modal");
    document.getElementById(modalId).classList.remove("active");
  });
});

// Save Soccer Sheet action
dom.saveSheetBtn.addEventListener("click", () => {
  dom.sheetsModal.classList.remove("active");
  const todoId = dom.saveSheetBtn.getAttribute("data-todo-id");
  alert("Soccer Snacks Signup updated successfully! Saving details and updating Gmail.");
  if (todoId) completeTodo(todoId);
});

// Signature Canvas configuration
function setupSignatureCanvas() {
  const canvas = dom.signatureCanvas;
  canvasCtx = canvas.getContext("2d");
  canvasCtx.strokeStyle = "#0b57d0";
  canvasCtx.lineWidth = 3;
  canvasCtx.lineCap = "round";
  
  // Clear any existing contents
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Drawing listeners
  canvas.addEventListener("mousedown", startDrawing);
  canvas.addEventListener("mousemove", draw);
  canvas.addEventListener("mouseup", stopDrawing);
  canvas.addEventListener("mouseout", stopDrawing);
}

function startDrawing(e) {
  isDrawing = true;
  canvasCtx.beginPath();
  const rect = dom.signatureCanvas.getBoundingClientRect();
  canvasCtx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
}

function draw(e) {
  if (!isDrawing) return;
  const rect = dom.signatureCanvas.getBoundingClientRect();
  canvasCtx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
  canvasCtx.stroke();
}

function stopDrawing() {
  isDrawing = false;
}

dom.clearCanvasBtn.addEventListener("click", () => {
  if (canvasCtx) {
    canvasCtx.clearRect(0, 0, dom.signatureCanvas.width, dom.signatureCanvas.height);
  }
});

dom.signWaiverBtn.addEventListener("click", () => {
  dom.waiverModal.classList.remove("active");
  const todoId = dom.signWaiverBtn.getAttribute("data-todo-id");
  alert("Liability Waiver signed and submitted to the University of State! Checkmark complete.");
  if (todoId) completeTodo(todoId);
});

// 10. Composer and Gemini Writer Integration
dom.closeComposerBtn.addEventListener("click", () => {
  dom.composerToast.classList.remove("active");
  dom.geminiDraftBox.classList.remove("active");
  dom.composerTextArea.value = "";
});

dom.composerHelpWriteBtn.addEventListener("click", () => {
  dom.geminiDraftBox.classList.add("active");
  dom.geminiDraftPreview.innerHTML = "<span class='typing-cursor'>Writing draft with Gemini...</span>";
  
  const draftText = "Hi City Tile and Stone,\n\nI confirm the selection of the White Subway Tiles for our kitchen renovation. Please proceed with the order so we stay aligned with the contractor's installation timeline.\n\nBest,\nRose";
  
  let i = 0;
  dom.geminiDraftPreview.textContent = "";
  dom.geminiDraftPreview.classList.add("typing-cursor");
  
  const interval = setInterval(() => {
    if (i < draftText.length) {
      dom.geminiDraftPreview.textContent += draftText.charAt(i);
      i++;
    } else {
      clearInterval(interval);
      dom.geminiDraftPreview.classList.remove("typing-cursor");
    }
  }, 15);
});

dom.insertComposerBtn.addEventListener("click", () => {
  const contentText = dom.geminiDraftPreview.textContent;
  dom.composerTextArea.value = "";
  
  let i = 0;
  dom.composerTextArea.focus();
  
  const interval = setInterval(() => {
    if (i < contentText.length) {
      dom.composerTextArea.value += contentText.charAt(i);
      i++;
    } else {
      clearInterval(interval);
      dom.geminiDraftBox.classList.remove("active");
    }
  }, 10);
});

dom.sendComposerBtn.addEventListener("click", () => {
  dom.composerToast.classList.remove("active");
  const todoId = dom.sendComposerBtn.getAttribute("data-todo-id");
  alert("Email sent successfully!");
  if (todoId) completeTodo(todoId);
  dom.composerTextArea.value = "";
});

// 11. Search suggestions dropdown
dom.searchInput.addEventListener("focus", () => {
  dom.searchSuggestions.classList.add("active");
});

document.addEventListener("click", (e) => {
  if (!dom.searchBarContainer.contains(e.target)) {
    dom.searchSuggestions.classList.remove("active");
  }
});

dom.searchInput.addEventListener("input", () => {
  if (dom.searchInput.value.trim().length > 0) {
    dom.searchClearBtn.style.display = "block";
  } else {
    dom.searchClearBtn.style.display = "none";
  }
});

dom.searchClearBtn.addEventListener("click", () => {
  dom.searchInput.value = "";
  dom.searchClearBtn.style.display = "none";
  dom.searchInput.focus();
});

// Suggested click -> launch Gemini Drawer
document.querySelectorAll(".suggestion-item").forEach(item => {
  item.addEventListener("click", () => {
    const query = item.getAttribute("data-query");
    dom.searchInput.value = query;
    dom.searchSuggestions.classList.remove("active");
    dom.searchClearBtn.style.display = "block";
    askGemini(query);
  });
});

dom.searchInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter" && dom.searchInput.value.trim().length > 0) {
    dom.searchSuggestions.classList.remove("active");
    askGemini(dom.searchInput.value);
  }
});

// Drawer Close
dom.closeDrawerBtn.addEventListener("click", () => {
  dom.geminiChatDrawer.classList.remove("active");
});

// 12. Ask Gemini Simulation
function askGemini(query) {
  dom.geminiChatDrawer.classList.add("active");
  dom.drawerContent.innerHTML = ""; // Clear
  
  // Add User msg
  addChatBubble(query, "user");
  
  // Add loading AI indicator
  const loadingBubble = document.createElement("div");
  loadingBubble.className = "chat-msg ai";
  loadingBubble.innerHTML = `<span class="typing-cursor">Gemini is searching your workspace...</span>`;
  dom.drawerContent.appendChild(loadingBubble);
  dom.drawerContent.scrollTop = dom.drawerContent.scrollHeight;
  
  // Dynamic custom replies
  let responseText = "Sorry, I couldn't find details about that in your inbox. Please refine your query.";
  let citationAction = null;
  let citationLabel = "";
  
  if (query.toLowerCase().includes("coach mike") || query.toLowerCase().includes("snack")) {
    responseText = "Coach Mike sent an email yesterday about tomorrow's U10 scrimmage. He reminded you that it's your turn to bring snacks for 20 people.\n\n*Important:* One child has a severe peanut allergy, so please ensure snacks are peanut-free. You can log what you're bringing in the signup sheet.";
    citationLabel = "Open Snack Sheet";
    citationAction = () => {
      dom.sheetsModal.classList.add("active");
      dom.saveSheetBtn.setAttribute("data-todo-id", "todo-soccer");
    };
  } else if (query.toLowerCase().includes("waiver") || query.toLowerCase().includes("college")) {
    responseText = "Yes, you have an outstanding liability waiver to sign for your daughter's University of State tour on June 12th. The tour confirmation email contains the digital waiver link. You can open and sign it directly from here.";
    citationLabel = "Sign Digital Waiver";
    citationAction = () => {
      dom.waiverModal.classList.add("active");
      dom.signWaiverBtn.setAttribute("data-todo-id", "todo-waiver");
      setupSignatureCanvas();
    };
  } else if (query.toLowerCase().includes("renovation") || query.toLowerCase().includes("kitchen")) {
    responseText = "Here is a summary of your Kitchen Renovation updates:\n\n1. **City Construction**: Sent a revised floor plan this morning. It incorporates the new bay window design to let in more natural light.\n2. **Insurance Claim**: The homeowner's insurance carrier has processed your claim. You should receive a final response in one week.";
    citationLabel = "Reply to Tile Vendor";
    citationAction = () => {
      dom.composerToast.classList.add("active");
      dom.sendComposerBtn.setAttribute("data-todo-id", "todo-kitchen");
    };
  }
  
  setTimeout(() => {
    // Remove loading
    loadingBubble.remove();
    
    // Add AI text with typing effect
    const aiBubble = document.createElement("div");
    aiBubble.className = "chat-msg ai";
    aiBubble.classList.add("typing-cursor");
    dom.drawerContent.appendChild(aiBubble);
    
    let i = 0;
    const interval = setInterval(() => {
      if (i < responseText.length) {
        aiBubble.textContent += responseText.charAt(i);
        i++;
        dom.drawerContent.scrollTop = dom.drawerContent.scrollHeight;
      } else {
        clearInterval(interval);
        aiBubble.classList.remove("typing-cursor");
        
        // Add citation link if available
        if (citationAction && citationLabel) {
          const citation = document.createElement("div");
          citation.className = "citation-box";
          citation.innerHTML = `<span class="material-symbols-outlined" style="font-size: 14px;">open_in_new</span> <span>${citationLabel}</span>`;
          citation.addEventListener("click", citationAction);
          aiBubble.appendChild(citation);
        }
      }
    }, 10);
    
  }, 1500);
}

function addChatBubble(text, sender) {
  const bubble = document.createElement("div");
  bubble.className = `chat-msg ${sender}`;
  bubble.textContent = text;
  dom.drawerContent.appendChild(bubble);
  dom.drawerContent.scrollTop = dom.drawerContent.scrollHeight;
}

// Send from chat input drawer
dom.drawerSendBtn.addEventListener("click", () => {
  const text = dom.drawerInput.value.trim();
  if (text) {
    askGemini(text);
    dom.drawerInput.value = "";
  }
});

dom.drawerInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") {
    const text = dom.drawerInput.value.trim();
    if (text) {
      askGemini(text);
      dom.drawerInput.value = "";
    }
  }
});

// App Initialization
window.addEventListener("DOMContentLoaded", () => {
  renderTodos();
});
