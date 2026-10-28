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
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int MLAPI_GetLedMaxSpeed([MarshalAs(UnmanagedType.BStr)] string type, int index, out int max);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int MLAPI_GetLedSpeed([MarshalAs(UnmanagedType.BStr)] string type, int index, out int level);
    [DllImport(DLL, CallingConvention = CallingConvention.Cdecl)] static extern int MLAPI_SetLedSpeed([MarshalAs(UnmanagedType.BStr)] string type, int index, int level);

    class Led
    {
        public string Type, Name, Style, Static;
        public int Index, R, G, B, Speed, MaxSpeed = -1;
        public string[] Styles;
        public bool Has(string style) { foreach (var s in Styles) if (s.Equals(style, StringComparison.OrdinalIgnoreCase)) return true; return false; }
    }

    static readonly List<Led> leds = new List<Led>();
    static readonly object gate = new object();
    static volatile bool speaking;
    static volatile bool gaming; // Cyberpunk 2077 lancé : ambiance Night City au lieu du violet
    static int gen; // change à chaque nouvelle animation : l'ancienne s'arrête d'elle-même (lu et écrit sous `gate`)

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
                int max, speed;
                try { if (MLAPI_GetLedMaxSpeed(led.Type, k, out max) == 0) led.MaxSpeed = max; if (MLAPI_GetLedSpeed(led.Type, k, out speed) == 0) led.Speed = speed; } catch { }
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
                sb.AppendLine(string.Format("{0}[{1}] « {2} » style={3} couleur={4},{5},{6} vitesse={9}/{10} fixe={7} styles=[{8}]", l.Type, l.Index, l.Name, l.Style, l.R, l.G, l.B, l.Static ?? "-", string.Join(", ", l.Styles), l.Speed, l.MaxSpeed));
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
        lock (gate) { gen++; foreach (var l in leds) if (l.Static != null) MLAPI_SetLedStyle(l.Type, l.Index, l.Static); }
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
        {
            gen++;
            foreach (var l in leds)
            {
                if (l.Static == null) continue;
                MLAPI_SetLedStyle(l.Type, l.Index, l.Static);
                MLAPI_SetLedColor(l.Type, l.Index, baseR, baseG, baseB);
            }
        }
    }

    // --- Ambiance Cyberpunk 2077, tant que le jeu tourne ---
    // Le SDK ne voit qu'une zone (« SELECT ALL ») : on ne peut pas peindre les LED une à une. Le mouvement autour des
    // ventilateurs vient donc des effets animés de la carte mère (Meteor, Lightning, Flame), lancés aux couleurs du
    // jeu et à pleine vitesse, en scènes qui s'enchaînent. Entre deux scènes, une coupure façon Breach Protocol.
    static readonly int[] JAUNE = { 252, 238, 10 }, CYAN = { 0, 240, 255 }, ROUGE = { 255, 0, 60 }, NOIR = { 0, 0, 0 };

    // Effet animé de la carte mère, couleur et vitesse (0 à 1 de la vitesse maximale) ; faux si l'animation `g` est
    // remplacée ou si la carte ne connaît pas l'effet.
    static bool Effect(int g, string style, int[] c, double speed)
    {
        lock (gate)
        {
            if (g != gen) return false;
            bool any = false;
            foreach (var l in leds)
            {
                if (!l.Has(style)) continue;
                any = true;
                MLAPI_SetLedStyle(l.Type, l.Index, style);
                MLAPI_SetLedColor(l.Type, l.Index, c[0], c[1], c[2]);
                if (l.MaxSpeed > 0) MLAPI_SetLedSpeed(l.Type, l.Index, (int)Math.Round(l.MaxSpeed * speed));
            }
            return any;
        }
    }

    // Laisse jouer une scène ; faux dès qu'une autre animation prend la main.
    static bool Hold(int g, int ms)
    {
        for (int t = 0; t < ms; t += 50)
        {
            lock (gate) if (g != gen) return false;
            Thread.Sleep(50);
        }
        return true;
    }

    static void Fixed(int g)
    {
        lock (gate) if (g == gen) foreach (var l in leds) if (l.Static != null) MLAPI_SetLedStyle(l.Type, l.Index, l.Static);
    }

    // Une image de l'animation `g` ; faux si une autre animation (ou le repos, ou la parole) a pris la main.
    static bool Show(int g, int[] c, double k = 1)
    {
        lock (gate)
        {
            if (g != gen) return false;
            Paint((int)(c[0] * k), (int)(c[1] * k), (int)(c[2] * k));
            return true;
        }
    }

    // Coupure Breach Protocol entre deux scènes : 0,4 à 0,8 s de flashs cyan / jaune / rouge / noir, en fixe.
    static bool Breach(int g, Random rnd)
    {
        Fixed(g);
        var colors = new[] { CYAN, JAUNE, ROUGE, NOIR, CYAN };
        var until = DateTime.Now.AddMilliseconds(400 + rnd.Next(400));
        while (DateTime.Now < until)
        {
            if (!Show(g, colors[rnd.Next(colors.Length)])) return false;
            Thread.Sleep(25 + rnd.Next(45));
        }
        return true;
    }

    // Un effet animé de la carte mère, sinon (effet inconnu) la couleur en fixe ; faux si l'animation est remplacée.
    static bool Play(int g, string style, int[] c)
    {
        if (Effect(g, style, c, 1)) return true;
        lock (gate) if (g != gen) return false;
        Fixed(g);
        return Show(g, c);
    }

    static bool Alive(int g) { lock (gate) return g == gen; }

    // Ce que CAPRI voit du jeu (ambiance.js) : couleur dominante de l'écran, dégâts, coupure brutale.
    static readonly int[] screen = new int[3];
    static long screenAt; // DateTime.UtcNow.Ticks de la dernière couleur reçue
    static int hitFlag, glitchFlag;

    // Night City, tant que le jeu tourne :
    //  - le jeu montre de la couleur : Meteor qui file autour des ventilateurs dans la couleur dominante de l'écran ;
    //  - V se fait toucher : stroboscope rouge puis éclairs rouges ;
    //  - l'image coupe d'un coup : flashs Breach Protocol ;
    //  - scène sombre ou sans couleur : flux cyan et néons jaunes (Meteor), éclairs rouges du Blackwall un tour sur trois.
    static void NightCity(int g)
    {
        var rnd = new Random();
        string current = null;
        int[] applied = null;
        var appliedAt = DateTime.MinValue;
        var sceneUntil = DateTime.MinValue;
        int scene = 0;
        while (Alive(g))
        {
            if (Interlocked.Exchange(ref hitFlag, 0) == 1)
            {
                Fixed(g);
                for (int i = 0; i < 6; i++) { if (!Show(g, i % 2 == 0 ? ROUGE : NOIR)) return; Thread.Sleep(55); }
                if (!Play(g, "Lightning", ROUGE) || !Hold(g, 900)) return;
                current = null;
                continue;
            }
            if (Interlocked.Exchange(ref glitchFlag, 0) == 1)
            {
                if (!Breach(g, rnd)) return;
                current = null;
                continue;
            }
            bool fresh = DateTime.UtcNow.Ticks - Interlocked.Read(ref screenAt) < TimeSpan.TicksPerSecond * 3;
            if (fresh)
            {
                int[] c;
                lock (screen) c = (int[])screen.Clone();
                if (current != "ecran")
                {
                    if (!Play(g, "Meteor", c)) return;
                    current = "ecran"; applied = c; appliedAt = DateTime.UtcNow;
                }
                // Chaque nouvelle couleur relance l'effet de la carte mère : pas plus d'un changement toutes les 2 s.
                else if (Math.Abs(c[0] - applied[0]) + Math.Abs(c[1] - applied[1]) + Math.Abs(c[2] - applied[2]) > 30 && (DateTime.UtcNow - appliedAt).TotalMilliseconds > 2000)
                {
                    lock (gate) { if (g != gen) return; Paint(c[0], c[1], c[2]); }
                    applied = c; appliedAt = DateTime.UtcNow;
                }
            }
            else if (current != "scene" || DateTime.UtcNow > sceneUntil)
            {
                if (current == "scene" && !Breach(g, rnd)) return;
                scene++;
                bool wall = scene % 3 == 0;
                if (!Play(g, wall ? "Lightning" : "Meteor", wall ? ROUGE : scene % 3 == 1 ? CYAN : JAUNE)) return;
                current = "scene";
                sceneUntil = DateTime.UtcNow.AddMilliseconds(wall ? 4000 + rnd.Next(2000) : 7000 + rnd.Next(4000));
            }
            Thread.Sleep(80);
        }
    }

    // « essai Style vitesse R G B » : joue un effet de la carte mère tel quel, pour choisir (tools/essai-lumiere.cjs).
    static void Try(string args)
    {
        var p = args.Split(' ');
        if (p.Length != 5) return;
        int speed; var c = new int[3];
        if (!int.TryParse(p[1], out speed) || speed < 0) return;
        for (int i = 0; i < 3; i++) if (!int.TryParse(p[i + 2], out c[i]) || c[i] < 0 || c[i] > 255) return;
        lock (gate)
        {
            gen++;
            foreach (var l in leds)
            {
                if (!l.Has(p[0])) continue;
                MLAPI_SetLedStyle(l.Type, l.Index, p[0]);
                MLAPI_SetLedColor(l.Type, l.Index, c[0], c[1], c[2]);
                if (l.MaxSpeed > 0) MLAPI_SetLedSpeed(l.Type, l.Index, Math.Min(speed, l.MaxSpeed));
            }
        }
    }

    // « ecran R G B » : trois nombres de 0 à 255, sinon ignoré.
    static void Screen(string args)
    {
        var parts = args.Split(' ');
        if (parts.Length != 3) return;
        var c = new int[3];
        for (int i = 0; i < 3; i++) if (!int.TryParse(parts[i], out c[i]) || c[i] < 0 || c[i] > 255) return;
        lock (screen) { screen[0] = c[0]; screen[1] = c[1]; screen[2] = c[2]; }
        Interlocked.Exchange(ref screenAt, DateTime.UtcNow.Ticks);
    }

    static void StartNightCity()
    {
        int g;
        lock (gate) g = ++gen;
        new Thread(() => NightCity(g)) { IsBackground = true }.Start();
    }

    // Quand elle se tait : l'ambiance du jeu s'il tourne, sinon le violet.
    static void Settle()
    {
        if (gaming) StartNightCity();
        else Restore();
    }

    static void Speak(bool on)
    {
        if (on == speaking) return;
        speaking = on;
        if (on) new Thread(Bug) { IsBackground = true }.Start();
        else { Thread.Sleep(250); Settle(); }
    }

    static void Game(bool on)
    {
        if (on == gaming) return;
        gaming = on;
        if (!speaking) Settle(); // si elle parle, son bug passe d'abord ; Speak(false) reprendra la bonne ambiance
    }

    // Service : canal nommé `pipeName`, ouvert au seul compte `userSid` (celui de Tommy, sans droits admin).
    // Commandes : « parle 1/0 », « jeu 1/0 », et en jeu « ecran R G B », « degats », « glitch ». Rien d'autre n'est
    // accepté.
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
                            else if (line == "jeu 1") Game(true);
                            else if (line == "jeu 0") Game(false);
                            else if (line.StartsWith("ecran ")) Screen(line.Substring(6));
                            else if (line == "degats") Interlocked.Exchange(ref hitFlag, 1);
                            else if (line == "glitch") Interlocked.Exchange(ref glitchFlag, 1);
                            else if (line.StartsWith("essai ")) Try(line.Substring(6));
                        }
                    }
                }
                gaming = false; // CAPRI fermée : on rend l'éclairage
                if (speaking) Speak(false); else Restore();
            }
        }
        finally { speaking = false; Restore(); MLAPI_Release(); }
    }
}
