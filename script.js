window.onerror = function (msg, src, line) {
    console.log("ERROR:", msg, "at line:", line, "file:", src);
};

const defaultProjectFiles = {
    "index.html": `<!DOCTYPE html>
<html>
<head>
    <title>Test</title>
</head>
<link rel="stylesheet" href="style.css">
<body>
    <h1>Hello Mithu Web IDE</h1>
</body>
<script src="script.js"></script>
</html>`,
    "style.css": `body {
    margin: 0;
    font-family: Arial, sans-serif;
}`,
    "script.js": `document.addEventListener("DOMContentLoaded", function () {
    console.log("Hello Mithu Web IDE");
});`
};

const fileLanguageMap = {
    "index.html": "html",
    "style.css": "css",
    "script.js": "javascript"
};

let editor = null;
let backend = null;
let monacoApi = null;
let activeFile = "index.html";
let currentProjectPath = "";
let currentProjectState = "create";
let projectFiles = { ...defaultProjectFiles };
let editorModels = Object.create(null);
let monacoLoading = null;
let appReady = false;
let openFiles = ["index.html", "style.css", "script.js"];
let selectedCanvasElement = null;
let syncingCanvas = false;
let syncingEditor = false;
let autosaveEnabled = localStorage.getItem("mithuAutosave") === "true";
let autosaveTimer = null;
let canvasIdCounter = 1;
let savingProject = false;
let projectFolders = [];
let selectedCanvasIsBody = false;
let canvasDragState = null;
let canvasScale = 1;

function createDefaultFiles() {
    return { ...defaultProjectFiles };
}

function getProjectFileValue(fileName) {
    return Object.prototype.hasOwnProperty.call(projectFiles, fileName) ? projectFiles[fileName] : (defaultProjectFiles[fileName] || "");
}

function getLanguageForFile(fileName) {
    if (fileLanguageMap[fileName]) {
        return fileLanguageMap[fileName];
    }

    const extension = fileName.split(".").pop().toLowerCase();
    if (extension === "html" || extension === "htm") return "html";
    if (extension === "css") return "css";
    if (extension === "js") return "javascript";
    if (extension === "json") return "json";
    if (extension === "md") return "markdown";
    return "plaintext";
}

function ensureOpenFile(fileName) {
    if (!openFiles.includes(fileName)) {
        openFiles.push(fileName);
    }
}

function ensureEditorModel(fileName) {
    if (!monacoApi || editorModels[fileName]) {
        return;
    }

    editorModels[fileName] = monacoApi.editor.createModel(
        getProjectFileValue(fileName),
        getLanguageForFile(fileName),
        monacoApi.Uri.parse(`file:///${fileName}`)
    );
}

function renderFileTabs() {
    const container = document.getElementById("openTabs");
    if (!container) {
        return;
    }

    container.innerHTML = "";
    openFiles.forEach(function (fileName) {
        const tabWrapper = document.createElement("div");
        tabWrapper.style.display = "flex";
        tabWrapper.style.alignItems = "center";
        tabWrapper.style.gap = "0";

        const tab = document.createElement("button");
        tab.type = "button";
        tab.className = "file_tab";
        tab.dataset.file = fileName;
        tab.textContent = fileName;
        tab.style.flex = "1";
        tab.addEventListener("click", function () {
            openFileInEditor(fileName);
        });

        const closeBtn = document.createElement("button");
        closeBtn.type = "button";
        closeBtn.textContent = "×";
        closeBtn.style.width = "50px";
        closeBtn.style.height = "50px";
        closeBtn.style.padding = "0";
        closeBtn.style.marginLeft = "0";
        closeBtn.style.border = "none";
        closeBtn.style.background = "transparent";
        closeBtn.style.color = "white";
        closeBtn.style.cursor = "pointer";
        closeBtn.style.fontSize = "24px";
        closeBtn.style.lineHeight = "1";
        closeBtn.style.display = "flex";
        closeBtn.style.alignItems = "center";
        closeBtn.style.justifyContent = "center";
        closeBtn.addEventListener("click", function (e) {
            e.stopPropagation();
            closeFileTab(fileName);
        });

        tabWrapper.appendChild(tab);
        tabWrapper.appendChild(closeBtn);
        container.appendChild(tabWrapper);
    });

    updateActiveTab();
}

function closeFileTab(fileName) {
    const index = openFiles.indexOf(fileName);
    if (index > -1) {
        openFiles.splice(index, 1);

        if (activeFile === fileName) {
            activeFile = openFiles.length > 0 ? openFiles[0] : "index.html";
        }

        renderFileTabs();
        if (openFiles.includes(activeFile) || activeFile === "index.html") {
            openFileInEditor(activeFile);
        } else if (openFiles.length > 0) {
            openFileInEditor(openFiles[0]);
        }
    }
}

function updateActiveTab() {
    const tabs = document.querySelectorAll(".file_tab");

    tabs.forEach(function (tab) {
        tab.classList.toggle("active", tab.getAttribute("data-file") === activeFile);
    });

    document.querySelectorAll(".tree_item").forEach(function (item) {
        item.classList.toggle("active", item.dataset.file === activeFile);
    });
}

function showEditorError(message) {
    const container = document.getElementById("editor");
    if (!container || editor) {
        return;
    }

    container.innerHTML = `<div style="height:100%;display:flex;align-items:center;justify-content:center;background:#0b1220;color:#f8fafc;font-family:Consolas,monospace;padding:24px;text-align:center;">${message}</div>`;
}

function isHtmlFile(fileName) {
    return /\.(html|htm)$/i.test(fileName || "");
}

function getCanvasFileName() {
    return isHtmlFile(activeFile) ? activeFile : "index.html";
}

function parseCanvasDocument() {
    return new DOMParser().parseFromString(getProjectFileValue(getCanvasFileName()), "text/html");
}

function getProjectCss() {
    return getProjectFileValue("style.css");
}

function scopeCssToCanvas(cssText) {
    return String(cssText || "")
        .replace(/@keyframes\s+[^{]+\{(?:[^{}]|\{[^{}]*\})*\}/gi, "")
        .replace(/\b100vw\b/g, "100cqw")
        .replace(/\b100vh\b/g, "100cqh")
        .replace(/(^|})\s*([^@{}][^{}]*)\{/g, function (match, prefix, selectorText) {
            const scopedSelectors = selectorText.split(",").map(function (selector) {
                const trimmed = selector.trim();
                if (!trimmed) {
                    return "";
                }
                if (/^(html|body|:root)(\b|:|\.|#|\[)/i.test(trimmed)) {
                    return trimmed.replace(/^(html|body|:root)/i, "#area");
                }
                if (trimmed.startsWith("#area")) {
                    return trimmed;
                }
                return "#area " + trimmed;
            }).filter(Boolean).join(", ");

            return prefix + " " + scopedSelectors + "{";
        });
}

function updateCanvasStyles() {
    let styleElement = document.getElementById("canvasProjectStyle");
    if (!styleElement) {
        styleElement = document.createElement("style");
        styleElement.id = "canvasProjectStyle";
        document.head.appendChild(styleElement);
    }

    styleElement.textContent = scopeCssToCanvas(getProjectCss());
}

function prepareCanvasElement(element) {
    if (!element.dataset.canvasId) {
        element.dataset.canvasId = "canvas-" + canvasIdCounter++;
    }

    element.removeAttribute("draggable");
    element.setAttribute("draggable", "true");
    if (element.tagName === "INPUT" || element.tagName === "TEXTAREA") {
        element.setAttribute("readonly", "");
    }

    Array.from(element.attributes).forEach(function (attribute) {
        if (/^on/i.test(attribute.name)) {
            element.setAttribute("data-canvas-event-" + attribute.name.toLowerCase(), attribute.value);
            element.removeAttribute(attribute.name);
        }
    });
}

function prepareCanvasChildren() {
    const canvas = document.getElementById("area");
    if (!canvas) {
        return;
    }

    canvas.querySelectorAll("*").forEach(prepareCanvasElement);
}

function restoreCanvasOnlyAttributes(root) {
    root.querySelectorAll("[data-canvas-id]").forEach(function (element) {
        element.removeAttribute("data-canvas-id");
        element.removeAttribute("draggable");
        element.removeAttribute("readonly");
        element.classList.remove("selected_element");

        Array.from(element.attributes).forEach(function (attribute) {
            if (attribute.name.startsWith("data-canvas-event-")) {
                const eventName = attribute.name.replace("data-canvas-event-", "");
                element.setAttribute(eventName, attribute.value);
                element.removeAttribute(attribute.name);
            }
        });
    });
}

function applyBodyInlineStyleToCanvas(doc) {
    const canvas = document.getElementById("area");
    if (!canvas || !doc.body) {
        return;
    }

    ["background", "backgroundColor", "color", "fontFamily", "fontSize", "padding"].forEach(function (property) {
        canvas.style[property] = doc.body.style[property] || "";
    });
}

function getCanvasScaleValue() {
    return Number.isFinite(canvasScale) && canvasScale > 0 ? canvasScale : 1;
}

function getCanvasPointerPosition(event, canvas) {
    const rect = canvas.getBoundingClientRect();
    const scale = getCanvasScaleValue();

    return {
        x: ((event.clientX - rect.left) / scale) + canvas.scrollLeft,
        y: ((event.clientY - rect.top) / scale) + canvas.scrollTop
    };
}

function serializeHtmlNode(node, depth) {
    const indent = " ".repeat(depth * 4);

    if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ? node.textContent.replace(/\s+/g, " ").trim() : "";
        return text ? indent + text : "";
    }

    if (node.nodeType === Node.COMMENT_NODE) {
        return indent + "<!--" + node.textContent + "-->";
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
        return "";
    }

    const tagName = node.tagName.toLowerCase();
    const attributes = Array.from(node.attributes).map(function (attribute) {
        return " " + attribute.name + "=\"" + escapeAttribute(attribute.value) + "\"";
    }).join("");
    const voidElements = ["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"];
    const children = Array.from(node.childNodes).map(function (child) {
        return serializeHtmlNode(child, depth + 1);
    }).filter(Boolean);

    if (voidElements.includes(tagName)) {
        return indent + "<" + tagName + attributes + ">";
    }

    if (!children.length) {
        return indent + "<" + tagName + attributes + "></" + tagName + ">";
    }

    return [indent + "<" + tagName + attributes + ">", ...children, indent + "</" + tagName + ">"].join("\n");
}

function serializeHtmlDocument(doc) {
    const doctype = doc.doctype ? "<!DOCTYPE " + doc.doctype.name + ">\n" : "";
    return doctype + serializeHtmlNode(doc.documentElement, 0);
}

function updateCanvasFromHtml() {
    const canvas = document.getElementById("area");
    if (!canvas || syncingCanvas) {
        return;
    }

    const previousSelectionId = selectedCanvasElement && !selectedCanvasIsBody ? selectedCanvasElement.dataset.canvasId : null;
    const preserveBodySelection = selectedCanvasIsBody;

    syncingEditor = true;
    const doc = parseCanvasDocument();
    updateCanvasStyles();
    applyBodyInlineStyleToCanvas(doc);
    canvas.innerHTML = doc.body ? doc.body.innerHTML : "";
    console.log(canvas.innerHTML);
    console.log(canvas.querySelector("button"));
    prepareCanvasChildren();
    restoreCssClasses(canvas);

    if (preserveBodySelection) {
        selectCanvasElement(document.getElementById("area"));
    } else if (previousSelectionId) {
        const restoredElement = canvas.querySelector('[data-canvas-id="' + previousSelectionId + '"]');
        if (restoredElement) {
            selectCanvasElement(restoredElement);
        } else {
            selectedCanvasElement = null;
            selectedCanvasIsBody = false;
            showTab("empty", ".details");
        }
    } else {
        selectedCanvasElement = null;
        selectedCanvasIsBody = false;
        showTab("empty", ".details");
    }

    syncingEditor = false;
}

function restoreCssClasses(canvas) {
    const cssMap = getCssClassMap();
    canvas.querySelectorAll("[data-canvas-id]").forEach(function (element) {
        const className = "elem-" + element.dataset.canvasId;
        if (cssMap[className]) {
            element.classList.add(className);
        }
    });
}

function buildHtmlFromCanvas() {
    const doc = parseCanvasDocument();
    if (!doc.body) {
        return getProjectFileValue(getCanvasFileName());
    }

    const canvas = document.getElementById("area");
    const clone = canvas ? canvas.cloneNode(true) : document.createElement("div");
    restoreCanvasOnlyAttributes(clone);

    doc.body.innerHTML = clone.innerHTML;
    return serializeHtmlDocument(doc);
}

function syncCanvasToCode() {
    if (syncingEditor) {
        return;
    }

    syncingCanvas = true;
    const canvasFileName = getCanvasFileName();
    projectFiles[canvasFileName] = buildHtmlFromCanvas();
    if (editorModels[canvasFileName] && editorModels[canvasFileName].getValue() !== projectFiles[canvasFileName]) {
        editorModels[canvasFileName].setValue(projectFiles[canvasFileName]);
    }
    syncingCanvas = false;
    scheduleAutosave();
}

function scheduleAutosave() {
    if (!autosaveEnabled || savingProject) {
        return;
    }

    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(function () {
        persistProject().catch(function (error) {
            console.error(error);
        });
    }, 700);
}

function saveActiveFile() {
    if (!editor || syncingCanvas || syncingEditor) {
        return;
    }

    projectFiles[activeFile] = editor.getValue();
    if (isHtmlFile(activeFile)) {
        updateCanvasFromHtml();
    } else if (activeFile === "style.css") {
        updateCanvasStyles();
    }
    scheduleAutosave();
}

function syncEditorModels() {
    if (!monacoApi) {
        return;
    }

    Object.keys(projectFiles).forEach(function (fileName) {
        ensureEditorModel(fileName);
        const model = editorModels[fileName];
        if (!model) {
            return;
        }

        const nextValue = getProjectFileValue(fileName);
        if (model.getValue() !== nextValue) {
            model.setValue(nextValue);
        }
    });

    if (editor && editorModels[activeFile]) {
        editor.setModel(editorModels[activeFile]);
    }

    renderProjectTree();
    renderFileTabs();
    updateCanvasFromHtml();
}

async function loadProjectData(projectPath, state) {
    if (!projectPath) {
        projectFiles = createDefaultFiles();
        currentProjectPath = "";
        currentProjectState = "create";
        projectFolders = [];
        localStorage.removeItem("mithuCssClassMap");
        rememberFoldersFromFiles();
        openFiles = ["index.html", "style.css", "script.js"];
        syncEditorModels();
        return;
    }

    currentProjectPath = projectPath;
    currentProjectState = state || currentProjectState || "open";

    try {
        if (window.api && typeof window.api.getProjectFiles === "function") {
            const response = await window.api.getProjectFiles(projectPath);
            if (response && response.success && response.files) {
                projectFiles = {
                    ...defaultProjectFiles,
                    ...response.files
                };
                projectFolders = [];
                rememberFoldersFromFiles();
                openFiles = ["index.html", "style.css", "script.js"].filter(function (fileName) {
                    return Object.prototype.hasOwnProperty.call(projectFiles, fileName);
                });
                ensureOpenFile(activeFile);
                syncEditorModels();
                return;
            }
        }

        projectFiles = createDefaultFiles();
        projectFolders = [];
        rememberFoldersFromFiles();
        openFiles = ["index.html", "style.css", "script.js"];
        syncEditorModels();
    } catch {
        projectFiles = createDefaultFiles();
        projectFolders = [];
        rememberFoldersFromFiles();
        openFiles = ["index.html", "style.css", "script.js"];
        syncEditorModels();
    }
}

async function persistProject() {
    savingProject = true;
    try {
        saveActiveFile();

        if (!currentProjectPath || !window.api || typeof window.api.saveProject !== "function") {
            return { success: false, error: "No project is currently open." };
        }

        const response = await window.api.saveProject({
            projectPath: currentProjectPath,
            files: projectFiles
        });

        if (response && response.success) {
            await window.api.writeManage({
                project_path: currentProjectPath,
                state: currentProjectState || "open"
            });
        }

        return response;
    } finally {
        savingProject = false;
    }
}

async function saveProjectAs() {
    saveActiveFile();

    if (!currentProjectPath) {
        return persistProject();
    }

    const parentSelection = await window.api.openFolder();
    if (!parentSelection) {
        return { success: false, canceled: true };
    }

    const projectName = currentProjectPath.split(/[\\/]/).pop();
    const targetBase = parentSelection.folderPath;
    const createResult = await window.api.createFolder({
        basePath: targetBase,
        name: projectName
    });

    if (!createResult || !createResult.success) {
        return createResult || { success: false, error: "Unable to create destination folder." };
    }

    const newProjectPath = targetBase + "/" + projectName;
    const saveResult = await window.api.saveProject({
        projectPath: newProjectPath,
        files: projectFiles
    });

    if (saveResult && saveResult.success) {
        currentProjectPath = newProjectPath;
        currentProjectState = "open";
        await window.api.writeManage({
            project_path: newProjectPath,
            state: "open"
        });
        await window.api.writeFiles([projectName, newProjectPath]);
        window.api.openEditor(newProjectPath);
    }

    return saveResult;
}

function initializeBackend() {
    if (typeof QWebChannel === "undefined" || typeof qt === "undefined" || !qt.webChannelTransport) {
        return;
    }

    new QWebChannel(qt.webChannelTransport, function (channel) {
        backend = channel.objects.backend;
        loadSavedCode();
    });
}

function loadSavedCode() {
    if (!backend || typeof backend.loadUser !== "function") {
        return;
    }

    Promise.resolve(backend.loadUser())
        .then(function (value) {
            if (value) {
                projectFiles["index.html"] = value;
                if (editorModels["index.html"]) {
                    editorModels["index.html"].setValue(value);
                } else if (editor) {
                    editor.setValue(value);
                }
            }
        })
        .catch(function () {
        });
}

function configureMonaco() {
    monacoApi.editor.defineTheme("mw-vscode", {
        base: "vs-dark",
        inherit: true,
        rules: [],
        colors: {
            "editor.background": "#0B1220",
            "editor.lineHighlightBackground": "#111827",
            "editorGutter.background": "#0B1220",
            "editorLineNumber.foreground": "#475569",
            "editorLineNumber.activeForeground": "#E2E8F0",
            "editorCursor.foreground": "#38BDF8",
            "editor.selectionBackground": "#1D4ED880",
            "editor.inactiveSelectionBackground": "#1E3A8A55",
            "editorIndentGuide.background1": "#1F2937",
            "editorIndentGuide.activeBackground1": "#334155",
            "editorSuggestWidget.background": "#0F172A",
            "editorSuggestWidget.border": "#1E293B",
            "editorSuggestWidget.selectedBackground": "#1E3A8A",
            "editorHoverWidget.background": "#0F172A",
            "editorHoverWidget.border": "#1E293B"
        }
    });

    monacoApi.languages.typescript.javascriptDefaults.setEagerModelSync(true);
    monacoApi.languages.typescript.typescriptDefaults.setEagerModelSync(true);

    monacoApi.languages.typescript.javascriptDefaults.setCompilerOptions({
        allowNonTsExtensions: true,
        allowJs: true,
        checkJs: true,
        noEmit: true,
        target: monacoApi.languages.typescript.ScriptTarget.ES2020,
        module: monacoApi.languages.typescript.ModuleKind.ESNext
    });

    monacoApi.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: false,
        noSyntaxValidation: false
    });
}

function createModels() {
    Object.keys(projectFiles).forEach(function (fileName) {
        ensureEditorModel(fileName);
    });
}

function openFileInEditor(fileName, switchToCodeView) {
    if (!fileName) {
        return;
    }

    saveActiveFile();
    ensureOpenFile(fileName);
    activeFile = fileName;
    ensureEditorModel(fileName);
    renderFileTabs();
    renderProjectTree();

    if (editor && editorModels[fileName]) {
        editor.setModel(editorModels[fileName]);
    }

    if (switchToCodeView) {
        showCodeView();
        return;
    }

    if (editor && editorModels[fileName]) {
        editor.focus();
    }

    if (isHtmlFile(fileName)) {
        updateCanvasFromHtml();
    }
}

function showCodeView() {
    const canvas = document.getElementById("area");
    const ide = document.getElementById("ide");
    const modeButton = document.getElementById("mode");

    if (!canvas || !ide || !modeButton) {
        return;
    }

    modeButton.innerText = "Design";
    syncCanvasToCode();
    canvas.style.display = "none";
    ide.style.display = "flex";
    showTab("t_code", ".bar");
    showTab("empty_code", ".details");

    if (editor) {
        editor.layout();
        editor.focus();
    }
}

function showDesignView() {
    const canvas = document.getElementById("area");
    const ide = document.getElementById("ide");
    const modeButton = document.getElementById("mode");

    if (!canvas || !ide || !modeButton) {
        return;
    }

    modeButton.innerText = "Code";
    saveActiveFile();
    updateCanvasFromHtml();
    ide.style.display = "none";
    canvas.style.display = "block";
    canvas.style.transform = "none";
    canvas.style.zoom = "1";
    change_tool_screen("elements", "pages", "deck", "t_elements");
    showTab("empty", ".details");

    if (editor) {
        editor.layout();
    }
}

function renderProjectTree() {
    const container = document.getElementById("projectTree");
    if (!container) {
        return;
    }

    container.innerHTML = "";
    const treeRoot = {};

    projectFolders.forEach(function (folderName) {
        const parts = folderName.split(/[\\/]/).filter(Boolean);
        let branch = treeRoot;
        parts.forEach(function (part) {
            branch[part] = branch[part] || {};
            branch = branch[part];
        });
    });

    Object.keys(projectFiles).sort().forEach(function (fileName) {
        const parts = fileName.split(/[\\/]/).filter(Boolean);
        let branch = treeRoot;
        parts.forEach(function (part, index) {
            if (index === parts.length - 1) {
                branch[part] = fileName;
                return;
            }
            branch[part] = branch[part] || {};
            branch = branch[part];
        });
    });

    function renderBranch(branch, depth) {
        Object.keys(branch).sort().forEach(function (name) {
            const value = branch[name];
            if (typeof value === "string") {
                renderTreeFile(name, value, depth);
                return;
            }

            const folder = document.createElement("div");
            folder.className = "tree_folder";
            folder.style.paddingLeft = (depth * 10 + 7) + "px";
            folder.textContent = name;
            container.appendChild(folder);
            renderBranch(value, depth + 1);
        });
    }

    function renderTreeFile(label, fileName, depth) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tree_item";
        button.dataset.file = fileName;
        button.style.paddingLeft = (depth * 10 + 7) + "px";
        button.textContent = label;
        button.addEventListener("click", function () {
            openFileInEditor(fileName, true);
        });
        container.appendChild(button);
    }

    renderBranch(treeRoot, 0);

    updateActiveTab();
}

function rememberFolderPath(folderPath) {
    const cleanPath = String(folderPath || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    if (cleanPath && !projectFolders.includes(cleanPath)) {
        projectFolders.push(cleanPath);
    }
}

function rememberFoldersFromFiles() {
    Object.keys(projectFiles).forEach(function (fileName) {
        const parts = fileName.split(/[\\/]/).filter(Boolean);
        parts.pop();
        let folderPath = "";
        parts.forEach(function (part) {
            folderPath = folderPath ? folderPath + "/" + part : part;
            rememberFolderPath(folderPath);
        });
    });
}

async function createTreeFile() {
    console.log("createTreeFile called, currentProjectPath:", currentProjectPath);

    if (!currentProjectPath) {
        console.log("No project path set");
        alert("Open a project first.");
        return;
    }

    const name = prompt("New file name (e.g., about.html, utils.js):", "new-file.html");
    console.log("File name entered:", name);

    if (!name) {
        return;
    }

    const cleanName = name.replace(/\\/g, "/").replace(/^\/+/, "");
    console.log("Clean name:", cleanName);

    const result = await window.api.createFile({
        basePath: currentProjectPath,
        name: cleanName
    });

    console.log("createFile result:", result);

    if (!result || !result.success) {
        alert(result && result.error ? result.error : "Could not create file");
        return;
    }

    projectFiles[cleanName] = "";
    rememberFoldersFromFiles();
    syncEditorModels();
    openFileInEditor(cleanName, true);
}

async function createTreeFolder() {
    console.log("createTreeFolder called, currentProjectPath:", currentProjectPath);

    if (!currentProjectPath) {
        console.log("No project path set");
        alert("Open a project first.");
        return;
    }

    const name = prompt("New folder name (e.g., components, assets):", "new-folder");
    console.log("Folder name entered:", name);

    if (!name) {
        return;
    }

    const cleanName = name.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    console.log("Clean folder name:", cleanName);

    const result = await window.api.createFolder({
        basePath: currentProjectPath,
        name: cleanName
    });

    console.log("createFolder result:", result);

    if (!result || !result.success) {
        alert(result && result.error ? result.error : "Could not create folder");
        return;
    }

    rememberFolderPath(cleanName);
    renderProjectTree();
}

function initializeMonaco() {
    const container = document.getElementById("editor");

    if (!container || typeof require === "undefined") {
        showEditorError("Monaco loader is missing.");
        return Promise.resolve();
    }

    if (monacoLoading) {
        return monacoLoading;
    }

    window.MonacoEnvironment = {
        getWorkerUrl: function () {
            return "./monaco/min/vs/base/worker/workerMain.js";
        }
    };

    require.config({
        paths: {
            vs: "./monaco/min/vs"
        }
    });

    monacoLoading = new Promise(function (resolve, reject) {
        require(["vs/editor/editor.main"], function () {
            monacoApi = window.monaco || globalThis.monaco;

            if (!monacoApi || !monacoApi.editor) {
                showEditorError("Monaco loaded, but the editor API was not available.");
                reject(new Error("Monaco API unavailable"));
                return;
            }

            configureMonaco();
            createModels();
            container.innerHTML = "";

            editor = monacoApi.editor.create(container, {
                model: editorModels[activeFile],
                theme: "mw-vscode",
                automaticLayout: true,
                minimap: {
                    enabled: true
                },
                lineNumbers: "on",
                renderLineHighlight: "all",
                roundedSelection: false,
                scrollBeyondLastLine: false,
                fontSize: 14,
                fontFamily: "Consolas, 'Courier New', monospace",
                fontLigatures: true,
                smoothScrolling: true,
                cursorBlinking: "smooth",
                cursorSmoothCaretAnimation: "on",
                bracketPairColorization: {
                    enabled: true
                },
                guides: {
                    bracketPairs: true,
                    indentation: true
                },
                quickSuggestions: {
                    other: true,
                    comments: false,
                    strings: true
                },
                suggestOnTriggerCharacters: true,
                parameterHints: {
                    enabled: true
                },
                acceptSuggestionOnEnter: "on",
                tabCompletion: "on",
                wordBasedSuggestions: "currentDocument",
                stickyScroll: {
                    enabled: true
                },
                padding: {
                    top: 12,
                    bottom: 12
                }
            });

            editor.onDidChangeModelContent(function () {
                saveActiveFile();
            });

            renderFileTabs();
            renderProjectTree();
            updateActiveTab();
            syncEditorModels();
            loadSavedCode();
            resolve();
        }, function (error) {
            console.error("Monaco loader error", error);
            showEditorError("Monaco failed to load. Check the terminal for the exact error.");
            reject(error);
        });
    });

    return monacoLoading;
}

function slider_adjust() {
    const slider = document.getElementById("sizer");
    const lab = document.getElementById("sf");
    const canvas = document.getElementById("area");

    if (!slider || !lab || !canvas) {
        return;
    }

    const scale = Number(slider.value) / 100;
    lab.textContent = slider.value + "%";

    canvas.style.transform = scale === 1 ? "none" : "scale(" + scale + ")";
    canvas.style.transformOrigin = "top left";
    canvasScale = scale;
}

function change_tool_screen(name, name1, name2, page) {
    document.getElementById(name).style.backgroundColor = "rgb(15, 26, 37)";
    document.getElementById(name).style.color = "rgb(255, 255, 255)";

    document.getElementById(name1).style.backgroundColor = "rgb(240, 240, 240)";
    document.getElementById(name1).style.color = "rgb(0, 0, 0)";

    document.getElementById(name2).style.backgroundColor = "rgb(240, 240, 240)";
    document.getElementById(name2).style.color = "rgb(0, 0, 0)";

    showTab(page, ".bar");
}

function change_property_screen(activeButtonId, inactiveButtonId, page) {
    const activeButton = document.getElementById(activeButtonId);
    const inactiveButton = document.getElementById(inactiveButtonId);

    if (activeButton) {
        activeButton.style.backgroundColor = "rgb(15, 26, 37)";
        activeButton.style.color = "rgb(255, 255, 255)";
    }

    if (inactiveButton) {
        inactiveButton.style.backgroundColor = "rgb(240, 240, 240)";
        inactiveButton.style.color = "rgb(0, 0, 0)";
    }

    showTab(page, ".right_bar");
}

function showTab(tabId, selector) {
    document.querySelectorAll(selector).forEach(function (element) {
        element.style.display = "none";
    });

    const target = document.getElementById(tabId);
    if (target) {
        target.style.display = "block";
    }
}

function initialize_controls() {
    const slider = document.getElementById("sizer");
    const btn_n = document.getElementById("s-");
    const btn_p = document.getElementById("s+");

    if (!slider || !btn_n || !btn_p) {
        return;
    }

    slider.addEventListener("input", slider_adjust);

    btn_n.addEventListener("click", function () {
        slider.value = Math.max(Number(slider.min), Number(slider.value) - 10);
        slider_adjust();
    });

    btn_p.addEventListener("click", function () {
        slider.value = Math.min(Number(slider.max), Number(slider.value) + 10);
        slider_adjust();
    });

    slider_adjust();
    showTab("t_elements", ".bar");
    showTab("p_project", ".right_bar");
    showTab("empty", ".details");
}

function selectCanvasElement(element) {
    const canvas = document.getElementById("area");
    if (!canvas || !element || element === canvas) {
        if (selectedCanvasElement) {
            selectedCanvasElement.classList.remove("selected_element");
        }
        selectedCanvasElement = canvas || null;
        selectedCanvasIsBody = true;
        renderSelectedProperties();
        return;
    }

    if (selectedCanvasElement) {
        selectedCanvasElement.classList.remove("selected_element");
    }

    selectedCanvasElement = element;
    selectedCanvasIsBody = false;
    prepareCanvasElement(selectedCanvasElement);
    selectedCanvasElement.classList.add("selected_element");
    renderSelectedProperties();
}

function renderSelectedProperties() {
    const panel = document.getElementById("selected");
    if (!panel || !selectedCanvasElement) {
        return;
    }

    showTab("selected", ".details");
    change_property_screen("propertiesTab", "projectTab", "p_properties");
    const bodyStyle = selectedCanvasIsBody && parseCanvasDocument().body ? parseCanvasDocument().body.style : null;
    const computed = window.getComputedStyle(selectedCanvasElement);
    const cssMap = getCssClassMap();
    const className = "elem-" + (selectedCanvasElement.dataset.canvasId || "");
    const elementStyles = cssMap[className] || {};

    const bodyTitle = selectedCanvasIsBody ? `<div class="prop_title">Body</div>` : "";
    const textValue = selectedCanvasElement.tagName === "IMG" ? selectedCanvasElement.getAttribute("alt") || "" : selectedCanvasElement.textContent;
    const sourceField = selectedCanvasElement.tagName === "IMG"
        ? `<label>Source<input data-prop="src" value="${escapeAttribute(selectedCanvasElement.getAttribute("src") || "")}"></label>`
        : "";
    const hrefField = selectedCanvasElement.tagName === "A"
        ? `<label>Href<input data-prop="href" value="${escapeAttribute(selectedCanvasElement.getAttribute("href") || "")}"></label>`
        : "";
    const deleteButton = selectedCanvasIsBody ? "" : `<button type="button" id="deleteCanvasElementBtn" class="delete_canvas_btn">Delete component</button>`;

    const fontSizeValue = elementStyles.fontSize ? parseInt(elementStyles.fontSize, 10) : parseInt(computed.fontSize, 10) || 16;
    const colorValue = elementStyles.color ? elementStyles.color : rgbToHex(computed.color);
    const bgColorValue = elementStyles.backgroundColor ? elementStyles.backgroundColor : rgbToHex(computed.backgroundColor);
    const paddingValue = elementStyles.padding || "";
    const widthValue = elementStyles.width || "";
    const heightValue = elementStyles.height || "";

    panel.innerHTML = `
        <div class="prop_form">
            ${bodyTitle}
            ${selectedCanvasIsBody ? "" : `<label>Text<input data-prop="text" value="${escapeAttribute(textValue)}"></label>`}
            ${sourceField}
            ${hrefField}
            <label>Font size<input data-prop="fontSize" type="number" min="8" max="96" value="${fontSizeValue}"></label>
            <label>Text color<input data-prop="color" type="color" value="${colorValue}"></label>
            <label>Background<input data-prop="backgroundColor" type="color" value="${bgColorValue}"></label>
            <label>Padding<input data-prop="padding" placeholder="0px" value="${paddingValue}"></label>
            <label>Width<input data-prop="width" placeholder="auto" value="${widthValue}"></label>
            <label>Height<input data-prop="height" placeholder="auto" value="${heightValue}"></label>
            ${deleteButton}
        </div>
    `;

    panel.querySelectorAll("input").forEach(function (input) {
        input.addEventListener("input", function () {
            applyPropertyChange(input.dataset.prop, input.value);
        });
    });

    const deleteButtonElement = document.getElementById("deleteCanvasElementBtn");
    if (deleteButtonElement) {
        deleteButtonElement.addEventListener("click", deleteSelectedCanvasElement);
    }
}

function escapeAttribute(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

function applyPropertyChange(property, value) {
    if (!selectedCanvasElement) {
        return;
    }

    if (selectedCanvasIsBody) {
        applyBodyPropertyChange(property, value);
        return;
    }

    if (property === "text") {
        if (selectedCanvasElement.tagName === "IMG") {
            selectedCanvasElement.alt = value;
        } else {
            selectedCanvasElement.textContent = value;
        }
    } else if (property === "src") {
        selectedCanvasElement.src = value;
    } else if (property === "href") {
        selectedCanvasElement.href = value;
    } else if (property === "fontSize") {
        addCssStyle(selectedCanvasElement, "fontSize", value ? value + "px" : "");
    } else if (property === "width" || property === "height") {
        addCssStyle(selectedCanvasElement, property, value);
    } else {
        addCssStyle(selectedCanvasElement, property, value);
    }

    syncCanvasToCode();
}

function addCssStyle(element, property, value) {
    if (!element.dataset.canvasId) {
        return;
    }

    const className = "elem-" + element.dataset.canvasId;

    if (!element.classList.contains(className)) {
        element.classList.add(className);
    }

    const cssMap = getCssClassMap();
    if (!cssMap[className]) {
        cssMap[className] = {};
    }

    if (value === "" || value === null) {
        delete cssMap[className][property];
    } else {
        cssMap[className][property] = value;
    }

    saveCssClassMap(cssMap);
    updateStylesCss(cssMap);
}

function getCssClassMap() {
    try {
        return JSON.parse(localStorage.getItem("mithuCssClassMap") || "{}");
    } catch {
        return {};
    }
}

function saveCssClassMap(cssMap) {
    localStorage.setItem("mithuCssClassMap", JSON.stringify(cssMap));
}

function updateStylesCss(cssMap) {
    let currentCss = getProjectCss();

    // Remove old auto-generated styles section
    const autogenStart = currentCss.indexOf("/* Auto-generated styles */");
    if (autogenStart !== -1) {
        currentCss = currentCss.substring(0, autogenStart).trim();
    }

    let cssText = "/* Auto-generated styles */\n";

    Object.keys(cssMap).forEach(function (className) {
        const styles = cssMap[className];
        if (Object.keys(styles).length > 0) {
            cssText += "." + className + " {\n";
            Object.keys(styles).forEach(function (prop) {
                const cssProp = prop.replace(/([A-Z])/g, function (match) {
                    return "-" + match.toLowerCase();
                });
                cssText += "  " + cssProp + ": " + styles[prop] + ";\n";
            });
            cssText += "}\n";
        }
    });

    projectFiles["style.css"] = currentCss + (currentCss ? "\n" : "") + cssText;

    if (editorModels["style.css"]) {
        editorModels["style.css"].setValue(projectFiles["style.css"]);
    }

    updateCanvasStyles();
    scheduleAutosave();
}

function applyBodyPropertyChange(property, value) {
    const canvasFileName = getCanvasFileName();
    const doc = parseCanvasDocument();
    if (!doc.body) {
        return;
    }

    if (property === "fontSize") {
        doc.body.style.fontSize = value ? value + "px" : "";
    } else {
        doc.body.style[property] = value;
    }

    projectFiles[canvasFileName] = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
    if (editorModels[canvasFileName] && editorModels[canvasFileName].getValue() !== projectFiles[canvasFileName]) {
        editorModels[canvasFileName].setValue(projectFiles[canvasFileName]);
    }
    updateCanvasFromHtml();
    selectCanvasElement(document.getElementById("area"));
    scheduleAutosave();
}

function rgbToHex(value) {
    const match = value.match(/\d+/g);
    if (!match || match.length < 3) {
        return "#ffffff";
    }

    return "#" + match.slice(0, 3).map(function (part) {
        return Number(part).toString(16).padStart(2, "0");
    }).join("");
}

function deleteSelectedCanvasElement() {
    const canvas = document.getElementById("area");
    if (!canvas || !selectedCanvasElement || selectedCanvasIsBody || selectedCanvasElement === canvas) {
        return;
    }

    selectedCanvasElement.remove();
    selectedCanvasElement = null;
    selectedCanvasIsBody = false;
    syncCanvasToCode();
    updateCanvasFromHtml();
    showTab("empty", ".details");
}

function initializeDragDrop() {
    const canvas = document.getElementById("area");
    const el_btns = document.getElementsByClassName("el_btn");

    if (!canvas) {
        return;
    }

    for (const el_btn of el_btns) {
        el_btn.addEventListener("dragstart", function (e) {
            e.dataTransfer.setData("name", e.target.innerText);
        });
    }

    canvas.addEventListener("dragover", function (e) {
        e.preventDefault();
    });

    canvas.addEventListener("input", function () {
        syncCanvasToCode();
        if (selectedCanvasElement) {
            renderSelectedProperties();
        }
    });

    // canvas.addEventListener("click", function (e) {
    //     // const element = e.target.closest("[data-canvas-id]");
    //     // selectCanvasElement(element);
    //     console.log("TARGET:", e.target);
    //     console.log("TAG:", e.target.tagName);
    //     console.log("HAS data-canvas-id:", e.target.dataset.canvasId);

    //     const element = e.target.closest("[data-canvas-id]");

    //     console.log("CLOSEST:", element);

    //     selectCanvasElement(element);
    // });
    // canvas.addEventListener("click", function (e) {

    //     const interactive = e.target.closest("button, a, input, textarea, select, form");

    //     if (interactive) {
    //         e.preventDefault();
    //     }

    // }, true);
    canvas.addEventListener("click", function (e) {

        console.log("TARGET:", e.target);

        const elements = document.elementsFromPoint(e.clientX, e.clientY);

        console.log(elements);

        let element = elements.find(el =>
            el !== canvas &&
            el.dataset &&
            el.dataset.canvasId
        );

        console.log("FOUND:", element);

        selectCanvasElement(element || canvas);

    });

    canvas.addEventListener("mousedown", function (e) {
        if (e.button !== 0) {
            return;
        }

        const element = e.target.closest("[data-canvas-id]");
        if (!element || element === canvas) {
            return;
        }

        e.preventDefault();
        selectCanvasElement(element);

        const canvasRect = canvas.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const scale = getCanvasScaleValue();
        const currentLeft = ((elementRect.left - canvasRect.left) / scale) + canvas.scrollLeft;
        const currentTop = ((elementRect.top - canvasRect.top) / scale) + canvas.scrollTop;

        if (window.getComputedStyle(element).position !== "absolute") {
            const canvasWidth = canvas.offsetWidth;
            const canvasHeight = canvas.offsetHeight;
            const leftPercent = (currentLeft / canvasWidth) * 100;
            const topPercent = (currentTop / canvasHeight) * 100;
            element.style.position = "absolute";
            element.style.left = leftPercent + "%";
            element.style.top = topPercent + "%";
            element.style.margin = "0";
            canvas.appendChild(element);
        }

        const pointerPosition = getCanvasPointerPosition(e, canvas);
        canvasDragState = {
            element,
            offsetX: pointerPosition.x - currentLeft,
            offsetY: pointerPosition.y - currentTop
        };
    });

    window.addEventListener("mousemove", function (e) {
        if (!canvasDragState) {
            return;
        }

        const pointerPosition = getCanvasPointerPosition(e, canvas);
        const left = Math.max(0, Math.round(pointerPosition.x - canvasDragState.offsetX));
        const top = Math.max(0, Math.round(pointerPosition.y - canvasDragState.offsetY));
        const canvasWidth = canvas.offsetWidth;
        const canvasHeight = canvas.offsetHeight;
        const leftPercent = (left / canvasWidth) * 100;
        const topPercent = (top / canvasHeight) * 100;
        canvasDragState.element.style.left = leftPercent + "%";
        canvasDragState.element.style.top = topPercent + "%";
    });

    window.addEventListener("mouseup", function () {
        if (!canvasDragState) {
            return;
        }

        canvasDragState = null;
        syncCanvasToCode();
        renderSelectedProperties();
    });

    canvas.addEventListener("dragstart", function (e) {
        const element = e.target.closest("[data-canvas-id]");
        if (!element || element === canvas) {
            return;
        }

        e.dataTransfer.setData("canvas-id", element.dataset.canvasId);
    });

    canvas.addEventListener("drop", function (e) {
        e.preventDefault();
        const targetElement = e.target.closest("[data-canvas-id]");
        const dropContainer = targetElement && isCanvasContainerElement(targetElement) ? targetElement : canvas;
        const movedId = e.dataTransfer.getData("canvas-id");
        if (movedId) {
            const movedElement = canvas.querySelector(`[data-canvas-id="${movedId}"]`);
            if (movedElement && movedElement !== dropContainer) {
                if (dropContainer === canvas) {
                    canvas.appendChild(movedElement);
                } else {
                    dropContainer.appendChild(movedElement);
                }
            }
            syncCanvasToCode();
            return;
        }

        const name = e.dataTransfer.getData("name");
        let tagName = "";

        const elementMap = {
            "Label": "label",
            "Paragraph": "p",
            "Image": "img",
            "Hyperlink": "a",
            "Division": "div",
            "Text Area": "textarea",
            "Input": "input",
            "Section": "section",
            "Form": "form",
            "H1": "h1",
            "H2": "h2",
            "H3": "h3",
            "H4": "h4",
            "H5": "h5",
            "H6": "h6"
        };
        tagName = elementMap[name] || "";

        if (!tagName) {
            return;
        }

        const item = document.createElement(tagName);

        if (tagName === "p") {
            item.innerText = "New paragraph";
        } else if (tagName === "img") {
            item.src = "img.png";
            item.alt = "Dropped image";
        } else if (tagName === "a") {
            item.href = "#";
            item.innerText = "New link";
        } else if (tagName === "div") {
            item.innerText = "New division";
        } else if (tagName === "input") {
            item.placeholder = "Input";
        } else if (tagName === "textarea") {
            item.placeholder = "Text area";
        } else if (tagName === "label") {
            item.innerText = "New label";
        } else if (tagName === "section" || tagName === "form") {
            item.innerText = "New " + tagName;
        } else {
            item.innerText = "New " + tagName.toUpperCase();
        }

        prepareCanvasElement(item);

        // If dropped inside a container, add with relative positioning and padding
        if (dropContainer !== canvas && isCanvasContainerElement(dropContainer)) {
            item.style.margin = "8px 0";
            item.style.padding = "4px";
            item.style.position = "relative";

            // Add padding to container if not already set
            if (!dropContainer.style.padding || dropContainer.style.padding === "0px" || dropContainer.style.padding === "") {
                addCssStyle(dropContainer, "padding", "2px");
            }

            dropContainer.appendChild(item);
        } else {
            // Dropped on canvas, use absolute positioning with percentages
            item.style.margin = "0";
            item.style.padding = "4px";
            const pointerPosition = getCanvasPointerPosition(e, canvas);
            const canvasWidth = canvas.offsetWidth;
            const canvasHeight = canvas.offsetHeight;
            const leftPercent = ((Math.max(0, Math.round(pointerPosition.x))) / canvasWidth) * 100;
            const topPercent = ((Math.max(0, Math.round(pointerPosition.y))) / canvasHeight) * 100;
            item.style.position = "absolute";
            item.style.left = leftPercent + "%";
            item.style.top = topPercent + "%";

            canvas.appendChild(item);
        }

        selectCanvasElement(item);
        syncCanvasToCode();
    });
}

function isCanvasContainerElement(element) {
    if (!element || !element.tagName) {
        return false;
    }

    return ["DIV", "SECTION", "FORM", "MAIN", "ARTICLE", "ASIDE", "NAV"].includes(element.tagName.toUpperCase());
}

function setupMenuToggles() {
    const file_btn = document.getElementById("fileBtn");
    const edit_btn = document.getElementById("editBtn");
    const export_btn = document.getElementById("exportBtn");
    const fileMenu = document.getElementById("file_menu");
    const editMenu = document.getElementById("edit_menu");
    const exportMenu = document.getElementById("export_menu");

    function closeMenus() {
        fileMenu.style.display = "none";
        editMenu.style.display = "none";
        exportMenu.style.display = "none";
    }

    function toggleMenu(menuToToggle) {
        const isOpen = menuToToggle.style.display === "block";
        closeMenus();
        menuToToggle.style.display = isOpen ? "none" : "block";
    }

    file_btn.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleMenu(fileMenu);
    });

    edit_btn.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleMenu(editMenu);
    });

    export_btn.addEventListener("click", function (e) {
        e.stopPropagation();
        toggleMenu(exportMenu);
    });

    [fileMenu, editMenu, exportMenu].forEach(function (menu) {
        menu.addEventListener("click", function (e) {
            e.stopPropagation();
        });
    });

    window.addEventListener("click", closeMenus);
}

function runEditorAction(actionId) {
    if (!editor) {
        return;
    }

    editor.focus();
    editor.trigger("menu", actionId, null);
}

function wireToolbarActions() {
    const actionBindings = [
        ["undoBtn", function () { runEditorAction("undo"); }],
        ["redoBtn", function () { runEditorAction("redo"); }],
        ["cutBtn", function () { runEditorAction("editor.action.clipboardCutAction"); }],
        ["copyBtn", function () { runEditorAction("editor.action.clipboardCopyAction"); }],
        ["pasteBtn", function () { runEditorAction("editor.action.clipboardPasteAction"); }],
        ["findBtn", function () { runEditorAction("actions.find"); }],
        ["replaceBtn", function () { runEditorAction("editor.action.startFindReplaceAction"); }],
        ["saveProjectBtn", async function () {
            const response = await persistProject();
            if (!response || !response.success) {
                alert(response && response.error ? response.error : "Save failed");
            }
        }],
        ["saveProjectAsBtn", async function () {
            const response = await saveProjectAs();
            if (!response || !response.success) {
                alert(response && response.error ? response.error : "Save As failed");
            }
        }],
        ["openFileBtn", async function () {
            const result = await window.api.pickFile({
                defaultPath: currentProjectPath || undefined
            });

            if (!result) {
                return;
            }

            const fileName = result.filePath.split(/[\\/]/).pop();
            projectFiles[fileName] = result.content;
            syncEditorModels();
            openFileInEditor(fileName);
        }],
        ["previewBtn", async function () {
            if (!currentProjectPath) {
                alert("Open a project first.");
                return;
            }

            await window.api.previewProject(currentProjectPath);
        }],
        ["exportZipBtn", async function () {
            if (!currentProjectPath) {
                alert("Open a project first.");
                return;
            }

            const response = await window.api.exportProjectZip(currentProjectPath);
            if (response && response.error) {
                alert(response.error);
            }
        }],
        ["exportPdfBtn", async function () {
            if (!currentProjectPath) {
                alert("Open a project first.");
                return;
            }

            const response = await window.api.exportProjectPdf(currentProjectPath);
            if (response && response.error) {
                alert(response.error);
            }
        }],
        ["newFileBtn", async function () {
            if (!currentProjectPath) {
                alert("Open a project first.");
                return;
            }

            const name = prompt("File name (index.html, style.css, script.js):");
            if (!name) {
                return;
            }

            const result = await window.api.createFile({
                basePath: currentProjectPath,
                name
            });

            if (!result || !result.success) {
                alert(result && result.error ? result.error : "Could not create file");
                return;
            }

            if (Object.prototype.hasOwnProperty.call(defaultProjectFiles, name)) {
                await loadProjectData(currentProjectPath, currentProjectState);
            } else {
                projectFiles[name] = "";
                syncEditorModels();
                openFileInEditor(name);
            }
        }]
    ];

    actionBindings.forEach(function ([id, handler]) {
        const button = document.getElementById(id);
        if (button) {
            button.addEventListener("click", handler);
        }
    });
}

function initializeAutosaveControl() {
    const checkbox = document.getElementById("autosaveCheck");
    if (!checkbox) {
        return;
    }

    checkbox.checked = autosaveEnabled;
    checkbox.addEventListener("change", function () {
        autosaveEnabled = checkbox.checked;
        localStorage.setItem("mithuAutosave", String(autosaveEnabled));
        if (autosaveEnabled) {
            scheduleAutosave();
        }
    });
}

function initializePanelToggles() {
    const root = document.querySelector(".root");
    const leftButton = document.getElementById("toggleLeftPanel");
    const rightButton = document.getElementById("toggleRightPanel");

    if (root && leftButton) {
        leftButton.addEventListener("click", function () {
            root.classList.toggle("left_collapsed");
            leftButton.textContent = root.classList.contains("left_collapsed") ? ">" : "<";
        });
    }

    if (root && rightButton) {
        rightButton.addEventListener("click", function () {
            root.classList.toggle("right_collapsed");
            rightButton.textContent = root.classList.contains("right_collapsed") ? "<" : ">";
        });
    }
}

function initializeTreeActions() {
    console.log("initializeTreeActions called");

    const newFileButton = document.getElementById("treeNewFileBtn");
    const newFolderButton = document.getElementById("treeNewFolderBtn");

    console.log("newFileButton:", newFileButton);
    console.log("newFolderButton:", newFolderButton);

    if (newFileButton) {
        console.log("Attaching click listener to newFileButton");
        newFileButton.addEventListener("click", createTreeFile);
    }

    if (newFolderButton) {
        console.log("Attaching click listener to newFolderButton");
        newFolderButton.addEventListener("click", createTreeFolder);
    }
}

async function hydrateEditorFromManage() {
    if (!window.api || typeof window.api.manage_json !== "function") {
        console.log("window.api not available, using fallback");
        // Set a fallback project path for demo/development
        currentProjectPath = "demo-project";
        currentProjectState = "create";
        await loadProjectData(currentProjectPath, currentProjectState);
        return;
    }

    const data = await window.api.manage_json();
    currentProjectPath = data && data.project_path ? data.project_path : "demo-project";
    currentProjectState = data && data.state ? data.state : "create";
    await loadProjectData(currentProjectPath, currentProjectState);
}

function changeMode() {
    const modeButton = document.getElementById("mode");

    if (!modeButton) {
        return;
    }

    if (modeButton.innerText === "Code") {
        showCodeView();
        return;
    }

    showDesignView();
}

async function newProject() {
    if (!window.api || typeof window.api.openFolder !== "function") {
        alert("Project creation not available. You can still edit files in demo mode.");
        return;
    }

    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100vw";
    overlay.style.height = "100vh";
    overlay.style.background = "rgba(0,0,0,0.6)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "9999";

    const box = document.createElement("div");
    box.style.width = "400px";
    box.style.padding = "20px";
    box.style.background = "#0f172a";
    box.style.borderRadius = "10px";
    box.style.boxShadow = "0 10px 30px rgba(0,0,0,0.5)";
    box.style.color = "white";

    box.innerHTML = `
        <h2 style="margin-top:0;">Create New Project</h2>

        <input id="projName" placeholder="Project Name"
            style="width:100%;padding:8px;margin:10px 0;border-radius:5px;border:none;">

        <div style="display:flex;justify-content:flex-end;gap:10px;">
            <button id="cancelBtn">Cancel</button>
            <button id="createBtn">Create</button>
        </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    box.querySelector("#cancelBtn").onclick = () => {
        overlay.remove();
    };

    box.querySelector("#createBtn").onclick = async () => {
        const name = document.getElementById("projName").value.trim();

        if (!name) {
            alert("Enter project name");
            return;
        }

        const result = await window.api.openFolder();
        if (!result) return;

        const basePath = result.folderPath;
        const createFolderResult = await window.api.createFolder({
            basePath,
            name
        });

        if (!createFolderResult || !createFolderResult.success) {
            alert(createFolderResult && createFolderResult.error ? createFolderResult.error : "Unable to create project folder");
            return;
        }

        const projectPath = basePath + "/" + name;

        await window.api.createFile({
            basePath: projectPath,
            name: "index.html"
        });
        await window.api.createFile({
            basePath: projectPath,
            name: "style.css"
        });
        await window.api.createFile({
            basePath: projectPath,
            name: "script.js"
        });

        await window.api.writeManage({
            project_path: projectPath,
            state: "create"
        });
        await window.api.writeFiles([name, basePath]);
        window.api.openEditor(projectPath);
        overlay.remove();
    };
}

async function openProject() {
    if (!window.api || typeof window.api.openFolder !== "function") {
        alert("Project opening not available. Running in demo mode.");
        return;
    }

    const result = await window.api.openFolder();
    if (!result) return;

    const name = result.folderPath.split(/[\\/]/).pop();

    await window.api.writeManage({
        project_path: result.folderPath,
        state: "open"
    });

    await window.api.writeFiles([name, result.folderPath]);
    window.api.openEditor(result.folderPath);
}

function rename() {
    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.top = "0";
    overlay.style.left = "0";
    overlay.style.width = "100vw";
    overlay.style.height = "100vh";
    overlay.style.background = "rgba(0,0,0,0.6)";
    overlay.style.display = "flex";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.zIndex = "9999";

    const box = document.createElement("div");
    box.style.width = "400px";
    box.style.padding = "20px";
    box.style.background = "#0f172a";
    box.style.borderRadius = "10px";
    box.style.boxShadow = "0 10px 30px rgba(0,0,0,0.5)";
    box.style.color = "white";

    box.innerHTML = `
        <h2 style="margin-top:0;">Rename Project</h2>

        <input id="newName" placeholder="New Project Name"
            style="width:100%;padding:8px;margin:10px 0;border-radius:5px;border:none;">

        <div style="display:flex;justify-content:flex-end;gap:10px;">
            <button id="cancel">Cancel</button>
            <button id="renameBtn">Rename</button>
        </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    box.querySelector("#cancel").onclick = () => {
        overlay.remove();
    };

    box.querySelector("#renameBtn").onclick = async () => {
        try {
            const name = document.getElementById("newName").value.trim();

            if (!name) {
                alert("Enter project name");
                return;
            }

            const data = await window.api.manage_json();
            const old = data.project_path;
            const old_state = data.state;
            const newp = old.replace(/[^\/\\]+$/, name);

            const result = await window.api.renameFile({
                oldPath: old,
                newPath: newp
            });

            if (!result.success) {
                alert(result.error);
                return;
            }

            await window.api.writeManage({
                project_path: newp,
                state: old_state
            });

            overlay.remove();
            window.api.openEditor(newp);
        } catch (err) {
            console.error(err);
            alert("Rename failed");
        }
    };
}

function initializeApp() {
    if (appReady) {
        return;
    }

    appReady = true;
    initialize_controls();
    initializeBackend();
    setupMenuToggles();
    initializeAutosaveControl();
    initializePanelToggles();
    initializeTreeActions();
    wireToolbarActions();
    initializeDragDrop();

    hydrateEditorFromManage().then(function () {
        updateActiveTab();
    });

    initializeMonaco().catch(function () {
    });

    if (window.api && typeof window.api.onLoadProject === "function") {
        window.api.onLoadProject(async (folderPath) => {
            activeFile = "index.html";
            await loadProjectData(folderPath, "open");
            updateActiveTab();
            if (editorModels[activeFile] && editor) {
                editor.setModel(editorModels[activeFile]);
                editor.focus();
            }
        });
    }
}

window.getCode = function () {
    if (!editor) {
        return "";
    }

    saveActiveFile();
    return editor.getValue();
};

window.addEventListener("DOMContentLoaded", initializeApp);
window.addEventListener("resize", function () {
    if (editor) {
        editor.layout();
    }
});
