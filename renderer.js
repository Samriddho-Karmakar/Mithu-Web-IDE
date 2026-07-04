let currentFolderPath = null;
let currentFilePath = null;


// ---------------- OPEN FOLDER ----------------

async function openFolder() {
    const result = await window.api.openFolder();

    if (!result) return;

    currentFolderPath = result.folderPath;
    renderTree(result.tree);
}


// ---------------- RENDER FILE TREE ----------------

function renderTree(tree) {
    const container = document.getElementById("fileTree");
    container.innerHTML = "";

    function createNode(item) {
        const el = document.createElement("div");
        el.textContent = item.name;

        if (item.type === "file") {
            el.style.cursor = "pointer";

            el.onclick = async () => {
                const content = await window.api.readFile(item.path);
                document.getElementById("editor").value = content;
                currentFilePath = item.path;
            };

        } else {
            el.style.fontWeight = "bold";

            const children = document.createElement("div");
            children.style.marginLeft = "15px";

            item.children.forEach(child => {
                children.appendChild(createNode(child));
            });

            el.appendChild(children);
        }

        return el;
    }

    tree.forEach(item => {
        container.appendChild(createNode(item));
    });
}


// ---------------- SAVE FILE ----------------

async function saveFile() {
    if (!currentFilePath) {
        alert("No file selected");
        return;
    }

    const content = document.getElementById("editor").value;

    await window.api.saveFile({
        filePath: currentFilePath,
        content
    });

    alert("Saved");
}


// ---------------- CREATE FOLDER ----------------

async function createFolder() {
    const name = prompt("Folder name:");
    if (!name || !currentFolderPath) return;

    const res = await window.api.createFolder({
        basePath: currentFolderPath,
        name
    });

    if (res.success) {
        openFolder();
    } else {
        alert(res.error);
    }
}


// ---------------- CREATE FILE ----------------

async function createFile() {
    const name = prompt("File name:");
    if (!name || !currentFolderPath) return;

    const res = await window.api.createFile({
        basePath: currentFolderPath,
        name
    });

    if (res.success) {
        openFolder();
    } else {
        alert(res.error);
    }
}

async function createProject() {
    const name = document.getElementById("pr_name").value;

    if (!name) {
        alert("Enter project name");
        return;
    }

    // choose location
    const result = await window.api.openFolder();
    if (!result) return;

    const basePath = result.folderPath;

    // create main project folder
    await window.api.createFolder({
        basePath,
        name
    });

    const projectPath = basePath + "/" + name;

    // create default files
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

    // 🔥 OPEN EDITOR
    await window.api.writeManage({
        project_path: projectPath,
        state: "create"
    });
    await window.api.writeFiles([name, basePath]);
    window.api.openEditor(projectPath);
}
async function openProject() {
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
function loadRecentStyles() {
    const style = document.createElement("style");

    style.innerHTML = `
    .cards{
        transition: 0.2s ease;
        cursor: pointer;
    }

    .cards:hover{
        background-color: #1e2c6e7e !important;
    }
    .del:hover{
        background-color: #1e2b6ebe !important;
    }
    .del:active{
        background-color: rgb(68, 133, 253) !important;
    }
    .recent_left:active{
        background-color: rgb(68, 133, 253) !important;
    }
    `;

    document.head.appendChild(style);
}
async function recent(name, path) {
    const box = document.getElementById("recent");

    const child = document.createElement("div");

    child.style.display = "flex";
    child.style.height = "50px";
    child.style.width = "100%";
    child.className = "cards";
    child.style.backgroundColor = "#0c1333a6";
    child.innerHTML = `
    <div class="recent_left" style="padding-left: 1%; width: calc(100% - 50px); height: 50px;">
        <h3 style="margin: 2px; font-weight: bolder;">`+ name + `</h3>
        <p style="margin: 4px; font-size: 12px; color: #b6b6b6">`+ path + `</p>
        <div style="height: 2px; width: 100%; background-color: rgba(240, 248, 255, 0.664);"></div>
    </div>

    <div class="del" style="height: 50px; width: 50px;"><img src="./trash.png" height="47px"><div style="margin: 0px; height: 2px; width: 100%; background-color: rgba(240, 248, 255, 0.664);"></div></div>
`;

    box.appendChild(child);
}


window.addEventListener("DOMContentLoaded", async () => {
    const data = await window.api.file_json();

    if (!Array.isArray(data.files)) return;

    data.files.forEach(item => {
        recent(item[0], item[1]);
    });
    loadRecentStyles();

    const recent_tab = document.getElementById("recent");

    if (!recent_tab) return;

    recent_tab.addEventListener("click", async function (event) {

        try {

            const delBtn = event.target.closest(".del");

            /* DELETE */
            if (delBtn) {

                const card = delBtn.closest(".cards");
                if (!card) return;

                const path = card.querySelector("p").innerText.trim();

                if (window.api.deleteRecent) {
                    await window.api.deleteRecent(path);
                }

                card.remove();
                return;
            }

            /* OPEN */
            const card = event.target.closest(".recent_left");
            if (!card) return;

            const name = card.querySelector("h3").innerText.trim();
            const path = card.querySelector("p").innerText.trim();

            let exists = true;

            if (window.api.pathExists) {
                exists = await window.api.pathExists(path);
            }

            if (!exists) {
                alert("Project deleted or moved.");
                card.closest(".cards").remove();
                return;
            }

            await window.api.writeManage({
                project_path: path,
                state: "open"
            });

            await window.api.writeFiles([name, path]);

            await window.api.openEditor(path);

        } catch (error) {
            console.error(error);
            alert(error.message);
        }

    });

});

window.api.onLoadProject(async (folderPath) => {
    currentFolderPath = folderPath;

    const result = await window.api.openFolder(); // reload tree
    if (!result) return;

    renderTree(result.tree);

    // 🔥 Auto open index.html
    const indexFile = folderPath + "/index.html";

    try {
        const content = await window.api.readFile(indexFile);

        document.getElementById("editor").value = content;
        currentFilePath = indexFile;
    } catch {
        console.log("No index.html found");
    }
});