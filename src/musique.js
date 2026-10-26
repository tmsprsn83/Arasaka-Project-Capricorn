// Musique en cours sur le PC (Spotify, YouTube dans le navigateur, lecteur Windows… : tout ce qui alimente le panneau
// média de Windows) : titre, artiste, pochette, lecture ou pause, et volume général. Un PowerShell tourne en continu,
// interroge Windows chaque seconde et n'écrit une ligne JSON que quand quelque chose change (la pochette, en base64,
// seulement quand le morceau change). Il reçoit aussi « volume +0.02 » / « volume -0.02 » sur son entrée.
const { spawn } = require('child_process');

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + '`' + String.raw`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.IRandomAccessStreamWithContentType, Windows.Storage.Streams, ContentType = WindowsRuntime]
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume { int f(); int g(); int h(); int i(); int SetMasterVolumeLevelScalar(float level, Guid ctx); int j(); int GetMasterVolumeLevelScalar(out float level); int k(); int l(); int m(); int n(); int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, Guid ctx); int GetMute(out bool mute); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id, int clsCtx, int p, out IAudioEndpointVolume aev); }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int f(); int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice dev); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorComObject { }
public static class CapriVolume {
  static IAudioEndpointVolume Vol() { var e = new MMDeviceEnumeratorComObject() as IMMDeviceEnumerator; IMMDevice d; Marshal.ThrowExceptionForHR(e.GetDefaultAudioEndpoint(0, 1, out d)); IAudioEndpointVolume v; var id = typeof(IAudioEndpointVolume).GUID; Marshal.ThrowExceptionForHR(d.Activate(ref id, 23, 0, out v)); return v; }
  public static float Get() { float v; Marshal.ThrowExceptionForHR(Vol().GetMasterVolumeLevelScalar(out v)); return v; }
  public static bool Muted() { bool m; Marshal.ThrowExceptionForHR(Vol().GetMute(out m)); return m; }
  public static void Set(float v) { Marshal.ThrowExceptionForHR(Vol().SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, v)), Guid.Empty)); }
}
'@
$mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$cmd = $stdin.ReadLineAsync()
$lastKey = $null; $lastLine = $null
while ($true) {
  try {
    if ($cmd.IsCompleted) {
      $line = $cmd.Result
      if ($null -eq $line) { break }
      if ($line -match '^volume ([-+]?[0-9.]+)$') { [CapriVolume]::Set([CapriVolume]::Get() + [float]$Matches[1]) }
      $cmd = $stdin.ReadLineAsync()
    }
    $out = @{ volume = [Math]::Round([CapriVolume]::Get(), 2); muted = [CapriVolume]::Muted() }
    $s = $mgr.GetCurrentSession()
    if ($s) {
      $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $out.app = $s.SourceAppUserModelId; $out.artist = $p.Artist; $out.title = $p.Title; $out.album = $p.AlbumTitle
      $out.playing = ($s.GetPlaybackInfo().PlaybackStatus -eq 'Playing')
      $key = "$($out.app)|$($out.artist)|$($out.title)"
      if ($key -ne $lastKey) {
        $lastKey = $key
        $out.thumb = $null
        if ($p.Thumbnail) {
          try {
            $st = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
            $size = [uint32]([Windows.Storage.Streams.IRandomAccessStream].GetProperty('Size').GetValue($st))
            $in = [Windows.Storage.Streams.IRandomAccessStream].GetMethod('GetInputStreamAt').Invoke($st, @([uint64]0))
            $r = [Windows.Storage.Streams.DataReader]::new($in)
            $null = Await ($r.LoadAsync($size)) ([uint32])
            $bytes = New-Object byte[] $size; $r.ReadBytes($bytes)
            $out.thumb = [Convert]::ToBase64String($bytes)
          } catch { }
        }
        $out.changed = $true
      }
    } else { $out.playing = $false; $lastKey = $null }
    $json = $out | ConvertTo-Json -Compress
    if ($out.changed -or $json -ne $lastLine) { [Console]::Out.WriteLine($json); [Console]::Out.Flush() }
    if (-not $out.changed) { $lastLine = $json } else { $out.Remove('thumb'); $out.Remove('changed'); $lastLine = $out | ConvertTo-Json -Compress }
  } catch { [Console]::Out.WriteLine((@{ erreur = $_.Exception.Message } | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
  Start-Sleep -Milliseconds 800
}
`;

// onChange({ playing, title, artist, album, app, volume, muted, thumb? }) ; thumb : data URL, seulement au changement.
function createMusique(onChange) {
  let child = null;
  let closed = false;
  let restart = null;
  const start = () => {
    if (closed) return;
    child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(SCRIPT, 'utf16le').toString('base64')], { windowsHide: true });
    let buffer = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i).trim();
        buffer = buffer.slice(i + 1);
        if (!line) continue;
        let info;
        try { info = JSON.parse(line); } catch { continue; }
        if (info.erreur) continue;
        if (info.thumb) {
          const png = info.thumb.startsWith('iVBOR');
          info.thumb = `data:image/${png ? 'png' : 'jpeg'};base64,${info.thumb}`;
        }
        onChange(info);
      }
    });
    child.stderr.on('data', () => {});
    child.on('error', () => {});
    child.on('close', () => {
      child = null;
      if (!closed) restart = setTimeout(start, 5000); // relancé s'il s'arrête
    });
  };
  start();
  return {
    volume(delta) { if (child) child.stdin.write(`volume ${delta > 0 ? '+' : ''}${delta}\n`); },
    close() { closed = true; clearTimeout(restart); if (child) child.kill(); },
  };
}

module.exports = { createMusique };
