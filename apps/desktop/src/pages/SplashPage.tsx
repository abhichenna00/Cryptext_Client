import { useEffect, useState } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import { getCurrentWindow, Window } from '@tauri-apps/api/window';

export default function SplashPage() {
  const [status, setStatus] = useState('Checking for updates...');
  const [progress, setProgress] = useState(0);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    async function run() {
      try {
        const isDev = window.location.port !== '';
        const update = isDev ? null : await check();

        if (update) {
          setStatus(`Downloading v${update.version}...`);
          setUpdating(true);

          let totalBytes = 0;
          await update.downloadAndInstall((event) => {
            if (event.event === 'Started' && event.data.contentLength) {
              totalBytes = event.data.contentLength;
            } else if (event.event === 'Progress') {
              if (totalBytes > 0) {
                setProgress((prev) => {
                  const next = prev + (event.data.chunkLength / totalBytes) * 100;
                  return Math.min(next, 100);
                });
              }
            } else if (event.event === 'Finished') {
              setStatus('Installing...');
            }
          });

          await relaunch();
          return;
        }
      } catch (err) {
        console.error('Update check failed:', err);
      }

      // No update or check failed — show main window, close splash
      const mainWindow = await Window.getByLabel('main');
      if (mainWindow) await mainWindow.show();
      await getCurrentWindow().close();
    }

    run();
  }, []);

  return (
    <div 
      onMouseDown={(e) => {
        if (e.buttons === 1) {
          e.preventDefault();
          getCurrentWindow().startDragging();
        }
      }}
      style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      background: '#1a1a2e',
      color: '#fff',
      fontFamily: 'sans-serif',
      userSelect: 'none',
    }}>
      <span style={{ fontSize: '20px', fontWeight: 'bold' }}>Cryptext</span>
      <span style={{ fontSize: '13px', color: '#888', marginTop: 12 }}>{status}</span>
      {updating && (
        <div style={{
          width: 200,
          height: 4,
          background: '#333',
          borderRadius: 2,
          marginTop: 12,
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${progress}%`,
            height: '100%',
            background: '#5865f2',
            borderRadius: 2,
            transition: 'width 0.2s',
          }} />
        </div>
      )}
    </div>
  );
}