const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {

    openFolder: () => ipcRenderer.invoke('open-folder'),
    file_json: () => ipcRenderer.invoke('files'),
    manage_json: () => ipcRenderer.invoke('manage'),
    writeManage: (data) => ipcRenderer.invoke("write-manage", data),
    writeFiles: (data) => ipcRenderer.invoke("write-files", data),
    readFile: (path) => ipcRenderer.invoke('read-file', path),
    getProjectFiles: (projectPath) => ipcRenderer.invoke('get-project-files', projectPath),
    saveProject: (data) => ipcRenderer.invoke('save-project', data),
    pickFile: (options) => ipcRenderer.invoke('pick-file', options),
    previewProject: (projectPath) => ipcRenderer.invoke('preview-project', projectPath),
    exportProjectZip: (projectPath) => ipcRenderer.invoke('export-project-zip', projectPath),
    exportProjectPdf: (projectPath) => ipcRenderer.invoke('export-project-pdf', projectPath),
    deleteRecent: (path) => ipcRenderer.invoke("delete-recent", path),
    pathExists: (path) => ipcRenderer.invoke("path-exists", path),
    saveFile: (data) => ipcRenderer.invoke('save-file', data),

    createFolder: (data) => ipcRenderer.invoke('create-folder', data),
    renameFile: (data) => ipcRenderer.invoke('rename-file', data),

    createFile: (data) => ipcRenderer.invoke('create-file', data),
    openEditor: (folderPath) => ipcRenderer.invoke('open-editor', folderPath),
    openHome: () => ipcRenderer.invoke('open-home'),

    onLoadProject: (callback) => ipcRenderer.on('load-project', (e, data) => callback(data))
});
