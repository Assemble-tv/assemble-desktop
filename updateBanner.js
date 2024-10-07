let updateDownloaded = false;

window.electronAPI.onUpdateAvailable((event, info) => {
  document.getElementById('update-banner').style.display = 'block';
});

window.electronAPI.onDownloadProgress((event, progressObj) => {
  const downloadPercent = Math.round(progressObj.percent);
  document.getElementById('update-button').textContent = `Downloading: ${downloadPercent}%`;
});

window.electronAPI.onUpdateDownloaded(() => {
  updateDownloaded = true;
  document.getElementById('update-button').textContent = 'Restart to Install';
});

window.electronAPI.onUpdateError((event, error) => {
  console.error('Update error:', error);
  document.getElementById('update-banner').style.display = 'none';
});

document.getElementById('update-button').addEventListener('click', () => {
  if (updateDownloaded) {
    window.electronAPI.quitAndInstall();
  } else {
    window.electronAPI.startDownload();
  }
});