const updateStatus = document.getElementById('updateStatus');
const checkForUpdatesButton = document.getElementById('checkForUpdates');

checkForUpdatesButton.addEventListener('click', () => {
  window.electronAPI.checkForUpdates();
});

window.electronAPI.onUpdateAvailable((event, info) => {
  updateStatus.textContent = `Update available: ${info.version}`;
  const downloadButton = document.createElement('button');
  downloadButton.textContent = 'Download Update';
  downloadButton.onclick = () => window.electronAPI.downloadUpdate();
  updateStatus.appendChild(downloadButton);
});

window.electronAPI.onUpdateNotAvailable(() => {
  updateStatus.textContent = 'No updates available.';
});

window.electronAPI.onUpdateError((event, error) => {
  updateStatus.textContent = `Error: ${error}`;
});

window.electronAPI.onDownloadProgress((event, percent) => {
  updateStatus.textContent = `Downloading: ${percent.toFixed(2)}%`;
});

window.electronAPI.onUpdateDownloaded((event, info) => {
  updateStatus.textContent = `Update downloaded. Version: ${info.version}`;
  const installButton = document.createElement('button');
  installButton.textContent = 'Install and Restart';
  installButton.onclick = () => window.electronAPI.quitAndInstall();
  updateStatus.appendChild(installButton);
});