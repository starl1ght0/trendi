using System;
using System.Diagnostics;
using System.IO;

class TrendChartsLauncher
{
    static int Main()
    {
        var root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var nodeExe = Path.Combine(root, "node", "node.exe");
        var appDir = Path.Combine(root, "app");
        var appScript = Path.Combine(appDir, "launcher.js");
        var dbPath = Path.Combine(root, "data", "trends.db");

        if (!File.Exists(nodeExe))
        {
            Console.WriteLine("node\\node.exe not found. Copy TrendChartsPortable folder as a whole.");
            Console.ReadLine();
            return 1;
        }

        if (!File.Exists(appScript))
        {
            Console.WriteLine("app\\launcher.js not found.");
            Console.ReadLine();
            return 1;
        }

        var psi = new ProcessStartInfo
        {
            FileName = nodeExe,
            Arguments = "\"" + appScript + "\"",
            WorkingDirectory = appDir,
            UseShellExecute = false,
        };
        psi.EnvironmentVariables["DB_PATH"] = dbPath;
        psi.EnvironmentVariables["PORT"] = "3000";

        using (var process = Process.Start(psi))
        {
            if (process == null)
            {
                Console.WriteLine("Failed to start application.");
                Console.ReadLine();
                return 1;
            }
            process.WaitForExit();
            return process.ExitCode;
        }
    }
}
