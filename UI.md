# brAInstorm UI Specification & Navigation Architecture

This document specifies the user interface navigation, layout hierarchy, and collapsible widget behaviors for **brAInstorm**.

---

## 1. Layout & Navigation Hierarchy

The application layout consists of a two-pane split with a floating input dock:

```
┌────────────────────────┬─────────────────────────────────────────────────────────────┐
│ SIDEBAR (w-56)         │ MAIN CHAT AREA (flex-1)                                    │
│ ┌────────────────────┐ │ ┌─────────────────────────────────────────────────────────┐ │
│ │ App Logo + [+] Chat│ │ │ TABS HEADER: Open Tabs Strip | Provider Status          │ │
│ ├────────────────────┤ │ ├─────────────────────────────────────────────────────────┤ │
│ │ Search & Filters   │ │ │ CONVERSATION VIEW (scrollable)                          │ │
│ ├────────────────────┤ │ │  • Project / Tab Metadata Badge [Sort: Newest / Oldest]  │ │
│ │ PROJECTS & THREADS │ │ │  • User Message (Collapsible if > 1 paragraph)           │ │
│ │  📁 Website        │ │ │  • Tool Step Pills (Collapsible drawer)                 │ │
│ │   ├─ Thread 1      │ │ │  • AI Markdown Output                                   │ │
│ │   ├─ Thread 2      │ │ │  • AI Code Blocks (Collapsible if > 15 lines)            │ │
│ │   ├─ ... (top 6)   │ │ │  • Token Usage Indicator                                │ │
│ │   └─ Show all (12) ▾ │ └─────────────────────────────────────────────────────────┘ │
│ │  📁 Personal       │ │ ┌─────────────────────────────────────────────────────────┐ │
│ │   ├─ Thread A      │ │ │ FLOATING PROMPT DOCK: Attachment preview | Model select │ │
│ └────────────────────┘ │ └─────────────────────────────────────────────────────────┘ │
└────────────────────────┴─────────────────────────────────────────────────────────────┘
```

---

## 2. Sidebar Navigation Architecture

### 2.1 Project Sections
The sidebar organizes all discussions under their parent projects:
* **Project Row**:
  * **Icon**: Custom project icon (default: `Folder`).
  * **Title**: Project name (e.g. `Website`, `Personal`).
  * **Quick Add (`+`)**: Hover action to start a new discussion tab directly under that project.

### 2.2 Top 6 Threads Display
* Under each project, the discussion threads are sorted by `updated_at DESC` (most recently active first).
* By default, only the **top 6 most recent threads** are displayed to keep the sidebar compact and readable.

### 2.3 Expandable "Show all (X)" Button
* If a project has more than 6 discussion threads:
  * A button appears below the 6th thread:
    $$\text{Show all } (X)$$
    where $X$ is the total count of discussion threads in that project (e.g. `Show all (14)`).
  * **Clicking `Show all (X)`**: Expands the list inline to reveal all $X$ threads, and toggles the button text to `Show less ▴`.
  * **Clicking `Show less ▴`**: Smoothly collapses the list back to the top 6 threads.

### 2.4 Thread Item Interactions
* **Click**: Selects the thread, activates it in the main view, and opens it in the tabs strip if not already open.
* **Active State**: Highlighted with `bg-zinc-800/80` and bold text.
* **Hover Action**: Displays a delete button (`✕`) on the right to remove or archive the thread.

---

## 3. Collapsible Widgets & Truncation System

To prevent large blocks of content from overwhelming the viewport, brAInstorm implements consistent, interactive collapsible widgets across user inputs, AI code blocks, and tool executions.

### 3.1 User Post Truncation (Large Inputs)
When a user submits a long prompt (e.g. pasted logs, error dumps, extensive instructions):
* **Threshold**: Prompts exceeding 4 lines or $\sim 280$ characters.
* **Collapsed State**:
  * Truncated to a single paragraph ($\sim 4$ lines) using CSS line-clamp.
  * Shows an interactive expander at the bottom:
    `... Show more ▾`
* **Expanded State**:
  * Displays the full message with `whitespace-pre-wrap`.
  * Shows a `Show less ▴` toggle at the bottom to re-collapse.

### 3.2 AI Code Block Truncation
Code blocks rendered from AI responses feature a full-featured code card:
* **Header**:
  * Green status indicator dot + language badge (e.g. `typescript`, `python`, `sql`).
  * **Copy Button**: One-click clipboard copy with temporary `Copied!` feedback.
* **Threshold**: Code blocks exceeding **15 lines** of code.
* **Collapsed State**:
  * Height capped at $280\text{px}$ with a smooth bottom fade gradient (`linear-gradient(transparent, #09090b)`).
  * Bottom expansion bar:
    $$\text{Show all } (N\text{ lines}) \quad \triangledown$$
* **Expanded State**:
  * Expands to show the complete code block.
  * Bottom bar switches to `Show less ▴`.

### 3.3 Tool Step Pills (`ToolStepPill`)
Tool actions (e.g. searching repository, executing terminal commands, inspecting files, applying patches) are encapsulated in interactive pill widgets:
* **Pill Header**:
  * **Action Icon**: Dynamic icon (`Terminal`, `GitBranch`, `Code2`, `FileSearch`, `Loader2`).
  * **Action Title**: Concise summary (e.g. `"Checked new bugs in Linear"`, `"Ran test suite"`).
  * **Badge Count**: Number of actions/items processed (e.g. `[3]`, `[4]`).
  * **Status**: Spinning loader when running, green check when completed.
  * **Chevron**: Rotates $90^\circ$ when expanded.
* **Drawer Details**:
  * Left-bordered indented drawer (`border-l border-zinc-800`).
  * Structured details cards showing step-by-step actions and results.
  * Git diff syntax highlighting: additions in green (`+`), deletions in red (`-`).

### 3.4 Reasoning / Thinking Process Tags (`<think>`)
When reasoning models (e.g. DeepSeek-R1 / Flash-Thinking) stream `<think> ... </think>` blocks:
* Wrapped in an interactive pill: `🧠 Thinking process`.
* Collapsed by default to keep the chat tidy; click to expand the full reasoning transcript.

---

## 4. Message Ordering & Sorting

* **Chronological (Oldest First ↑)**: Standard conversational flow where newer messages append to the bottom.
* **Reverse Chronological (Newest First ↓)**: Newest turns appear at the top for rapid review of recent responses.
* **Header Sort Toggle**: An interactive toggle button in the chat header allows instantaneous switching between `Newest first ↓` and `Oldest first ↑`.

---

## 5. Startup Data Hydration Flow

```
[App Launch]
     │
     ├─────────────────────────────────────────┐
     ▼                                         ▼
HTTP Fetch: /api/projects & /api/tabs     WebSocket Connect: ws://127.0.0.1:4000/ws
     │                                         │
     ▼                                         ▼
Render real projects & top 6 threads       Receive SERVER_READY event
     │                                         │
     ▼                                         ▼
Select most recent thread (or localStorage) ── Fetch thread messages (TAB_FETCH)
     │
     ▼
Populate ConversationView (0 placeholder/fake data)
```
