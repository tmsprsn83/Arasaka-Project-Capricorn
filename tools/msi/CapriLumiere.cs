// Éclairage du PC piloté par CAPRI, par le Mystic Light SDK de MSI (MysticLight_SDK.dll, signé MSI), qui passe par
// MSI Center. Le SDK exige les droits administrateur : ce code tourne dans un petit service à part
// (tools/lumiere-msi.ps1), et CAPRI lui parle par un canal nommé local en n'envoyant que « parle 1 » / « parle 0 ».
// Au repos : la couleur de Tommy (violet, en fixe). Quand elle parle : rouge et vert en rafales irrégulières, comme
// un bug, façon Cyberpunk.
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;
using System.Threading;

public static class CapriLumiere
{
    const string DLL = "MysticLight_SDK.dll";
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr LoadLibrary(string path);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int MLAPI_Initialize();
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int MLAPI_Release();
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int MLAPI_GetErrorMessage(int code, [MarshalAs(UnmanagedType.BStr)] out string desc);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int MLAPI_GetDeviceInfo([MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_BSTR)] out string[] types, [MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_BSTR)] out string[] counts);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int MLAPI_GetLedInfo([MarshalAs(UnmanagedType.BStr)] string type, int index, [MarshalAs(UnmanagedType.BStr)] out string name, [MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_BSTR)] out string[] styles);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int MLAPI_GetLedColor([MarshalAs(UnmanagedType.BStr)] string type, int index, out int r, out int g, out int b);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int MLAPI_GetLedStyle([MarshalAs(UnmanagedType.BStr)] string type, int index, [MarshalAs(UnmanagedType.BStr)] out string style);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int MLAPI_SetLedColor([MarshalAs(UnmanagedType.BStr)] string type, int index, int r, int g, int b);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int MLAPI_SetLedStyle([MarshalAs(UnmanagedType.BStr)] string type, int index, [MarshalAs(UnmanagedType.BStr)] string style);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int MLAPI_GetDeviceName([MarshalAs(UnmanagedType.BStr)] string type, [MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_BSTR)] out string[] names);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int MLAPI_GetLedName([MarshalAs(UnmanagedType.BStr)] string type, [MarshalAs(UnmanagedType.SafeArray, SafeArraySubType = VarEnum.VT_BSTR)] out string[] names);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int MLAPI_SetLedColorEx([MarshalAs(UnmanagedType.BStr)] string type, int area, [MarshalAs(UnmanagedType.BStr)] string ledName, int r, int g, int b, int update);

    class Led
    {
        public string Type, Name, Style, Static;
        public int Index, R, G, B;
        public string[] Styles;
    }

    static readonly List<Led> leds = new List<Led>();
    static readonly object gate = new object();
    static volatile bool speaking;

    static string Error(int code)
    {
        string desc;
        try { MLAPI_GetErrorMessage(code, out desc); } catch { desc = null; }
        return code + (string.IsNullOrEmpty(desc) ? "" : " (" + desc + ")");
    }

    // Charge la DLL du dossier donné et ouvre le SDK (MSI Center peut mettre un moment à démarrer à l'ouverture de
    // session : on réessaie jusqu'à `waitSeconds`).
    static void Open(string dir, int waitSeconds)
    {
        if (LoadLibrary(Path.Combine(dir, DLL)) == IntPtr.Zero) throw new Exception("MysticLight_SDK.dll introuvable dans " + dir);
        var until = DateTime.Now.AddSeconds(waitSeconds);
        while (true)
        {
            int ret = MLAPI_Initialize();
            if (ret == 0) break;
            if (DateTime.Now > until) throw new Exception("MLAPI_Initialize : " + Error(ret));
            Thread.Sleep(3000);
        }
        string[] types, counts;
        int r = MLAPI_GetDeviceInfo(out types, out counts);
        if (r != 0) throw new Exception("MLAPI_GetDeviceInfo : " + Error(r));
        for (int i = 0; i < types.Length; i++)
        {
            int n = int.Parse(counts[i]);
            for (int k = 0; k < n; k++)
            {
                var led = new Led { Type = types[i], Index = k };
                string name; string[] styles;
                if (MLAPI_GetLedInfo(led.Type, k, out name, out styles) == 0) { led.Name = name; led.Styles = styles ?? new string[0]; }
                else { led.Name = "?"; led.Styles = new string[0]; }
                string style;
                if (MLAPI_GetLedStyle(led.Type, k, out style) == 0) led.Style = style;
                int R, G, B;
                if (MLAPI_GetLedColor(led.Type, k, out R, out G, out B) == 0) { led.R = R; led.G = G; led.B = B; }
                // Style fixe, pour que la couleur posée s'affiche telle quelle.
                foreach (var want in new[] { "Steady", "Static", "Always On", "No Animation" })
                    foreach (var s in led.Styles)
                        if (led.Static == null && s.Equals(want, StringComparison.OrdinalIgnoreCase)) led.Static = s;
                leds.Add(led);
            }
        }
    }

    // Relevé de l'éclairage (sans rien changer) : `npm run lumiere -- -Sonde`.
    public static string Probe(string dir)
    {
        var sb = new StringBuilder();
        try
        {
            Open(dir, 0);
            foreach (var l in leds)
                sb.AppendLine(string.Format("{0}[{1}] « {2} » style={3} couleur={4},{5},{6} fixe={7} styles=[{8}]", l.Type, l.Index, l.Name, l.Style, l.R, l.G, l.B, l.Static ?? "-", string.Join(", ", l.Styles)));
            if (leds.Count == 0) sb.AppendLine("Aucun éclairage trouvé.");
            // LED une par une : noms des appareils et des LED (« zone:nom ») de chaque type.
            var types = new HashSet<string>();
            foreach (var l in leds) types.Add(l.Type);
            foreach (var t in types)
            {
                string[] dev, names;
                int r1 = MLAPI_GetDeviceName(t, out dev);
                sb.AppendLine(t + " appareils (" + r1 + ") : " + (dev == null ? "-" : string.Join(" | ", dev)));
                int r2 = MLAPI_GetLedName(t, out names);
                sb.AppendLine(t + " LED (" + r2 + ", " + (names == null ? 0 : names.Length) + ") : " + (names == null ? "-" : string.Join(" | ", names)));
            }
        }
        catch (Exception e) { sb.AppendLine("Erreur : " + e.Message); }
        finally { try { MLAPI_Release(); } catch { } }
        return sb.ToString();
    }

    static void Paint(int r, int g, int b)
    {
        foreach (var l in leds)
        {
            if (l.Static == null) continue;
            MLAPI_SetLedColor(l.Type, l.Index, r, g, b);
        }
    }

    // Couleur de repos de Tommy (violet). Le SDK ne lit pas la couleur réglée dans MSI Center (il ne voit que le
    // style « Default » et un rouge sans rapport) : on la pose donc nous-mêmes, en fixe.
    static int baseR = 128, baseG = 0, baseB = 255;

    // Uniquement les couleurs de CAPRI : le rouge de ses cheveux (#F80030) et le vert de sa visière (#00FF66).
    // La couleur change à 80 % des flashs, pour que chaque flash se voie.
    static bool lastRed;
    static void Pick(Random rnd)
    {
        lastRed = rnd.Next(100) < 80 ? !lastRed : lastRed;
        if (lastRed) Paint(248, 0, 48);
        else Paint(0, 255, 102);
    }

    // Bug : rafales de flashs très rapides, puis l'image se fige un temps au hasard (sur une couleur ou éteinte),
    // et ça repart — irrégulier, pour qu'on se dise bien que ça bugge.
    static void Bug()
    {
        lock (gate) foreach (var l in leds) if (l.Static != null) MLAPI_SetLedStyle(l.Type, l.Index, l.Static);
        var rnd = new Random();
        while (speaking)
        {
            int flashes = 3 + rnd.Next(10);
            for (int i = 0; i < flashes && speaking; i++)
            {
                lock (gate) Pick(rnd);
                Thread.Sleep(12 + rnd.Next(38));
            }
            if (!speaking) break;
            lock (gate) Pick(rnd);
            int pause = rnd.Next(100) < 70 ? 60 + rnd.Next(240) : 300 + rnd.Next(600);
            Thread.Sleep(pause);
        }
    }

    // Repos : le violet de Tommy, en fixe.
    static void Restore()
    {
        lock (gate)
            foreach (var l in leds)
            {
                if (l.Static == null) continue;
                MLAPI_SetLedStyle(l.Type, l.Index, l.Static);
                MLAPI_SetLedColor(l.Type, l.Index, baseR, baseG, baseB);
            }
    }

    static void Speak(bool on)
    {
        if (on == speaking) return;
        speaking = on;
        if (on) new Thread(Bug) { IsBackground = true }.Start();
        else { Thread.Sleep(250); Restore(); }
    }

    // Service : canal nommé `pipeName`, ouvert au seul compte `userSid` (celui de Tommy, sans droits admin).
    // Commandes : « parle 1 », « parle 0 ». Rien d'autre n'est accepté.
    public static void Serve(string dir, string pipeName, string userSid, int r, int g, int b)
    {
        baseR = r; baseG = g; baseB = b;
        Open(dir, 180);
        try
        {
            Restore(); // le violet dès le démarrage
            var security = new PipeSecurity();
            security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(userSid), PipeAccessRights.ReadWrite, AccessControlType.Allow));
            security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), PipeAccessRights.FullControl, AccessControlType.Allow));
            while (true)
            {
                using (var pipe = new NamedPipeServerStream(pipeName, PipeDirection.InOut /* le client Node lit aussi, sinon il croit le canal fermé */, 1, PipeTransmissionMode.Byte, PipeOptions.None, 256, 256, security))
                {
                    pipe.WaitForConnection();
                    using (var reader = new StreamReader(pipe, Encoding.ASCII))
                    {
                        string line;
                        while ((line = reader.ReadLine()) != null)
                        {
                            if (line.Length > 32) break;
                            if (line == "parle 1") Speak(true);
                            else if (line == "parle 0") Speak(false);
                        }
                    }
                }
                Speak(false); // CAPRI fermée : on rend l'éclairage
            }
        }
        finally { speaking = false; Restore(); MLAPI_Release(); }
    }
}
