// Preload-мост для собранного приложения (sandbox: nodeIntegration выключен).
// Открывает рендеру только точечные возможности через contextBridge.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('karaokeStudio', {
  /**
   * Сохранить текстовый файл через нативный диалог (main-процесс).
   * @param {{ fileName: string, text: string }} payload
   * @returns {Promise<{ saved: boolean, filePath?: string }>}
   */
  saveTextFile: (payload) => ipcRenderer.invoke('karaoke:save-text-file', payload),
});
