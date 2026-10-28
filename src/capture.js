// Vignette de l'écran principal pour l'éclairage en jeu (ambiance.js) : un PowerShell réduit l'écran à 64 × 36 par
// GDI (StretchBlt, bien plus léger que desktopCapturer qui capture l'écran entier) et écrit chaque image en base64
// (BGRA), une par ligne, toutes les `every` ms. Rien n'est enregistré ; le processus s'arrête avec stop().
const { spawn } = require('child_process');

const W = 64, H = 36;

const script = (every) => String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices;
public static class CapriVignette {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr w);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr w, IntPtr dc);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleBitmap(IntPtr dc, int w, int h);
  [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc, IntPtr o);
  [DllImport("gdi32.dll")] static extern int SetStretchBltMode(IntPtr dc, int mode);
  [DllImport("gdi32.dll")] static extern bool SetBrushOrgEx(IntPtr dc, int x, int y, IntPtr p);
  [DllImport("gdi32.dll")] static extern bool StretchBlt(IntPtr d, int dx, int dy, int dw, int dh, IntPtr s, int sx, int sy, int sw, int sh, int rop);
  [DllImport("gdi32.dll")] static extern int GetDIBits(IntPtr dc, IntPtr bmp, int start, int lines, byte[] bits, int[] info, int usage);
  static IntPtr screen, mem, bmp; static int sw, sh;
  public static void Open() {
    SetProcessDPIAware();
    screen = GetDC(IntPtr.Zero); sw = GetSystemMetrics(0); sh = GetSystemMetrics(1);
    mem = CreateCompatibleDC(screen); bmp = CreateCompatibleBitmap(screen, ${W}, ${H}); SelectObject(mem, bmp);
    SetStretchBltMode(mem, 4); SetBrushOrgEx(mem, 0, 0, IntPtr.Zero); // HALFTONE : moyenne des pixels
  }
  public static string Grab() {
    StretchBlt(mem, 0, 0, ${W}, ${H}, screen, 0, 0, sw, sh, 0x00CC0020);
    var info = new int[10]; info[0] = 40; info[1] = ${W}; info[2] = -${H}; info[3] = 1 | (32 << 16); // BITMAPINFOHEADER, haut en bas
    var bits = new byte[${W * H * 4}];
    GetDIBits(mem, bmp, 0, ${H}, bits, info, 0);
    return Convert.ToBase64String(bits);
  }
}
'@
[CapriVignette]::Open()
while ($true) {
  [Console]::Out.WriteLine([CapriVignette]::Grab()); [Console]::Out.Flush()
  Start-Sleep -Milliseconds ${every}
}
`;

// onFrame(bgra Buffer, W, H) à chaque image.
function startCapture(onFrame, { every = 200 } = {}) {
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script(every), 'utf16le').toString('base64')], { windowsHide: true });
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 1);
      if (!line) continue;
      const bmp = Buffer.from(line, 'base64');
      if (bmp.length === W * H * 4) onFrame(bmp, W, H);
    }
  });
  child.stderr.on('data', () => {});
  child.on('error', () => {});
  return { stop() { child.kill(); } };
}

module.exports = { startCapture };
