const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');

let win;

const fileDataPath = path.join(__dirname, 'files.json');
const managePath = path.join(__dirname, 'manage.json');

const defaultProjectFiles = {
    'index.html': `<!DOCTYPE html>
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
    'style.css': `body {
    margin: 0;
    font-family: Arial, sans-serif;
}`,
    'script.js': `document.addEventListener("DOMContentLoaded", function () {
    console.log("Hello Mithu Web IDE");
});`
};
const textFileExtensions = new Set([
    '.html',
    '.htm',
    '.css',
    '.js',
    '.json',
    '.txt',
    '.md',
    '.xml',
    '.svg',
    '.csv',
    '.yaml',
    '.yml'
]);

function readJsonFile(filePath, fallbackValue) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
        return fallbackValue;
    }
}

function writeJsonFile(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 4));
}

function getCurrentFileData() {
    return readJsonFile(fileDataPath, { files: [] });
}

function getCurrentManageData() {
    return readJsonFile(managePath, { project_path: '', state: 'create' });
}

function setWindowTitle(title) {
    if (win && !win.isDestroyed()) {
        win.setTitle(title);
    }
}

function getProjectFiles(projectPath) {
    const files = {};

    function walkDirectory(directoryPath) {
        const entries = fs.readdirSync(directoryPath, { withFileTypes: true });

        for (const entry of entries) {
            const fullPath = path.join(directoryPath, entry.name);

            if (entry.isDirectory()) {
                walkDirectory(fullPath);
                continue;
            }

            const extension = path.extname(entry.name).toLowerCase();
            if (!textFileExtensions.has(extension)) {
                continue;
            }

            try {
                const relativePath = path.relative(projectPath, fullPath).replace(/\\/g, '/');
                files[relativePath] = fs.readFileSync(fullPath, 'utf8');
            } catch {
                const relativePath = path.relative(projectPath, fullPath).replace(/\\/g, '/');
                files[relativePath] = '';
            }
        }
    }

    walkDirectory(projectPath);

    for (const [fileName, fallbackContent] of Object.entries(defaultProjectFiles)) {
        if (!Object.prototype.hasOwnProperty.call(files, fileName)) {
            files[fileName] = fallbackContent;
        }
    }

    return files;
}

async function saveProjectFiles(projectPath, files) {
    for (const [fileName, content] of Object.entries(files || {})) {
        const fullPath = path.join(projectPath, fileName);
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.promises.writeFile(fullPath, String(content ?? ''), 'utf8');
    }
}

function runPowerShell(command) {
    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-Command', command], {
            windowsHide: true
        });

        let stderr = '';

        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });

        child.on('error', reject);
        child.on('close', (code) => {
            if (code === 0) {
                resolve();
                return;
            }

            reject(new Error(stderr.trim() || `PowerShell exited with code ${code}`));
        });
    });
}

function createWindow() {
    win = new BrowserWindow({
        width: 1200,
        height: 600,
        minWidth: 1200,
        minHeight: 600,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true
        },
        icon: path.join(__dirname, 'favicon (4).ico')
    });

    win.loadFile('welcome.html');

    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    win.webContents.on('will-navigate', (event, url) => {
        if (url !== win.webContents.getURL()) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });
}

app.whenReady().then(createWindow);

ipcMain.handle('files', async () => getCurrentFileData());

ipcMain.handle('manage', async () => getCurrentManageData());

ipcMain.handle('write-files', async (event, data) => {
    try {
        const json = getCurrentFileData();
        json.files.push(data);

        const unique = [];
        const seen = new Set();

        for (const item of json.files) {
            const projectPath = item[1];
            if (!seen.has(projectPath)) {
                seen.add(projectPath);
                unique.push(item);
            }
        }

        json.files = unique;
        writeJsonFile(fileDataPath, json);

        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('write-manage', async (event, data) => {
    try {
        writeJsonFile(managePath, data);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('path-exists', async (event, targetPath) => {
    return fs.existsSync(targetPath);
});

ipcMain.handle('delete-recent', async (event, targetPath) => {
    try {
        const json = getCurrentFileData();
        json.files = (json.files || []).filter(item => item[1] !== targetPath);
        writeJsonFile(fileDataPath, json);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('open-editor', (event, folderPath) => {
    win.loadFile('index.html');

    win.webContents.once('did-finish-load', () => {
        win.webContents.send('load-project', folderPath);
        setWindowTitle(`Mithu Web IDE - ${folderPath}`);
    });
});

ipcMain.handle('open-home', () => {
    win.loadFile('welcome.html');
    setWindowTitle('Mithu Web IDE');
});

ipcMain.handle('rename-file', async (event, { oldPath, newPath }) => {
    try {
        await fs.promises.rename(oldPath, newPath);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('open-folder', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openDirectory']
    });

    if (result.canceled) return null;

    const folderPath = result.filePaths[0];

    function readDirRecursive(dir) {
        return fs.readdirSync(dir).map(file => {
            const fullPath = path.join(dir, file);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                return {
                    name: file,
                    type: 'folder',
                    path: fullPath,
                    children: readDirRecursive(fullPath)
                };
            }

            return {
                name: file,
                type: 'file',
                path: fullPath
            };
        });
    }

    return {
        folderPath,
        tree: readDirRecursive(folderPath)
    };
});

ipcMain.handle('get-project-files', async (event, projectPath) => {
    return {
        success: true,
        files: getProjectFiles(projectPath)
    };
});

ipcMain.handle('save-project', async (event, { projectPath, files }) => {
    try {
        await saveProjectFiles(projectPath, files);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('pick-file', async (event, options = {}) => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        defaultPath: options.defaultPath || undefined,
        filters: options.filters || [
            { name: 'Web files', extensions: ['html', 'css', 'js'] },
            { name: 'All files', extensions: ['*'] }
        ]
    });

    if (result.canceled || !result.filePaths.length) {
        return null;
    }

    const filePath = result.filePaths[0];
    const content = await fs.promises.readFile(filePath, 'utf8');
    return { filePath, content };
});

ipcMain.handle('preview-project', async (event, projectPath) => {
    const indexPath = path.join(projectPath, 'index.html');
    shell.openExternal(pathToFileURL(indexPath).href);
    return { success: true };
});

ipcMain.handle('export-project-zip', async (event, projectPath) => {
    const suggestedName = `${path.basename(projectPath)}.zip`;
    const saveResult = await dialog.showSaveDialog({
        defaultPath: path.join(path.dirname(projectPath), suggestedName),
        filters: [{ name: 'Zip Archive', extensions: ['zip'] }]
    });

    if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, canceled: true };
    }

    const escapedProjectPath = projectPath.replace(/'/g, "''");
    const escapedZipPath = saveResult.filePath.replace(/'/g, "''");
    const command = `Compress-Archive -Path (Join-Path '${escapedProjectPath}' '*') -DestinationPath '${escapedZipPath}' -Force`;

    try {
        await runPowerShell(command);
        return { success: true, path: saveResult.filePath };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('export-project-pdf', async (event, projectPath) => {
    const saveResult = await dialog.showSaveDialog({
        defaultPath: path.join(path.dirname(projectPath), `${path.basename(projectPath)}.pdf`),
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });

    if (saveResult.canceled || !saveResult.filePath) {
        return { success: false, canceled: true };
    }

    const previewWindow = new BrowserWindow({
        show: false,
        webPreferences: {
            backgroundThrottling: false
        }
    });

    try {
        await previewWindow.loadURL(pathToFileURL(path.join(projectPath, 'index.html')).href);
        const pdfBuffer = await previewWindow.webContents.printToPDF({
            printBackground: true,
            preferCSSPageSize: true
        });

        await fs.promises.writeFile(saveResult.filePath, pdfBuffer);
        previewWindow.close();
        return { success: true, path: saveResult.filePath };
    } catch (err) {
        previewWindow.close();
        return { success: false, error: err.message };
    }
});

ipcMain.handle('read-file', async (event, filePath) => {
    return fs.readFileSync(filePath, 'utf-8');
});

ipcMain.handle('save-file', async (event, { filePath, content }) => {
    fs.writeFileSync(filePath, content);
    return true;
});

ipcMain.handle('create-folder', async (event, { basePath, name }) => {
    const fullPath = path.join(basePath, name);

    try {
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
            return { success: true };
        }
        return { success: false, error: 'Folder already exists' };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('create-file', async (event, { basePath, name }) => {
    const fullPath = path.join(basePath, name);

    try {
        if (fs.existsSync(fullPath)) {
            return { success: false, error: 'File already exists' };
        }

        fs.mkdirSync(path.dirname(fullPath), { recursive: true });

        let content = '';

        if (name === 'index.html') {
            content = defaultProjectFiles['index.html'];
        } else if (name === 'style.css') {
            content = defaultProjectFiles['style.css'];
        } else if (name === 'script.js') {
            content = defaultProjectFiles['script.js'];
        }

        fs.writeFileSync(fullPath, content);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});
