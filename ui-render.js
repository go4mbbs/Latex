// ui-render.js

class LatexEditor {
  constructor() {
    this.history = [];
    this.historyIndex = -1;
    this.rendering = false;
    this.debounceTimer = null;
    this.init();
  }

  init() {
    this.container = document.getElementById('latexContainer');
    this.dropZone = document.getElementById('dropZone');
    this.browseBtn = document.getElementById('browseBtn');
    this.fileInput = document.getElementById('fileInput');
    this.statusMessage = document.getElementById('statusMessage');
    this.loadingOverlay = document.getElementById('loadingOverlay');
    this.initEventListeners();
    this.updateButtonStates();
  }

  initEventListeners() {
    this.fileInput.addEventListener('change', e => this.loadFile(e));
    this.browseBtn.addEventListener('click', () => this.fileInput.click());
    document.getElementById('renderToggleBtn').addEventListener('click', () => this.toggleRender());
    document.getElementById('undoBtn').addEventListener('click', () => this.undo());
    document.getElementById('redoBtn').addEventListener('click', () => this.redo());
    document.getElementById('saveBtn').addEventListener('click', () => this.save());

    document.addEventListener('dragover', e => {
      e.preventDefault();
      this.dropZone.classList.add('highlight');
    });
    document.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('highlight');
    });
    document.addEventListener('drop', e => {
      e.preventDefault();
      this.dropZone.classList.remove('highlight');
      if (e.dataTransfer.files[0]) this.loadFile(e.dataTransfer.files[0]);
    });
    document.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          this.undo();
        } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
          e.preventDefault();
          this.redo();
        } else if (e.key === 's') {
          e.preventDefault();
          this.save();
        }
      }
    });
  }

  showStatus(message, duration = 3000) {
    this.statusMessage.textContent = message;
    this.statusMessage.classList.add('show');
    setTimeout(() => this.statusMessage.classList.remove('show'), duration);
  }

  showLoading(show) {
    if (show) {
      this.loadingOverlay.classList.add('active');
    } else {
      this.loadingOverlay.classList.remove('active');
    }
  }

  async loadFile(event) {
    const file = event.target?.files?.[0] || event;
    if (!file?.type.includes('text/') && !file?.name.endsWith('.tex')) {
      this.showStatus('Please upload a valid LaTeX (.tex) file');
      return;
    }
    this.showLoading(true);
    try {
      const text = await file.text();
      if (text.length > 1_000_000) {
        this.showStatus('File too large (max 1MB)');
        return;
      }
      // Use the parseLatex function from latex-regex.js
      if (typeof parseLatex === 'function') {
        this.nodes = parseLatex(text);
      } else {
        this.nodes = [];
      }
      this.render();
      this.pushHistory();
      this.showStatus('File loaded successfully');
    } catch (error) {
      console.error('File loading error:', error);
      this.showStatus('Error loading file. Please check console for details.');
    } finally {
      this.showLoading(false);
    }
  }

  render() {
    this.container.innerHTML = '';
    if (!this.nodes || this.nodes.length === 0) {
      this.container.innerHTML = `
        <div class="welcome-screen">
          <h1>No Sections Found</h1>
          <p>The document doesn't contain any recognizable sections.</p>
          <button id="tryAgainBtn">Try Another File</button>
        </div>
      `;
      document.getElementById('tryAgainBtn').addEventListener('click', () => this.fileInput.click());
      return;
    }
    this.nodes.forEach((node, index) => {
      this.container.appendChild(this.renderNode(node, `${index + 1}`));
    });
    this.updateButtonStates();
  }

  renderNode(node, number) {
    const block = document.createElement('div');
    block.className = 'section-block';
    block.dataset.level = node.level;

    const header = document.createElement('div');
    header.className = 'section-header';
    header.dataset.level = node.level;
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'true');

    const numberSpan = document.createElement('span');
    numberSpan.className = 'section-number';
    numberSpan.textContent = node.level > 0 ? `${number} ` : '';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'section-title';
    titleSpan.textContent = node.title.replace(/\a-zA-Z]+\{([^}]+)\}/g, '$1');

    const toggleBtn = document.createElement('button');
    toggleBtn.innerHTML = '▼';
    toggleBtn.setAttribute('aria-label', 'Toggle section');

    const content = document.createElement('div');
    content.className = 'section-content';
    content.contentEditable = true;
    content.innerHTML = node.content;
    content.setAttribute('aria-label', `${node.title} content`);

    const nested = document.createElement('div');
    nested.className = 'nested-container';

    const toggleVisibility = () => {
      const isVisible = content.style.display !== 'none';
      content.style.display = isVisible ? 'none' : 'block';
      nested.style.display = isVisible ? 'none' : 'block';
      toggleBtn.innerHTML = isVisible ? '▶' : '▼';
      header.setAttribute('aria-expanded', String(!isVisible));
    };

    header.addEventListener('click', toggleVisibility);
    header.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleVisibility();
      }
    });

    content.addEventListener('input', () => {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.pushHistory(), 500);
    });

    node.children.forEach((child, index) => {
      nested.appendChild(this.renderNode(child, `${number}.${index + 1}`));
    });

    header.appendChild(numberSpan);
    header.appendChild(titleSpan);
    header.appendChild(toggleBtn);
    block.appendChild(header);
    block.appendChild(content);
    block.appendChild(nested);

    return block;
  }

  toggleRender() {
    this.rendering = !this.rendering;
    const btn = document.getElementById('renderToggleBtn');
    btn.textContent = this.rendering ? 'Edit Mode' : 'Render Math';
    btn.setAttribute('aria-pressed', this.rendering);

    document.querySelectorAll('.section-content').forEach(editor => {
      editor.contentEditable = !this.rendering;
      if (this.rendering) {
        MathJax.typesetPromise([editor]).catch(err => console.error(err));
      } else {
        MathJax.typesetClear();
      }
    });

    this.showStatus(this.rendering ? 'Math rendering enabled' : 'Edit mode enabled');
  }

  pushHistory() {
    const snapshot = Array.from(document.querySelectorAll('.section-content')).map(e => e.innerHTML);
    if (this.historyIndex >= 0 && JSON.stringify(snapshot) === JSON.stringify(this.history[this.historyIndex])) {
      return;
    }
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(snapshot);
    this.historyIndex++;
    this.updateButtonStates();
  }

  updateButtonStates() {
    document.getElementById('undoBtn').disabled = this.historyIndex <= 0;
    document.getElementById('redoBtn').disabled = this.historyIndex >= this.history.length - 1;
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      this.restoreHistory();
      this.showStatus('Undo successful');
    }
  }

  redo() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      this.restoreHistory();
      this.showStatus('Redo successful');
    }
  }

  restoreHistory() {
    const snapshot = this.history[this.historyIndex];
    document.querySelectorAll('.section-content').forEach((e, i) => {
      e.innerHTML = snapshot[i] || '';
    });
    if (this.rendering) MathJax.typesetPromise();
    this.updateButtonStates();
  }

  save() {
    const content = Array.from(document.querySelectorAll('.section-content')).map(e => e.textContent).join('\n\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `latex-document-${new Date().toISOString().slice(0,10)}.tex`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.showStatus('Document saved successfully');
  }
}

// Expose LatexEditor globally
window.LatexEditor = LatexEditor;
